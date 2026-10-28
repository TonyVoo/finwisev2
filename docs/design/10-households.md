# 10 - Shared households

Two or more people keep one set of books. Decided with the product owner:

- **One shared pot.** Expenses, income, categories, budgets, recurring rules and goals live in one
  set that every member sees and edits.
- **Join by invite code.** No email service needed.
- **Creating a household moves your data in; joining leaves your old data private.**
- **Owner and members.** Members add and edit everything; only the owner removes members,
  issues invite codes or deletes the household. A member can leave.

## How it works (the one idea)

Every synced row is already scoped by one id (`user_id`). A household gets **a book of its own**:
a hidden account-like record (`households.scope_id`) that no one can sign in to, and every shared
row is scoped by *its* id.

- A request has two ids. The **identity** is who you are (from the access token) and never
  changes. The **data scope** is whose rows you read and write: your own id, or - while you are a
  member of a household - the household's book.
- **Creating** a household moves the creator's current rows into the new book, in one
  transaction, keeping their revisions (the book's counter continues from theirs). From then on
  the books belong to the household, not to a person.
- **Joining** switches a member's data scope to the book. Their own rows stay where they are,
  untouched and invisible, and reappear if they leave or the household is deleted.
- **Transferring** ownership changes only a role: nothing moves, because the rows were never
  the owner's. That is the reason for a book of its own - the previous design stored the books
  under the owner's account, so handing the household over would have meant moving rows into an
  account that already has books of its own.
- Sync needs no change in kind: members share the book's revision counter and tombstone horizon,
  so they all read the same change stream.

### Consequences, stated plainly

- **The household's currency is fixed when it is created** (the creator's), whoever owns it later.
- **The creator's old private books live in the household now.** If they later leave (after
  transferring ownership) they start from fresh default categories; the history stays with the
  household. Said in the confirm dialog.
- **The owner cannot leave.** They transfer ownership first, then leave.
- **Deleting the household gives the shared books to the owner**, merged into whatever books they
  already have: categories with the same name are combined (case-insensitively), the rest are
  added, and every moved row gets a fresh revision. Everyone else goes back to their own books.
- **An owner cannot delete their account while others are in the household.** They transfer
  ownership or delete the household first. A sole owner who deletes their account deletes the
  household with it.
- **A device switches scope by clearing its local store and resyncing**, which the app already
  does whenever the data scope changes. Unsynced local changes are refused on the device that
  acts (create, join, leave, delete) and discarded on a device that merely finds out.

## Data model

- `households`: `id`, `owner_id` (unique, FK users - the owner *role*), `scope_id` (unique, FK
  users - the book; an account-like row with no sign-in), `created_at`.
- `household_members`: `household_id`, `user_id` (unique - one household per person),
  `role` (`owner` | `member`), `joined_at`. The owner is a member row too.
- `household_invites`: one live code per household: `household_id` (unique), `code_hash`
  (unique, HMAC), `expires_at`, `created_at`. Codes are 8 characters from an alphabet without
  look-alikes, valid 48 hours, single use, and a new code replaces the old.

## API

All authenticated. The household is addressed by the token, never by an id in the URL.

| Operation | Route | Who |
| --- | --- | --- |
| `getHousehold` | `GET /v1/household` | anyone (`household: null` if none) |
| `createHousehold` | `POST /v1/household` | a person in no household |
| `deleteHousehold` | `DELETE /v1/household` | owner |
| `createHouseholdInvite` | `POST /v1/household/invite` | owner |
| `joinHousehold` | `POST /v1/household/join` `{ code }` | a person in no household |
| `leaveHousehold` | `POST /v1/household/leave` | member (not owner) |
| `removeHouseholdMember` | `DELETE /v1/household/members/{memberId}` | owner |
| `transferHousehold` | `POST /v1/household/transfer` `{ memberId }` | owner |

`GET /v1/me` also returns `dataOwnerId`, so a device knows which scope its local store holds.

`transferHousehold` makes a member the owner and the caller a member; the target must be another
member of the same household (`404 not_found` otherwise, and `400 validation_error` for the caller).

Errors: `household_exists` (already in one), `not_in_household`, `household_owner_only`,
`owner_cannot_leave`, `invalid_invite_code` (wrong, expired or used - one answer for all, so a
guesser learns nothing), `household_has_members` (account deletion blocked).

## Mobile

Settings gets a **Household** row. With no household: *Create a household* and *Join with a code*.
In one: the members and roles; the owner can generate an invite code (shown once, shareable) and
remove members or delete the household; a member can leave. Joining, leaving, removal and deletion
all end in the same place: the local store is cleared and resynced under the new scope.

## Private expenses

An expense can be marked **private**. Inside a household only its author sees it, and it is left
out of everyone else's lists, totals and budgets. The author sees it in their own, marked with a
lock.

- **Stored in the household book**, with `private` and the existing `createdBy`. Nothing about
  where rows live changes.
- **Hidden by redaction, not omission.** To everyone but the author a private expense arrives as a
  **deleted placeholder**: same id, category link and revision, but amount 0, no note, no author, a
  fixed date, and `deletedAt` set. Leaving the row out would put a gap in the revision stream, and
  would never tell a phone that already held the expense to drop it. A placeholder does both: it
  hides it, it removes it from phones when it is made private later, and it brings it back when it
  is made shared again - one mechanism for all three.
- **Only the author** can read, edit, delete or attach a receipt to it, and only the author can
  change whether it is private. Anyone else gets the same `404` as for an id that does not exist
  (REST) or a per-record `invalid` (sync).
- **A person's private expenses leave with them.** On leaving, being removed, or the household being
  deleted, each moves to their own books, filed under their category of the same name or
  Uncategorized, and stops being private. They are never merged into the owner's books. An account
  deleted while in a household takes its private expenses with it.
- **Totals.** The author's phone holds the real rows, so their totals and budgets include them, with
  a line saying how much of the month is private. Other members never receive the content, so
  nothing of it can reach their figures.

Not offered outside a household: nobody else sees a solo account's books, so the toggle is hidden.

## Not in this version

More than one household per person, and per-member private expenses.
