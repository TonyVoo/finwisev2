import { useCallback, useMemo, useRef, useState } from 'react';
import { createClient, type Client } from './api.ts';
import { Dashboard } from './Dashboard.tsx';
import { SignIn } from './SignIn.tsx';

interface Session {
  adminEmail: string;
}

/**
 * The admin page (`docs/design/17-admin.md`). It holds no data of its own: everything it shows comes from the
 * admin API after signing in, and the token lives in a ref, so it is never written to storage and closing the
 * tab signs out.
 */
export function App({ client: injected }: { client?: Client } = {}) {
  const token = useRef<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [note, setNote] = useState('');
  const client = useMemo(() => injected ?? createClient(() => token.current), [injected]);

  const signedIn = useCallback((value: { token: string; adminEmail: string }) => {
    token.current = value.token;
    setNote('');
    setSession({ adminEmail: value.adminEmail });
  }, []);

  const signOut = useCallback((message: string) => {
    token.current = null;
    setNote(message);
    setSession(null);
  }, []);

  return session === null ? (
    <SignIn client={client} note={note} onSignedIn={signedIn} />
  ) : (
    <Dashboard client={client} adminEmail={session.adminEmail} onSignOut={signOut} />
  );
}
