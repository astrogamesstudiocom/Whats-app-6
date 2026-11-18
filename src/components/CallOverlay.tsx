import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Mic,
  MicOff,
  MonitorUp,
  Phone,
  PhoneOff,
  ShieldCheck,
  Video,
  VideoOff,
} from 'lucide-react';
import { Avatar } from './Avatar';
import { formatDuration } from '../lib/media';
import { WebRtcMeshManager, type PeerStreamEntry } from '../lib/webrtc';
import {
  acceptCallSession,
  declineCallSession,
  endCallSession,
  subscribeCallParticipants,
  subscribeCallSession,
  updateCallMediaState,
} from '../services/chatService';
import type {
  CallInvite,
  CallParticipant,
  CallSession,
  UserProfile,
} from '../types/chat';

interface CallOverlayProps {
  activeCallId: string | null;
  incomingInvite: CallInvite | null;
  currentUser: UserProfile;
  onCallAccepted: (callId: string) => void;
  onCallClosed: () => void;
}

function RemotePeerTile({
  participant,
  entry,
  callType,
  isRinging,
}: {
  participant: CallParticipant;
  entry?: PeerStreamEntry;
  callType: 'audio' | 'video';
  isRinging: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const stream = entry?.stream || null;
    if (videoRef.current && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
    }
    if (audioRef.current && audioRef.current.srcObject !== stream) {
      audioRef.current.srcObject = stream;
    }
  }, [entry?.stream]);

  const hasVideo =
    callType === 'video' &&
    !participant.videoOff &&
    Boolean(entry?.stream && entry.stream.getVideoTracks().length > 0);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/50 shadow-2xl"
    >
      <audio ref={audioRef} autoPlay playsInline />
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className={`h-full w-full object-cover ${hasVideo ? 'block' : 'hidden'}`}
      />
      {!hasVideo && (
        <div className="relative flex flex-col items-center gap-4 p-6 text-center">
          <div className="relative flex items-center justify-center">
            {(isRinging || participant.status === 'ringing') && (
              <>
                <span className="absolute h-28 w-28 animate-ping rounded-full bg-indigo-500/20" />
                <span className="absolute h-24 w-24 animate-pulse rounded-full border border-indigo-400/30" />
              </>
            )}
            <Avatar
              name={participant.displayName}
              src={participant.photoURL}
              size="xl"
              ring={entry?.connectionState === 'connected'}
            />
          </div>
          <div>
            <p className="font-display text-base font-bold text-white">
              {participant.displayName}
            </p>
            <p className="mt-1 text-xs font-medium text-indigo-300/90 capitalize">
              {entry?.connectionState === 'connected'
                ? 'Audio connected'
                : participant.status === 'ringing'
                  ? 'Ringing...'
                  : participant.status}
            </p>
          </div>
        </div>
      )}

      <div className="absolute right-4 bottom-4 left-4 flex items-center justify-between text-xs text-white">
        <span className="rounded-xl border border-white/10 bg-slate-950/65 px-3 py-1 font-semibold backdrop-blur-md">
          {participant.displayName}
        </span>
        {participant.audioMuted && (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-600/90 shadow-lg">
            <MicOff className="h-4 w-4" />
          </span>
        )}
      </div>
    </motion.div>
  );
}

export function CallOverlay({
  activeCallId,
  incomingInvite,
  currentUser,
  onCallAccepted,
  onCallClosed,
}: CallOverlayProps) {
  const [session, setSession] = useState<CallSession | null>(null);
  const [participants, setParticipants] = useState<CallParticipant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<
    Map<string, PeerStreamEntry>
  >(new Map());
  const [connectionState, setConnectionState] = useState<
    'initializing' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  >('initializing');
  const [audioMuted, setAudioMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const webrtcRef = useRef<WebRtcMeshManager | null>(null);
  const answeredAtRef = useRef<number | null>(null);
  const closingRef = useRef(false);

  // Subtle Web Audio ringtone chime when incomingInvite is ringing
  useEffect(() => {
    if (!incomingInvite || activeCallId) return;
    let ctx: AudioContext | null = null;
    let interval: number | null = null;

    const playChime = () => {
      try {
        ctx = ctx || new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime);
        osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.16);
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.55);
      } catch {
        // Autoplay may be blocked before user gesture
      }
    };

    playChime();
    interval = window.setInterval(playChime, 2600);
    return () => {
      if (interval) window.clearInterval(interval);
      if (ctx) void ctx.close().catch(() => undefined);
    };
  }, [incomingInvite, activeCallId]);

  // Subscribe to call session & participants when activeCallId is set
  useEffect(() => {
    if (!activeCallId) {
      setSession(null);
      setParticipants([]);
      setDurationSeconds(0);
      answeredAtRef.current = null;
      closingRef.current = false;
      return;
    }

    const unsubSession = subscribeCallSession(activeCallId, (s) => {
      setSession(s);
      if (s && ['ended', 'rejected', 'missed'].includes(s.status)) {
        webrtcRef.current?.destroy();
        webrtcRef.current = null;
        onCallClosed();
      }
    });
    const unsubParts = subscribeCallParticipants(activeCallId, setParticipants);

    return () => {
      unsubSession();
      unsubParts();
    };
  }, [activeCallId, onCallClosed]);

  // Initialize WebRTC Mesh Manager once session is loaded
  useEffect(() => {
    if (!activeCallId || !session) return;
    if (webrtcRef.current) return;

    setVideoOff(session.callType === 'audio');
    setAudioMuted(false);
    setMediaError(null);

    const manager = new WebRtcMeshManager(
      activeCallId,
      currentUser.uid,
      session.callType,
      {
        onLocalStream: setLocalStream,
        onRemoteStreamsChange: setRemoteStreams,
        onOverallConnectionState: setConnectionState,
        onError: setMediaError,
      }
    );
    webrtcRef.current = manager;
    void manager.initialize().catch(() => undefined);

    return () => {
      manager.destroy();
      if (webrtcRef.current === manager) {
        webrtcRef.current = null;
      }
    };
  }, [activeCallId, session?.id, session?.callType, currentUser.uid]);

  // Sync joined peers with WebRTC mesh
  useEffect(() => {
    if (!webrtcRef.current) return;
    const joinedRemoteUids = participants
      .filter((p) => p.uid !== currentUser.uid && p.status === 'joined')
      .map((p) => p.uid);
    webrtcRef.current.syncJoinedPeers(joinedRemoteUids);
  }, [participants, currentUser.uid]);

  // Attach local video stream
  useEffect(() => {
    if (localVideoRef.current && localVideoRef.current.srcObject !== localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Live duration timer once call becomes active
  useEffect(() => {
    if (session?.status !== 'active') return;
    if (!answeredAtRef.current) {
      answeredAtRef.current = Date.now();
    }
    const timer = window.setInterval(() => {
      if (answeredAtRef.current) {
        setDurationSeconds(Math.floor((Date.now() - answeredAtRef.current) / 1000));
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [session?.status]);

  // Auto-mark unanswered outgoing call as missed after 45 seconds
  useEffect(() => {
    if (
      !activeCallId ||
      !session ||
      session.status !== 'ringing' ||
      session.callerId !== currentUser.uid
    ) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void handleEndCall();
    }, 45000);
    return () => window.clearTimeout(timeout);
  }, [activeCallId, session?.status, session?.callerId, currentUser.uid]);

  const remoteParticipants = useMemo(
    () => participants.filter((p) => p.uid !== currentUser.uid),
    [participants, currentUser.uid]
  );

  const allParticipantUids = useMemo(
    () => participants.map((p) => p.uid),
    [participants]
  );

  const handleAcceptIncoming = async () => {
    if (!incomingInvite) return;
    await acceptCallSession(
      incomingInvite.callId,
      currentUser.uid,
      incomingInvite.callType,
      [incomingInvite.callerId, currentUser.uid]
    );
    onCallAccepted(incomingInvite.callId);
  };

  const handleDeclineIncoming = async () => {
    if (!incomingInvite) return;
    await declineCallSession(
      incomingInvite.callId,
      currentUser.uid,
      incomingInvite.mode,
      [incomingInvite.callerId, currentUser.uid]
    );
  };

  const handleEndCall = async () => {
    if (!activeCallId || !session || closingRef.current) return;
    closingRef.current = true;
    const wasAnswered = session.status === 'active' || answeredAtRef.current !== null;
    const elapsed = wasAnswered ? durationSeconds : 0;

    webrtcRef.current?.destroy();
    webrtcRef.current = null;

    await endCallSession({
      callId: activeCallId,
      actor: currentUser,
      conversationId: session.conversationId,
      callType: session.callType,
      mode: session.mode,
      wasAnswered,
      durationSeconds: elapsed,
      participantUids:
        allParticipantUids.length > 0 ? allParticipantUids : [currentUser.uid],
    });
    onCallClosed();
  };

  const toggleMute = () => {
    const next = !audioMuted;
    setAudioMuted(next);
    webrtcRef.current?.setAudioMuted(next);
    if (activeCallId) {
      void updateCallMediaState(activeCallId, currentUser.uid, next, videoOff);
    }
  };

  const toggleCamera = () => {
    const next = !videoOff;
    setVideoOff(next);
    webrtcRef.current?.setVideoOff(next);
    if (activeCallId) {
      void updateCallMediaState(activeCallId, currentUser.uid, audioMuted, next);
    }
  };

  const toggleScreenShare = async () => {
    if (!webrtcRef.current) return;
    const next = !screenSharing;
    const active = await webrtcRef.current.toggleScreenShare(next);
    setScreenSharing(active);
  };

  // Incoming Call Screen with Pulsing Concentric Rings
  if (incomingInvite && !activeCallId) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xl">
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(79,70,229,0.28),transparent_60%)]"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/15 bg-slate-900/90 p-8 text-center text-white shadow-2xl backdrop-blur-2xl"
        >
          <div className="mx-auto inline-flex items-center gap-1.5 rounded-full border border-indigo-400/30 bg-indigo-500/15 px-3 py-1 text-[11px] font-semibold tracking-wide text-indigo-300 uppercase">
            {incomingInvite.callType === 'video' ? (
              <Video className="h-3.5 w-3.5" />
            ) : (
              <Phone className="h-3.5 w-3.5" />
            )}
            <span>
              Incoming {incomingInvite.mode === 'group' ? 'Group ' : ''}
              {incomingInvite.callType === 'video' ? 'Video Call' : 'Voice Call'}
            </span>
          </div>

          <div className="relative mx-auto mt-7 flex h-28 w-28 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-indigo-500/25" />
            <span className="absolute -inset-3 animate-pulse rounded-full border border-indigo-400/30" />
            <Avatar
              name={incomingInvite.callerName}
              src={incomingInvite.callerPhoto}
              size="xl"
              ring
            />
          </div>

          <h2 className="mt-5 font-display text-2xl font-bold tracking-tight">
            {incomingInvite.callerName}
          </h2>
          {incomingInvite.conversationTitle && (
            <p className="mt-1 text-xs font-medium text-slate-400">
              {incomingInvite.conversationTitle}
            </p>
          )}

          <div className="mt-8 flex items-center justify-center gap-8">
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => void handleDeclineIncoming()}
                aria-label="Decline call"
                className="flex h-15 w-15 items-center justify-center rounded-full bg-red-600 text-white shadow-lg shadow-red-600/30 transition-all hover:scale-105 hover:bg-red-500 active:scale-95"
              >
                <PhoneOff className="h-6 w-6" />
              </button>
              <span className="text-xs font-medium text-slate-300">Decline</span>
            </div>

            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => void handleAcceptIncoming()}
                aria-label="Accept call"
                className="flex h-15 w-15 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/35 transition-all hover:scale-105 hover:bg-emerald-400 active:scale-95"
              >
                {incomingInvite.callType === 'video' ? (
                  <Video className="h-6 w-6" />
                ) : (
                  <Phone className="h-6 w-6" />
                )}
              </button>
              <span className="text-xs font-medium text-slate-300">Accept</span>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  if (!activeCallId || !session) return null;

  const statusLabel =
    session.status === 'ringing'
      ? 'Ringing...'
      : connectionState === 'connected'
        ? 'Connected'
        : connectionState === 'reconnecting'
          ? 'Reconnecting...'
          : 'Connecting peer...';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(79,70,229,0.22),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(6,182,212,0.14),transparent_50%)]"
      />

      {/* Call Top Status */}
      <header className="relative z-10 flex items-center justify-between border-b border-white/10 bg-slate-950/60 px-6 py-4 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500/20 text-indigo-400">
            {session.callType === 'video' ? (
              <Video className="h-5 w-5" />
            ) : (
              <Phone className="h-5 w-5" />
            )}
          </div>
          <div>
            <h2 className="font-display text-base font-bold">
              {session.mode === 'group' ? 'Group ' : ''}
              {session.callType === 'video' ? 'Video Call' : 'Voice Call'}
            </h2>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-300">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  connectionState === 'connected'
                    ? 'bg-emerald-400'
                    : 'animate-pulse bg-amber-400'
                }`}
              />
              <span>{statusLabel}</span>
              {session.status === 'active' && (
                <>
                  <span aria-hidden="true" className="opacity-40">
                    ·
                  </span>
                  <span className="font-mono font-semibold text-white tabular-nums">
                    {formatDuration(durationSeconds)}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {mediaError ? (
            <p className="rounded-xl border border-amber-700/60 bg-amber-950/70 px-3 py-1.5 text-xs text-amber-200">
              {mediaError}
            </p>
          ) : (
            <div className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium text-slate-300 sm:flex">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span>WebRTC Encrypted Media</span>
            </div>
          )}
        </div>
      </header>

      {/* Media Stage */}
      <div className="relative z-10 flex-1 overflow-y-auto p-4 sm:p-6">
        <div
          className={`mx-auto grid h-full max-w-6xl place-items-center gap-4 ${
            remoteParticipants.length <= 1
              ? 'grid-cols-1'
              : remoteParticipants.length <= 4
                ? 'grid-cols-1 md:grid-cols-2'
                : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
          }`}
        >
          {remoteParticipants.map((participant) => (
            <RemotePeerTile
              key={participant.uid}
              participant={participant}
              entry={remoteStreams.get(participant.uid)}
              callType={session.callType}
              isRinging={session.status === 'ringing'}
            />
          ))}
        </div>

        {/* Self Preview Tile */}
        <div className="fixed right-5 bottom-26 z-20 w-36 overflow-hidden rounded-2xl border border-white/20 bg-slate-900 shadow-2xl sm:right-6 sm:w-52">
          <div className="relative flex aspect-video items-center justify-center">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className={`h-full w-full -scale-x-100 object-cover ${
                session.callType === 'video' && !videoOff && localStream
                  ? 'block'
                  : 'hidden'
              }`}
            />
            {(session.callType === 'audio' || videoOff || !localStream) && (
              <Avatar
                name={currentUser.displayName}
                src={currentUser.photoURL}
                size="md"
              />
            )}
            <span className="absolute bottom-1.5 left-2 rounded-lg bg-black/60 px-2 py-0.5 text-[10px] font-semibold backdrop-blur-xs">
              You {audioMuted ? '(Muted)' : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Floating Frosted Call Controls Dock */}
      <footer className="relative z-20 flex items-center justify-center px-4 pb-6 pt-2">
        <div className="flex items-center gap-3 rounded-full border border-white/15 bg-slate-900/85 px-5 py-3 shadow-2xl backdrop-blur-2xl">
          <button
            type="button"
            onClick={toggleMute}
            title={audioMuted ? 'Unmute Microphone' : 'Mute Microphone'}
            aria-label={audioMuted ? 'Unmute Microphone' : 'Mute Microphone'}
            className={`flex h-12 w-12 items-center justify-center rounded-full transition-all active:scale-95 ${
              audioMuted
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            {audioMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>

          {session.callType === 'video' && (
            <>
              <button
                type="button"
                onClick={toggleCamera}
                title={videoOff ? 'Turn Camera On' : 'Turn Camera Off'}
                aria-label={videoOff ? 'Turn Camera On' : 'Turn Camera Off'}
                className={`flex h-12 w-12 items-center justify-center rounded-full transition-all active:scale-95 ${
                  videoOff
                    ? 'bg-red-600 text-white hover:bg-red-500'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                {videoOff ? (
                  <VideoOff className="h-5 w-5" />
                ) : (
                  <Video className="h-5 w-5" />
                )}
              </button>

              <button
                type="button"
                onClick={() => void toggleScreenShare()}
                title={screenSharing ? 'Stop Screen Share' : 'Share Screen'}
                aria-label={screenSharing ? 'Stop Screen Share' : 'Share Screen'}
                className={`hidden h-12 w-12 items-center justify-center rounded-full transition-all active:scale-95 sm:flex ${
                  screenSharing
                    ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                <MonitorUp className="h-5 w-5" />
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => void handleEndCall()}
            title="End Call"
            className="flex h-12 items-center gap-2 rounded-full bg-red-600 px-6 text-sm font-semibold text-white shadow-lg shadow-red-600/30 transition-all hover:bg-red-500 active:scale-95"
          >
            <PhoneOff className="h-5 w-5" />
            <span>End</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
