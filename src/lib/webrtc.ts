import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import type { CallType, WebRtcSignal } from '../types/chat';

export interface PeerStreamEntry {
  uid: string;
  stream: MediaStream;
  connectionState: RTCPeerConnectionState;
}

export interface WebRtcCallbacks {
  onLocalStream: (stream: MediaStream | null) => void;
  onRemoteStreamsChange: (streams: Map<string, PeerStreamEntry>) => void;
  onOverallConnectionState: (
    state: 'initializing' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  ) => void;
  onError: (message: string) => void;
}

interface PeerRecord {
  pc: RTCPeerConnection;
  stream: MediaStream;
  makingOffer: boolean;
  ignoreOffer: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  connectionState: RTCPeerConnectionState;
}

export class WebRtcMeshManager {
  private callId: string;
  private myUid: string;
  private callType: CallType;
  private callbacks: WebRtcCallbacks;

  private iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private peers = new Map<string, PeerRecord>();
  private processedSignals = new Set<string>();
  private signalUnsub: Unsubscribe | null = null;
  private destroyed = false;

  constructor(
    callId: string,
    myUid: string,
    callType: CallType,
    callbacks: WebRtcCallbacks
  ) {
    this.callId = callId;
    this.myUid = myUid;
    this.callType = callType;
    this.callbacks = callbacks;
  }

  async initialize(): Promise<void> {
    this.callbacks.onOverallConnectionState('initializing');

    // Fetch ICE / STUN / TURN config from authenticated backend endpoint
    try {
      const token = await auth.currentUser?.getIdToken();
      if (token) {
        const res = await fetch('/api/ice-servers', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = (await res.json()) as { iceServers?: RTCIceServer[] };
          if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
            this.iceServers = data.iceServers;
          }
        }
      }
    } catch {
      // Keep default public STUN servers if endpoint check fails
    }

    // Acquire local microphone & camera (with clean audio-only fallback if camera unavailable)
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video:
          this.callType === 'video'
            ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
            : false,
      });
    } catch (err) {
      if (this.callType === 'video') {
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });
          this.callbacks.onError('Camera unavailable — joined with audio only.');
        } catch (audioErr) {
          this.callbacks.onError(
            audioErr instanceof Error
              ? audioErr.message
              : 'Microphone access was denied.'
          );
          throw audioErr;
        }
      } else {
        this.callbacks.onError(
          err instanceof Error ? err.message : 'Microphone access was denied.'
        );
        throw err;
      }
    }

    if (this.destroyed) {
      this.stopAllTracks(this.localStream);
      return;
    }

    this.callbacks.onLocalStream(this.localStream);
    this.subscribeIncomingSignals();
    this.callbacks.onOverallConnectionState('connecting');
  }

  /**
   * Ensures RTCPeerConnections exist for every active joined remote participant.
   */
  syncJoinedPeers(joinedRemoteUids: string[]): void {
    if (this.destroyed) return;

    const targetSet = new Set(joinedRemoteUids.filter((id) => id !== this.myUid));

    // Close peers that left
    for (const [peerUid, record] of this.peers.entries()) {
      if (!targetSet.has(peerUid)) {
        record.pc.close();
        this.peers.delete(peerUid);
      }
    }

    // Connect to newly joined peers
    for (const peerUid of targetSet) {
      if (!this.peers.has(peerUid)) {
        const record = this.createPeerConnection(peerUid);
        this.peers.set(peerUid, record);
        // Deterministic initiator: lexicographically smaller UID initiates offer
        if (this.myUid < peerUid) {
          void this.createAndSendOffer(peerUid, record);
        }
      }
    }

    this.emitRemoteStreams();
  }

  private createPeerConnection(peerUid: string): PeerRecord {
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceCandidatePoolSize: 10,
    });
    const remoteStream = new MediaStream();
    const record: PeerRecord = {
      pc,
      stream: remoteStream,
      makingOffer: false,
      ignoreOffer: false,
      pendingCandidates: [],
      connectionState: pc.connectionState,
    };

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        for (const t of event.streams[0].getTracks()) {
          if (!remoteStream.getTracks().some((existing) => existing.id === t.id)) {
            remoteStream.addTrack(t);
          }
        }
      } else if (event.track) {
        if (!remoteStream.getTracks().some((existing) => existing.id === event.track.id)) {
          remoteStream.addTrack(event.track);
        }
      }
      this.emitRemoteStreams();
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && !this.destroyed) {
        void this.sendSignal({
          toUid: peerUid,
          type: 'ice-candidate',
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid ?? undefined,
          sdpMLineIndex: event.candidate.sdpMLineIndex ?? undefined,
        });
      }
    };

    pc.onnegotiationneeded = async () => {
      if (this.myUid >= peerUid) return;
      await this.createAndSendOffer(peerUid, record);
    };

    pc.onconnectionstatechange = () => {
      record.connectionState = pc.connectionState;
      this.emitRemoteStreams();
      this.recomputeOverallState();
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        pc.restartIce();
      }
    };

    return record;
  }

  private async createAndSendOffer(
    peerUid: string,
    record: PeerRecord
  ): Promise<void> {
    try {
      record.makingOffer = true;
      const offer = await record.pc.createOffer();
      if (this.destroyed || record.pc.signalingState !== 'stable') return;
      await record.pc.setLocalDescription(offer);
      if (record.pc.localDescription?.sdp) {
        await this.sendSignal({
          toUid: peerUid,
          type: 'offer',
          sdp: record.pc.localDescription.sdp,
        });
      }
    } catch (err) {
      console.error('Error creating WebRTC offer:', err);
    } finally {
      record.makingOffer = false;
    }
  }

  private subscribeIncomingSignals(): void {
    const signalsRef = collection(db, 'calls', this.callId, 'signals');
    const q = query(signalsRef, where('toUid', '==', this.myUid));

    this.signalUnsub = onSnapshot(
      q,
      (snap) => {
        const added = snap
          .docChanges()
          .filter((c) => c.type === 'added')
          .sort((a, b) => {
            const ta = (a.doc.data() as WebRtcSignal).createdAt?.toMillis() ?? 0;
            const tb = (b.doc.data() as WebRtcSignal).createdAt?.toMillis() ?? 0;
            return ta - tb;
          });
        for (const change of added) {
          const sigId = change.doc.id;
          if (this.processedSignals.has(sigId)) continue;
          this.processedSignals.add(sigId);
          const signal = change.doc.data() as WebRtcSignal;
          void this.handleIncomingSignal(sigId, signal);
        }
      },
      (err) => {
        handleFirestoreError(
          err,
          OperationType.LIST,
          `calls/${this.callId}/signals`
        );
      }
    );
  }

  private async handleIncomingSignal(
    signalDocId: string,
    signal: WebRtcSignal
  ): Promise<void> {
    if (this.destroyed || signal.fromUid === this.myUid) return;

    let record = this.peers.get(signal.fromUid);
    if (!record) {
      record = this.createPeerConnection(signal.fromUid);
      this.peers.set(signal.fromUid, record);
      this.emitRemoteStreams();
    }

    const pc = record.pc;
    const isPolite = this.myUid < signal.fromUid;

    try {
      if (signal.type === 'offer' && signal.sdp) {
        const offerCollision =
          record.makingOffer || pc.signalingState !== 'stable';
        record.ignoreOffer = !isPolite && offerCollision;
        if (record.ignoreOffer) return;

        await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
        await this.flushPendingCandidates(record);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (pc.localDescription?.sdp) {
          await this.sendSignal({
            toUid: signal.fromUid,
            type: 'answer',
            sdp: pc.localDescription.sdp,
          });
        }
      } else if (signal.type === 'answer' && signal.sdp) {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
          await this.flushPendingCandidates(record);
        }
      } else if (signal.type === 'ice-candidate' && signal.candidate) {
        const candidateInit: RTCIceCandidateInit = {
          candidate: signal.candidate,
          sdpMid: signal.sdpMid ?? null,
          sdpMLineIndex: signal.sdpMLineIndex ?? null,
        };
        if (pc.remoteDescription) {
          await pc.addIceCandidate(candidateInit);
        } else {
          record.pendingCandidates.push(candidateInit);
        }
      }
    } catch (err) {
      console.error('Failed handling WebRTC signal:', err);
    } finally {
      // Clean up consumed signal doc
      void deleteDoc(doc(db, 'calls', this.callId, 'signals', signalDocId)).catch(
        () => undefined
      );
    }
  }

  private async flushPendingCandidates(record: PeerRecord): Promise<void> {
    while (record.pendingCandidates.length > 0) {
      const candidate = record.pendingCandidates.shift();
      if (candidate) {
        await record.pc.addIceCandidate(candidate).catch(() => undefined);
      }
    }
  }

  private async sendSignal(params: {
    toUid: string;
    type: 'offer' | 'answer' | 'ice-candidate';
    sdp?: string;
    candidate?: string;
    sdpMid?: string;
    sdpMLineIndex?: number;
  }): Promise<void> {
    const sigId = `sig_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const payload: Record<string, unknown> = {
      id: sigId,
      fromUid: this.myUid,
      toUid: params.toUid,
      type: params.type,
      createdAt: serverTimestamp(),
    };
    if (params.sdp) payload.sdp = params.sdp.slice(0, 32768);
    if (params.candidate) payload.candidate = params.candidate.slice(0, 4096);
    if (params.sdpMid !== undefined) payload.sdpMid = params.sdpMid.slice(0, 64);
    if (typeof params.sdpMLineIndex === 'number') {
      payload.sdpMLineIndex = params.sdpMLineIndex;
    }

    try {
      await setDoc(doc(db, 'calls', this.callId, 'signals', sigId), payload);
    } catch (err) {
      // Fallback to addDoc? No, our rule requires id == signalId, so setDoc is exact.
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `calls/${this.callId}/signals/${sigId}`
      );
    }
  }

  setAudioMuted(muted: boolean): void {
    if (!this.localStream) return;
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = !muted;
    }
  }

  setVideoOff(videoOff: boolean): void {
    if (!this.localStream) return;
    for (const track of this.localStream.getVideoTracks()) {
      track.enabled = !videoOff;
    }
  }

  async toggleScreenShare(enable: boolean): Promise<boolean> {
    if (!this.localStream) return false;

    if (enable) {
      try {
        this.screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
        });
        const screenTrack = this.screenStream.getVideoTracks()[0];
        if (!screenTrack) return false;

        screenTrack.onended = () => {
          void this.toggleScreenShare(false);
        };

        for (const record of this.peers.values()) {
          const sender = record.pc
            .getSenders()
            .find((s) => s.track?.kind === 'video');
          if (sender) {
            await sender.replaceTrack(screenTrack);
          } else {
            record.pc.addTrack(screenTrack, this.localStream);
          }
        }
        return true;
      } catch {
        return false;
      }
    } else {
      this.stopAllTracks(this.screenStream);
      this.screenStream = null;
      const camTrack = this.localStream.getVideoTracks()[0] || null;
      for (const record of this.peers.values()) {
        const sender = record.pc
          .getSenders()
          .find((s) => s.track?.kind === 'video');
        if (sender && camTrack) {
          await sender.replaceTrack(camTrack);
        }
      }
      return false;
    }
  }

  private emitRemoteStreams(): void {
    const out = new Map<string, PeerStreamEntry>();
    for (const [uid, record] of this.peers.entries()) {
      out.set(uid, {
        uid,
        stream: record.stream,
        connectionState: record.connectionState,
      });
    }
    this.callbacks.onRemoteStreamsChange(out);
  }

  private recomputeOverallState(): void {
    if (this.peers.size === 0) {
      this.callbacks.onOverallConnectionState('connecting');
      return;
    }
    const states = Array.from(this.peers.values()).map((p) => p.connectionState);
    if (states.some((s) => s === 'connected')) {
      this.callbacks.onOverallConnectionState('connected');
    } else if (states.some((s) => s === 'disconnected' || s === 'failed')) {
      this.callbacks.onOverallConnectionState('reconnecting');
    } else {
      this.callbacks.onOverallConnectionState('connecting');
    }
  }

  private stopAllTracks(stream: MediaStream | null): void {
    if (!stream) return;
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.signalUnsub) {
      this.signalUnsub();
      this.signalUnsub = null;
    }
    for (const record of this.peers.values()) {
      record.pc.close();
    }
    this.peers.clear();
    this.stopAllTracks(this.screenStream);
    this.screenStream = null;
    this.stopAllTracks(this.localStream);
    this.localStream = null;
    this.callbacks.onLocalStream(null);
    this.callbacks.onRemoteStreamsChange(new Map());
    this.callbacks.onOverallConnectionState('disconnected');
  }
}

// Keep unused import clean
void addDoc;
