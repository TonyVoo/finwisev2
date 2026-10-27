# 10 - Shared households

Two or more people keep one set of books. Decided with the product owner:

- **One shared pot.** Expenses, income, categories, budgets, recurring rules and goals live in one
  set that every member sees and edits.
- **Join by invite code.** No email service needed.
- **Creating a household moves your data in; joining leaves your old data private.**
- **Owner and members.** Members add and edit everything; only the owner removes members,
  issues invite codes or deletes the household. A member can leave.

## How it works (the one idea)

Every synced row is already scoped by one id (`user_id`). A household reuses **the owner's user
id as the shared scope**:

- A request has two ids. The **identity** is who you are (from the access token) and never
  changes. The **data scope** is whose rows you read and write: your own id, or - while you are a
  member of a household - the **owner's** id.
- Creating a household therefore moves nothing: the creator's rows are already under their id.
- Joining switches a member's data scope to the owner's. The member's own rows stay where they
  are, untouched and invisible, and reappear if they leave or the household is deleted.
- Sync needs no change in kind: members share the owner's revision counter and tombstone
  horizon, so they all read the same change stream.

### Consequences, stated plainly

- **The household's currency is the owner's.** A member's own currency is unused while they are in.
- **The owner cannot leave.** Their id *is* the scope. They can delete the household instead:
  every member returns to their own private data, and the shared data stays with the owner.
- **The owner cannot delete their account while others are in the household** (it would delete
  the shared data). They delete the household first.
- **A device switches scope by clearing its local store and resyncing**, which the app already
  does whenever the signed-in data owner changes. Unsynced local changes are pushed first, or the
  switch is refused with a clear message.

## Data model

- `households`: `id`, `owner_id` (unique, FK users), `created_at`.
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

`GET /v1/me` also returns `dataOwnerId`, so a device knows which scope its local store holds.

Errors: `household_exists` (already in one), `not_in_household`, `household_owner_only`,
`owner_cannot_leave`, `invalid_invite_code` (wrong, expired or used - one answer for all, so a
guesser learns nothing), `household_has_members` (account deletion blocked).

## Mobile

Settings gets a **Household** row. With no household: *Create a household* and *Join with a code*.
In one: the members and roles; the owner can generate an invite code (shown once, shareable) and
remove members or delete the household; a member can leave. Joining, leaving, removal and deletion
all end in the same place: the local store is cleared and resynced under the new scope.

## Not in this version

Per-expense "added by" attribution, transferring ownership, more than one household per person,
and per-member private expenses.
