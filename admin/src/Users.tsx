import { useState, type FormEvent } from 'react';
import type { AdminUser } from './api.ts';
import { number, when } from './format.ts';

export function Users({
  users,
  hasMore,
  onSearch,
  onMore,
  onToggle,
  onDelete,
}: {
  users: AdminUser[];
  hasMore: boolean;
  onSearch: (text: string) => void;
  onMore: () => void;
  onToggle: (user: AdminUser) => void;
  onDelete: (user: AdminUser) => void;
}) {
  const [text, setText] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearch(text.trim());
  };

  return (
    <>
      <form className="search" onSubmit={submit} role="search">
        <input
          type="search"
          placeholder="Search by email"
          aria-label="Search by email"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit">Search</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Joined</th>
              <th>Last active</th>
              <th>Expenses</th>
              <th>Households</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  {user.email}
                  {user.displayName === null ? '' : ` (${user.displayName})`}
                  {user.isAdmin ? <span className="badge">admin</span> : null}
                  {user.disabledAt === null ? null : <span className="badge off">disabled</span>}
                </td>
                <td>{when(user.createdAt)}</td>
                <td>{when(user.lastActiveAt)}</td>
                <td>{number(user.expenseCount)}</td>
                <td>{number(user.householdCount)}</td>
                <td>
                  {user.isAdmin ? null : (
                    <div className="actions">
                      <button type="button" onClick={() => onToggle(user)}>
                        {user.disabledAt === null ? 'Disable' : 'Enable'}
                      </button>
                      <button type="button" className="danger" onClick={() => onDelete(user)}>
                        Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {users.length === 0 ? <p className="muted">No accounts match.</p> : null}
      {hasMore ? (
        <p>
          <button type="button" onClick={onMore}>
            Load more
          </button>
        </p>
      ) : null}
    </>
  );
}
