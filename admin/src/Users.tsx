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
      <div className="card list">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th className="hide-narrow">Joined</th>
                <th className="hide-narrow">Last active</th>
                <th className="right">Expenses</th>
                <th className="right hide-narrow">Households</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="person">
                      <div className="avatar" aria-hidden="true">
                        {user.email.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="name">{user.email}</div>
                        <div className="sub">
                          {user.displayName === null ? null : (
                            <span className="muted">{user.displayName}</span>
                          )}
                          {user.isAdmin ? <span className="pill info">admin</span> : null}
                          {user.disabledAt === null ? null : (
                            <span className="pill warn">disabled</span>
                          )}
                          {user.emailVerified ? <span className="pill on">verified</span> : null}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="nowrap hide-narrow">{when(user.createdAt)}</td>
                  <td className="nowrap hide-narrow">{when(user.lastActiveAt)}</td>
                  <td className="right num">{number(user.expenseCount)}</td>
                  <td className="right num hide-narrow">{number(user.householdCount)}</td>
                  <td>
                    {user.isAdmin ? null : (
                      <div className="actions">
                        <button type="button" className="small" onClick={() => onToggle(user)}>
                          {user.disabledAt === null ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          type="button"
                          className="small danger"
                          onClick={() => onDelete(user)}
                        >
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
        {users.length === 0 ? <p className="empty">No accounts match.</p> : null}
      </div>
      {hasMore ? (
        <p className="more">
          <button type="button" onClick={onMore}>
            Load more
          </button>
        </p>
      ) : null}
    </>
  );
}
