import { useState, type FormEvent } from 'react';
import type { AdminUser } from './api.ts';

/** Deleting an account asks for its email, so a slip of the finger is not enough. */
export function ConfirmDelete({
  user,
  busy,
  onConfirm,
  onCancel,
}: {
  user: AdminUser;
  busy: boolean;
  onConfirm: (email: string) => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const matches = typed.trim().toLowerCase() === user.email.toLowerCase();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (matches) onConfirm(typed.trim());
  };

  return (
    <div className="scrim">
      <form
        className="card dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        onSubmit={submit}
      >
        <h2 id="delete-title">Delete {user.email}?</h2>
        <p>This deletes the account and everything it stored. It cannot be undone.</p>
        <label>
          Type their email to confirm
          <input autoFocus value={typed} onChange={(event) => setTyped(event.target.value)} />
        </label>
        <div className="actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="danger solid" disabled={!matches || busy}>
            Delete account
          </button>
        </div>
      </form>
    </div>
  );
}
