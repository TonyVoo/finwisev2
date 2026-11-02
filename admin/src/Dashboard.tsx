import { useCallback, useEffect, useState } from 'react';
import { SessionEnded, type AdminUser, type Client, type Overview as OverviewData } from './api.ts';
import { ConfirmDelete } from './ConfirmDelete.tsx';
import { Mark } from './Mark.tsx';
import { Overview } from './Overview.tsx';
import { Users } from './Users.tsx';

export function Dashboard({
  client,
  adminEmail,
  onSignOut,
}: {
  client: Client;
  adminEmail: string;
  onSignOut: (message: string) => void;
}) {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [busy, setBusy] = useState(false);

  /** Run a call; a finished session returns to sign-in, any other failure shows its message. */
  const guard = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
      try {
        const result = await work();
        setError('');
        return result;
      } catch (failure) {
        if (failure instanceof SessionEnded) onSignOut(failure.message);
        else setError(failure instanceof Error ? failure.message : 'That did not work.');
        return undefined;
      }
    },
    [onSignOut],
  );

  const loadOverview = useCallback(async () => {
    const data = await guard(() => client.overview());
    if (data !== undefined) setOverview(data);
  }, [client, guard]);

  const loadUsers = useCallback(
    async (text: string, after: string | null) => {
      const page = await guard(() => client.users({ search: text, cursor: after }));
      if (page === undefined) return;
      setUsers((current) => (after === null ? page.users : [...current, ...page.users]));
      setCursor(page.nextCursor);
    },
    [client, guard],
  );

  useEffect(() => {
    void loadOverview();
    void loadUsers('', null);
  }, [loadOverview, loadUsers]);

  async function toggle(user: AdminUser) {
    const updated = await guard(() => client.setDisabled(user.id, user.disabledAt === null));
    if (updated === undefined) return;
    setUsers((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    void loadOverview();
  }

  async function confirmDelete(email: string) {
    if (deleting === null) return;
    setBusy(true);
    const target = deleting;
    const done = await guard(async () => {
      await client.remove(target.id, email);
      return true;
    });
    setBusy(false);
    setDeleting(null);
    if (done === undefined) return;
    setUsers((current) => current.filter((row) => row.id !== target.id));
    void loadOverview();
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <Mark />
            Expenses
            <span className="tag">Admin</span>
          </div>
          <div className="spacer" />
          <span className="who">{adminEmail}</span>
          <button
            type="button"
            className="small"
            onClick={() => {
              void loadOverview();
              void loadUsers(search, null);
            }}
          >
            Refresh
          </button>
          <button type="button" className="small" onClick={() => onSignOut('')}>
            Sign out
          </button>
        </div>
      </header>

      <main>
        <h1 className="page-title">Overview</h1>

        {error === '' ? null : (
          <p className="error" role="alert" style={{ marginTop: 12 }}>
            {error}
          </p>
        )}

        <div className="section" style={{ marginTop: 16 }}>
          {overview === null ? <p className="muted">Loading…</p> : <Overview data={overview} />}
        </div>

        <div className="section">
          <div className="section-head">
            <h2 className="section-title">Accounts</h2>
          </div>
          <Users
            users={users}
            hasMore={cursor !== null}
            onSearch={(text) => {
              setSearch(text);
              void loadUsers(text, null);
            }}
            onMore={() => void loadUsers(search, cursor)}
            onToggle={(user) => void toggle(user)}
            onDelete={setDeleting}
          />
        </div>
      </main>

      {deleting === null ? null : (
        <ConfirmDelete
          user={deleting}
          busy={busy}
          onConfirm={(email) => void confirmDelete(email)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}
