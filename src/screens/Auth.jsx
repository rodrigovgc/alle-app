import { useEffect, useRef, useState } from 'react';
import { setPageMeta } from '../lib/pageMeta.js';
import { useVisualViewport } from '../lib/useViewport.js';
import { useFocusIntoView } from '../lib/useFocusIntoView.js';
import { supabase, isConfigured } from '../lib/supabase.js';
import { Logo } from '../components/Icon.jsx';
import { Button } from '../components/Button.jsx';
import { Field } from '../components/Sheet.jsx';

export function Auth({ notice: startNotice = '' }) {
  // The marketing site links here with ?auth=signup or ?auth=signin (or login).
  const [mode, setMode] = useState(() => {
    const auth = new URLSearchParams(window.location.search).get('auth');
    return auth === 'signup' ? 'signup' : 'signin';
  });
  // Tidy the address once read, so a later refresh doesn't force the mode.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('auth')) {
      url.searchParams.delete('auth');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  }, []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(() => {
    const left = sessionStorage.getItem('alle-auth-notice');
    if (left) sessionStorage.removeItem('alle-auth-notice');
    return left || startNotice;
  });
  useEffect(() => { if (startNotice) setNotice(startNotice); }, [startNotice]);
  useEffect(() => { setPageMeta(mode === 'signup' ? 'signup' : 'login'); }, [mode]);

  const isSignUp = mode === 'signup';
  const typing = useVisualViewport(true);
  const rootRef = useRef(null);
  useFocusIntoView(rootRef);

  async function submit(e) {
    e.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    try {
      if (isSignUp) {
        const { data, error: err } = await supabase.auth.signUp({
          email, password,
          options: { data: { first_name: firstName.trim(), last_name: lastName.trim() } },
        });
        if (err) throw err;
        // Already registered: Supabase sends no email and gives no error, but the
        // returned user has no identities. Say so and offer to sign in instead.
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setMode('signin');
          setNotice('There’s already an account with this email. Sign in instead.');
          return;
        }
        if (!data.session) setMode('confirm'); // waits here until the email is confirmed
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      }
    } catch (err) {
      setError(
        /invalid login/i.test(err.message) ? 'That email and password don’t match an account.'
          : /already (exists|registered)/i.test(err.message) ? 'There’s already an account with this email. Sign in instead.'
            : /not confirmed/i.test(err.message) ? 'Confirm your email first: check your inbox for the link.'
              : err.message,
      );
    } finally {
      setBusy(false);
    }
  }

  // Waiting for the email confirmation. The link may be opened on another
  // device (it signs in whichever browser opens it), so this tab keeps trying
  // to sign in with what was just typed and continues on its own once the
  // account is confirmed. The password only lives in memory, never stored.
  const [resent, setResent] = useState(false);
  useEffect(() => {
    if (mode !== 'confirm') return undefined;
    let stopped = false;
    const started = Date.now();
    async function attempt() {
      if (stopped || document.hidden) return;
      const { data } = await supabase.auth.signInWithPassword({ email, password });
      if (data?.session) stopped = true; // the app takes over from here
    }
    const timer = setInterval(() => {
      if (Date.now() - started > 30 * 60 * 1000) { clearInterval(timer); return; }
      attempt();
    }, 4000);
    const onBack = () => attempt(); // back on this tab: check straight away
    window.addEventListener('focus', onBack);
    document.addEventListener('visibilitychange', onBack);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('focus', onBack);
      document.removeEventListener('visibilitychange', onBack);
    };
  }, [mode, email, password]);

  async function resend() {
    setError('');
    const { error: err } = await supabase.auth.resend({ type: 'signup', email });
    if (err) setError(err.message); else setResent(true);
  }

  if (mode === 'confirm') {
    return (
      <main className="auth" ref={rootRef}>
        <div className="auth__brand"><Logo /></div>
        <div className="auth__form">
          <h1 className="auth__title">Check your email</h1>
          <p className="auth__lead">
            We sent a confirmation link to <strong>{email}</strong>. Open it on any device,
            even your phone. This screen continues on its own once you’ve confirmed.
          </p>
          <p className="auth__waiting" role="status"><span className="auth__dot" aria-hidden="true" />Waiting for confirmation…</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          {resent && <p className="form-notice" role="status">Sent again. Check your inbox and spam folder.</p>}
          <Button variant="secondary" onClick={resend} disabled={resent}>{resent ? 'Email sent' : 'Resend email'}</Button>
          <button type="button" className="text-btn" onClick={() => { setMode('signup'); setResent(false); setError(''); }}>
            Use a different email
          </button>
        </div>
      </main>
    );
  }

  if (mode === 'forgot') {
    return (
      <main className="auth" ref={rootRef}>
        <div className="auth__brand"><Logo /></div>
        <form className="auth__form" noValidate onSubmit={async (e) => {
          e.preventDefault();
          setError(''); setBusy(true);
          const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
          setBusy(false);
          if (err) setError(err.message); else setNotice('sent');
        }}>
          <h1 className="auth__title">Reset your password</h1>
          {notice === 'sent' ? (
            <p className="auth__lead">
              If there’s an account for <strong>{email}</strong>, we’ve sent a link to choose a new password.
              Check your inbox, and your spam folder just in case.
            </p>
          ) : (
            <>
              <p className="auth__lead">Enter your email and we’ll send you a link to choose a new password.</p>
              <Field label="Email">
                <input className="input" type="email" autoComplete="email" inputMode="email" enterKeyHint="go"
                  required value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              {error && <p className="form-error" role="alert">{error}</p>}
              <Button type="submit" disabled={busy || !email}>{busy ? 'Sending…' : 'Send reset link'}</Button>
            </>
          )}
          <button type="button" className="text-btn" onClick={() => { setMode('signin'); setNotice(''); setError(''); }}>
            Back to sign in
          </button>
        </form>
      </main>
    );
  }

  if (!isConfigured) {
    return (
      <main className="auth">
        <div className="auth__brand"><Logo /></div>
        <p className="auth__lead">Add your Supabase keys to connect.</p>
        <p className="auth__hint">
          Copy <code>.env.example</code> to <code>.env.local</code>, fill in
          <code> VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart the dev server.
        </p>
      </main>
    );
  }

  return (
    <main className={`auth ${typing ? 'is-typing' : ''}`} ref={rootRef}>
      <div className="auth__brand"><Logo /></div>
      <form className="auth__form" onSubmit={submit} noValidate>
        <h1 className="auth__title">{isSignUp ? 'Create your account' : 'Sign in'}</h1>
        <p className="auth__lead">
          {isSignUp
            ? 'Your decks and progress follow you to every device.'
            : 'Pick up where you left off.'}
        </p>
        {isSignUp && (
          <div className="name-row">
            <Field label="First name">
              <input className="input" autoComplete="given-name" enterKeyHint="next" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </Field>
            <Field label="Last name">
              <input className="input" autoComplete="family-name" enterKeyHint="next" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </Field>
          </div>
        )}
        <Field label="Email">
          <input
            className="input"
            type="email"
            autoComplete="email"
            inputMode="email"
            enterKeyHint="next"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password" hint={isSignUp ? 'At least 8 characters.' : undefined}>
          <input
            className="input"
            type="password"
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            enterKeyHint="go"
            required
            minLength={isSignUp ? 8 : 6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="form-notice" role="status">{notice}</p>}
        <Button type="submit" disabled={busy || !email || password.length < (isSignUp ? 8 : 6) || (isSignUp && !firstName.trim())}>
          {busy ? 'One moment…' : isSignUp ? 'Create account' : 'Sign in'}
        </Button>
        {!isSignUp && (
          <button type="button" className="text-btn" onClick={() => { setMode('forgot'); setError(''); setNotice(''); }}>
            Forgot password?
          </button>
        )}
        <button
          type="button"
          className="text-btn"
          onClick={() => { setMode(isSignUp ? 'signin' : 'signup'); setError(''); setNotice(''); }}
        >
          {isSignUp ? 'Have an account? Sign in' : 'New here? Create an account'}
        </button>
      </form>
    </main>
  );
}

/** After a reset-password link: the person is signed in and picks a new password. */
export function NewPassword({ onDone }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ok = pw.length >= 8 && pw === pw2;
  return (
    <main className="auth">
      <div className="auth__brand"><Logo /></div>
      <form className="auth__form" noValidate onSubmit={async (e) => {
        e.preventDefault();
        if (!ok) return;
        setBusy(true); setError('');
        const { error: err } = await supabase.auth.updateUser({ password: pw });
        setBusy(false);
        if (err) setError(err.message); else onDone();
      }}>
        <h1 className="auth__title">Choose a new password</h1>
        <p className="auth__lead">You’re signed in. Pick a new password to use from now on.</p>
        <Field label="New password" hint="At least 8 characters.">
          <input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Field label="Repeat new password">
          <input className="input" type="password" autoComplete="new-password" enterKeyHint="go" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </Field>
        {pw2 && pw !== pw2 && <p className="form-error">Those passwords don’t match.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" disabled={busy || !ok}>{busy ? 'Saving…' : 'Save and continue'}</Button>
      </form>
    </main>
  );
}
