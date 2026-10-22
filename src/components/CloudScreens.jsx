import { useState } from 'react';

const page = { minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 };
const card = { width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 12 };
const input = { font: 'inherit', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--surface)', color: 'var(--ink)', fontSize: 16 };

export function Splash({ children }) {
  return (
    <div style={page}>
      <div className="panel" style={card}>{children}</div>
    </div>
  );
}

export function Login({ onSignIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const error = await onSignIn(email.trim(), password);
    if (error) setErr(error);
    setBusy(false);
  };

  return (
    <div style={page}>
      <form className="panel" style={card} onSubmit={submit}>
        <h1>Sprint Control</h1>
        <div className="sub">Sign in to open your workspace.</div>
        <input style={input} type="email" autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required aria-label="Email" />
        <input style={input} type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required aria-label="Password" />
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {err && <div className="msg" style={{ color: 'var(--bad)' }}>{err}</div>}
      </form>
    </div>
  );
}

const count = (w) => w.projects.reduce((n, p) => n + p.sprints.reduce((m, s) => m + s.tasks.length, 0) + p.backlog.tasks.length, 0);

// Shown once, when the cloud workspace is empty: choose what to start with
export function CloudImport({ local, onStart, email, signOut }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const go = async (build) => {
    setBusy(true);
    setErr('');
    try {
      await onStart(build());
    } catch (e) {
      setErr('Could not save to the cloud: ' + (e && e.message ? e.message : 'unknown error'));
      setBusy(false);
    }
  };

  return (
    <Splash>
      <h1>Set up your cloud workspace</h1>
      <div className="sub">Signed in as {email}. Nothing is stored in the cloud yet.</div>
      {local ? (
        <>
          <div className="msg">
            This browser has saved work: {local.projects.length} project{local.projects.length === 1 ? '' : 's'} ({local.projects.map((p) => p.meta.name).join(', ')}) with {count(local)} work items.
          </div>
          <button className="btn primary" disabled={busy} onClick={() => go(() => local)}>{busy ? 'Importing…' : 'Import the work saved in this browser'}</button>
          <div className="msg">Use the browser and device where you normally work. Your data here stays untouched as a backup.</div>
        </>
      ) : (
        <div className="msg">No saved work found in this browser. If your real work is in another browser or device, sign in there and import from it.</div>
      )}
      <button className="btn" disabled={busy} onClick={() => go(() => null)}>Start with sample data</button>
      {err && <div className="msg" style={{ color: 'var(--bad)' }}>{err}</div>}
      <button className="btn" onClick={signOut}>Sign out</button>
    </Splash>
  );
}
