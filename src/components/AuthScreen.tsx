import { useState, type FormEvent } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  MessageSquare,
  PhoneCall,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { auth, googleProvider } from '../lib/firebase';

interface AuthScreenProps {
  pendingVerificationUser: User | null;
  onVerificationConfirmed: () => Promise<void>;
}

type AuthMode = 'signin' | 'signup' | 'reset';

export function AuthScreen({
  pendingVerificationUser,
  onVerificationConfirmed,
}: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingVerify, setCheckingVerify] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const mapAuthError = (err: unknown): string => {
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/operation-not-allowed') {
      return 'Email/Password sign-in is not yet enabled in Firebase Console. Open Firebase Console -> Authentication -> Sign-in method -> Enable Email/Password, or use Google Sign-In below.';
    }
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
      return 'Incorrect email or password.';
    }
    if (code === 'auth/user-not-found') {
      return 'No account found with that email address.';
    }
    if (code === 'auth/email-already-in-use') {
      return 'An account with this email already exists. Try signing in instead.';
    }
    if (code === 'auth/weak-password') {
      return 'Password must be at least 6 characters.';
    }
    if (code === 'auth/popup-closed-by-user') {
      return 'Sign-in window was closed before completing.';
    }
    if (code === 'auth/too-many-requests') {
      return 'Too many attempts. Please wait a moment and try again.';
    }
    return err instanceof Error ? err.message : 'Authentication failed.';
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);
    setLoading(true);

    try {
      if (mode === 'signin') {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } else if (mode === 'signup') {
        const cleanName = displayName.trim();
        if (!cleanName) {
          setError('Please enter your display name.');
          setLoading(false);
          return;
        }
        const cred = await createUserWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );
        await updateProfile(cred.user, { displayName: cleanName.slice(0, 80) });
        await sendEmailVerification(cred.user);
        setInfoMessage(
          `Verification link sent to ${cred.user.email}. Please check your inbox.`
        );
      } else {
        await sendPasswordResetEmail(auth, email.trim());
        setInfoMessage('Password reset instructions sent to your email.');
        setMode('signin');
      }
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setInfoMessage(null);
    setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!pendingVerificationUser) return;
    setError(null);
    setInfoMessage(null);
    setCheckingVerify(true);
    try {
      await sendEmailVerification(pendingVerificationUser);
      setInfoMessage(`Verification email resent to ${pendingVerificationUser.email}.`);
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setCheckingVerify(false);
    }
  };

  const handleCheckVerified = async () => {
    if (!pendingVerificationUser) return;
    setError(null);
    setInfoMessage(null);
    setCheckingVerify(true);
    try {
      await pendingVerificationUser.reload();
      await pendingVerificationUser.getIdToken(true);
      if (pendingVerificationUser.emailVerified) {
        await onVerificationConfirmed();
      } else {
        setError(
          'Your email is not verified yet. Open the verification link in your inbox, then click Continue.'
        );
      }
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setCheckingVerify(false);
    }
  };

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 px-4 py-10 text-slate-900">
      {/* Animated Ambient Gradient Orbs */}
      <div
        aria-hidden="true"
        className="animate-float-slow pointer-events-none absolute -top-32 -left-24 h-[460px] w-[460px] rounded-full bg-indigo-600/30 blur-[110px]"
      />
      <div
        aria-hidden="true"
        className="animate-float-delayed pointer-events-none absolute -right-24 -bottom-32 h-[480px] w-[480px] rounded-full bg-cyan-500/25 blur-[120px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 h-[340px] w-[340px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/15 blur-[90px]"
      />

      <div className="relative z-10 mx-auto grid w-full max-w-5xl grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-12">
        {/* Left Welcome & Feature Showcase */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="hidden flex-col justify-center text-white lg:col-span-6 lg:flex"
        >
          <div className="flex items-center gap-3.5">
            <BrandLogo size="lg" />
            <div>
              <span className="font-display text-2xl font-bold tracking-tight text-white">
                My Chatting Web
              </span>
              <p className="text-xs text-indigo-200/80">
                Real-Time Messaging &amp; HD Calls
              </p>
            </div>
          </div>

          <h1 className="mt-8 font-display text-4xl leading-tight font-bold tracking-tight text-white [text-wrap:balance]">
            Stay closer with instant chats, voice notes, and crystal-clear calls.
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-slate-300">
            Connect one-to-one or gather your community in real time with live presence, media sharing, and peer-to-peer WebRTC calling.
          </p>

          <div className="mt-8 space-y-4">
            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-cyan-300 backdrop-blur-md">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">
                  Instant Sync &amp; Read Receipts
                </p>
                <p className="text-xs text-slate-300">
                  Live typing indicators, reactions, voice recordings, and media previews
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-indigo-300 backdrop-blur-md">
                <PhoneCall className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">
                  1:1 &amp; Group WebRTC Calling
                </p>
                <p className="text-xs text-slate-300">
                  Direct peer-to-peer voice, HD video, and screen sharing
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-emerald-300 backdrop-blur-md">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">
                  Verified Accounts &amp; Privacy Rules
                </p>
                <p className="text-xs text-slate-300">
                  Protected by Firebase Authentication and strict Firestore rules
                </p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Right Glassmorphism Auth Card */}
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto w-full max-w-md lg:col-span-6"
        >
          <div className="rounded-3xl border border-white/25 bg-white/92 p-7 shadow-2xl shadow-black/40 backdrop-blur-2xl sm:p-8 dark:border-white/10 dark:bg-slate-900/85">
            {/* Mobile Brand Header */}
            <div className="mb-6 flex items-center gap-3 lg:hidden">
              <BrandLogo size="md" />
              <div>
                <p className="font-display text-lg font-bold text-slate-900 dark:text-white">
                  My Chatting Web
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Messaging &amp; HD Calls
                </p>
              </div>
            </div>

            {pendingVerificationUser ? (
              <div>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-500 text-white shadow-md shadow-indigo-500/25">
                  <Mail className="h-6 w-6" />
                </div>
                <h2 className="mt-5 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                  Verify your email
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  We sent a confirmation link to{' '}
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {pendingVerificationUser.email}
                  </span>
                  . Click the link in your inbox to unlock your account.
                </p>

                {error && (
                  <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {infoMessage && (
                  <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{infoMessage}</span>
                  </div>
                )}

                <div className="mt-6 space-y-3">
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    type="button"
                    disabled={checkingVerify}
                    onClick={handleCheckVerified}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all hover:from-indigo-500 hover:to-blue-500 disabled:opacity-60"
                  >
                    {checkingVerify ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    I&apos;ve Verified — Continue
                  </motion.button>

                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    type="button"
                    disabled={checkingVerify}
                    onClick={handleResendVerification}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Resend Verification Email
                  </motion.button>

                  <button
                    type="button"
                    onClick={() => void signOut(auth)}
                    className="w-full pt-1 text-center text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400"
                  >
                    Use a different account
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {mode === 'signin'
                    ? 'Welcome back'
                    : mode === 'signup'
                      ? 'Create your account'
                      : 'Reset password'}
                </h2>
                <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                  {mode === 'signin'
                    ? 'Sign in to jump right back into your conversations.'
                    : mode === 'signup'
                      ? 'Set up your profile to start chatting and calling.'
                      : 'Enter your email and we will send a reset link.'}
                </p>

                {/* Animated Mode Tabs */}
                <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/90">
                  {(['signin', 'signup'] as const).map((tab) => {
                    const active = mode === tab;
                    return (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => {
                          setMode(tab);
                          setError(null);
                          setInfoMessage(null);
                        }}
                        className={`relative rounded-lg py-2 text-xs font-semibold transition-colors ${
                          active
                            ? 'text-slate-900 dark:text-white'
                            : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                        }`}
                      >
                        {active && (
                          <motion.div
                            layoutId="authTabPill"
                            transition={{
                              type: 'spring',
                              stiffness: 420,
                              damping: 32,
                            }}
                            className="absolute inset-0 rounded-lg bg-white shadow-xs dark:bg-slate-700"
                          />
                        )}
                        <span className="relative z-10">
                          {tab === 'signin' ? 'Sign In' : 'Create Account'}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <AnimatePresence mode="wait">
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
                    >
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{error}</span>
                    </motion.div>
                  )}

                  {infoMessage && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="mt-4 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
                    >
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{infoMessage}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                  {mode === 'signup' && (
                    <div>
                      <label
                        htmlFor="auth-name"
                        className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                      >
                        Display Name
                      </label>
                      <div className="relative mt-1.5">
                        <UserIcon className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                          id="auth-name"
                          type="text"
                          required
                          maxLength={80}
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder="Alex Rivera"
                          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-3.5 pl-10 text-sm text-slate-900 transition-shadow outline-none focus:border-indigo-500 focus:ring-3 focus:ring-indigo-500/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="auth-email"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                    >
                      Email Address
                    </label>
                    <div className="relative mt-1.5">
                      <Mail className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        id="auth-email"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-3.5 pl-10 text-sm text-slate-900 transition-shadow outline-none focus:border-indigo-500 focus:ring-3 focus:ring-indigo-500/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>
                  </div>

                  {mode !== 'reset' && (
                    <div>
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor="auth-password"
                          className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                        >
                          Password
                        </label>
                        {mode === 'signin' && (
                          <button
                            type="button"
                            onClick={() => {
                              setMode('reset');
                              setError(null);
                            }}
                            className="text-xs font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                          >
                            Forgot password?
                          </button>
                        )}
                      </div>
                      <div className="relative mt-1.5">
                        <Lock className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                          id="auth-password"
                          type={showPassword ? 'text' : 'password'}
                          required
                          minLength={6}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Minimum 6 characters"
                          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-10 pl-10 text-sm text-slate-900 transition-shadow outline-none focus:border-indigo-500 focus:ring-3 focus:ring-indigo-500/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          aria-label={
                            showPassword ? 'Hide password' : 'Show password'
                          }
                          className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  <motion.button
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.985 }}
                    type="submit"
                    disabled={loading}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all hover:brightness-105 disabled:opacity-60"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <span>
                          {mode === 'signin'
                            ? 'Sign In'
                            : mode === 'signup'
                              ? 'Create Account'
                              : 'Send Reset Link'}
                        </span>
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </motion.button>

                  {mode === 'reset' && (
                    <button
                      type="button"
                      onClick={() => setMode('signin')}
                      className="w-full text-center text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400"
                    >
                      Back to Sign In
                    </button>
                  )}
                </form>

                <div className="my-5 flex items-center gap-3">
                  <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700/80" />
                  <span className="text-xs font-medium text-slate-400">
                    or continue with
                  </span>
                  <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700/80" />
                </div>

                <motion.button
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.985 }}
                  type="button"
                  disabled={loading}
                  onClick={handleGoogleSignIn}
                  className="inline-flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-xs transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700/80"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                    />
                  </svg>
                  Continue with Google
                </motion.button>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
