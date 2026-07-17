// Password wall. The server decides: when APP_PASSWORD is unset (local dev)
// /api/me always succeeds and the gate never shows.

import { useEffect, useState } from 'react';
import { ListGlyph } from './icons';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/me')
      .then(r => setAuthed(r.ok))
      .catch(() => setAuthed(true)); // server down → let the app show its own errors
  }, []);

  const login = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) setAuthed(true);
      else setError('Wrong password.');
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  };

  if (authed === null) return null;
  if (authed) return <>{children}</>;

  return (
    <div className="h-full flex items-center justify-center px-6">
      <div className="w-full max-w-xs">
        <div className="flex items-center gap-3 mb-6">
          <span className="w-11 h-11 rounded-xl bg-coral text-white flex items-center justify-center -rotate-6 shadow-lg shrink-0">
            <ListGlyph size={24} />
          </span>
          <div>
            <p className="font-display font-semibold tracking-tight text-lg leading-tight">
              Mohammed's Builder
            </p>
            <p className="text-weak text-xs">Enter the password to continue</p>
          </div>
        </div>
        <input
          autoFocus
          type="password"
          value={password}
          onChange={e => { setPassword(e.target.value); setError(null); }}
          onKeyDown={e => e.key === 'Enter' && login()}
          placeholder="Password"
          className="w-full bg-raised border border-line rounded-lg px-3 py-2.5 text-sm"
        />
        {error && <p className="text-danger text-sm mt-2">{error}</p>}
        <button
          onClick={login}
          disabled={busy || !password}
          className="w-full mt-3 bg-accent text-white text-sm font-medium rounded-lg py-2.5 disabled:opacity-40"
        >
          {busy ? 'Checking…' : 'Enter'}
        </button>
      </div>
    </div>
  );
}
