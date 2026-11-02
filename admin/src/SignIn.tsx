import { useState, type FormEvent } from 'react';
import type { Client } from './api.ts';
import { Mark } from './Mark.tsx';

export function SignIn({
  client,
  note,
  onSignedIn,
}: {
  client: Client;
  note: string;
  onSignedIn: (value: { token: string; adminEmail: string }) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onSignedIn(await client.login(email, password));
    } catch (failure) {
      setPassword('');
      setError(
        failure instanceof Error && failure.name === 'ApiFailure'
          ? failure.message
          : 'Could not reach the server. It may be waking up; try again in a minute.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signin-wrap">
      <form className="card signin" onSubmit={(event) => void submit(event)}>
        <Mark className="mark" />
        <h1>Expenses admin</h1>
        <p className="lede">Sign in with your admin account.</p>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error !== '' || note !== '' ? (
          <p className="error" role="alert">
            {error || note}
          </p>
        ) : null}
        <button className="primary" type="submit" disabled={busy}>
          Sign in
        </button>
      </form>
    </div>
  );
}
