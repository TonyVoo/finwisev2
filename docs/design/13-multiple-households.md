# 13 - More than one household

_Built: all five steps. Device checks are in `docs/qa/DEVICE_CHECKLIST.md` section 6c._

Today a person is in at most one household, and being in one means working in its books and nothing
else (`10-households.md`). This lets a person be in several, and keeps their own books too. Decided
with the product owner:

- **One active book at a time, with a switcher.** The phone holds one book and you switch between
  them, like switching workspaces. Switching clears and re-syncs, as joining or leaving does today.
- **A personal space beside the households.** Everyone always has their own private book; households
  are extra. Joining a household never touches the personal book, and you choose which space you are in.
- **Join with a code without leaving the others.** The invite flow is unchanged, but joining no longer
  fails because you are already in one.

## The one idea

A **space** is a book you can work in: your own (`id` = your account id) or a household's (`id` = its
`scope_id`). The server already scopes every row by one id, so a space is just _which_ id a request works
in. Nothing about how rows are stored, revisioned, synced or pruned changes.

What changes is how a request names its space. Today the token's single membership decides it. Now
the phone says, per request, with a header:

```
X-Space-Id: <space id>
```

- **Stateless.** The server remembers nothing about "which space you are in", so two devices of one
  account can be in different spaces, and a retried request cannot land in the wrong book.
- **Validated every time.** The id must be the caller's own account id or the `scope_id` of a household
  they belong to; anything else is `404 not_found`, the same answer as for an id that does not exist, so
  spaces cannot be probed.
- **Absent means what it meant before.** No header: a person in exactly one household works in it (so an
  older app keeps working untouched), anyone else works in their personal space. New apps always send it.

`req.userId` is still who you are and `req.dataOwnerId` is still whose rows; only how `dataOwnerId` is
found changes (`middleware/requireAuth.ts`).

## What a space looks like on the wire

`GET /v1/me` gains `spaces`, in a stable order (personal first, then households by when you joined):

```json
{
  "spaces": [
    { "id": "<account id>", "kind": "personal", "name": null, "currency": "USD" },
    {
      "id": "<scope id>",
      "kind": "household",
      "householdId": "...",
      "name": "Home",
      "role": "owner",
      "currency": "VND"
    }
  ]
}
```

`dataOwnerId` stays the active space's id (as resolved from the header or the default above), and
`user.currency` is the active space's currency, as it already is while in a household. The existing
`household` field becomes "the household of the active space, or null", so older apps read the same thing.

A household gets a **name** (`households.name`, 1-40 characters, defaulting to "Household") so people can tell
them apart. The owner can rename it.

## Rules that change

| Today                                                                    | Now                                                                                                                                                                            |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `household_members.user_id` is unique: one household per person          | Dropped. The key is `(household_id, user_id)`. A person may be in up to **10** (a safety bound on `/v1/me` and the switcher, raised easily); the 11th is `409 household_limit` |
| `households.owner_id` is unique: one owned household                     | Dropped. A person may own several                                                                                                                                              |
| Creating moves the creator's current rows into the new book              | **Creating makes an empty household.** Personal data stays personal. (Copying personal data in is out of scope for now)                                                        |
| Joining requires being in none (`household_exists`)                      | Joining requires only not already being a member of _that_ one (`409 already_member`). `household_exists` is retired                                                           |
| A person's old books are parked while in a household                     | The personal space is always there and always switchable                                                                                                                       |
| Leaving or removal hands private expenses back to the person's own books | Same, and "their own books" is now simply the personal space                                                                                                                   |
| Deleting a household merges the shared books into the owner's books      | Unchanged: the shared rows are merged into the owner's **personal** space and the others return to theirs. The confirm dialog says so                                          |
| An owner with other members cannot delete their account                  | The same, for _any_ household they own: the error names how many                                                                                                               |

Everything else in `10-households.md` and `12-settle-up.md` holds per household: roles, transfer, invite
codes (one live code per household), private expenses, `paidBy`, settlements, balances. Each household has
its own currency, members and balances, and balances never span spaces.

## API

Management is addressed by household id, so you can act on a household you are not currently working in
(leave one from the list while in your personal space):

| Operation               | Route                                              | Who                                              |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------ |
| `listHouseholds`        | `GET /v1/households`                               | anyone: every household you are in, with members |
| `createHousehold`       | `POST /v1/household` `{ name? }`                   | anyone, up to the limit                          |
| `joinHousehold`         | `POST /v1/household/join` `{ code }`               | anyone, up to the limit                          |
| `renameHousehold`       | `PATCH /v1/households/{id}` `{ name }`             | owner                                            |
| `deleteHousehold`       | `DELETE /v1/households/{id}`                       | owner                                            |
| `createHouseholdInvite` | `POST /v1/households/{id}/invite`                  | owner                                            |
| `leaveHousehold`        | `POST /v1/households/{id}/leave`                   | member (not owner)                               |
| `removeHouseholdMember` | `DELETE /v1/households/{id}/members/{memberId}`    | owner                                            |
| `transferHousehold`     | `POST /v1/households/{id}/transfer` `{ memberId }` | owner                                            |

The old single-household routes (`/v1/household`, `.../invite`, `.../leave` and so on) stay and act on "the
caller's household" while the caller is in exactly one, so an older app keeps working; they answer
`409 household_ambiguous` for someone in several. They are deprecated and removed once the old app is gone.

## On the phone

- **The store holds one space**, as it does now (`meta.dataScope`). It also keeps the **spaces list** from
  `/v1/me`, so the switcher can show them offline.
- **Switching is `reconcileDataScope` with a chosen target** instead of the server's answer: the same wipe,
  resync and members refresh. It is refused with the same message while changes are waiting to sync, and needs
  the network, since the new space's rows are not on the phone. Offline, the switcher lists spaces but says so.
- **Every request sends `X-Space-Id`** for the active space (the API client's transport). If the server says
  that space is gone (`404`: removed, or the household was deleted) the phone falls back to the personal space
  and reconciles, instead of showing an error forever.
- **Reminders and budget alerts follow the active space**: local notifications are cancelled and rescheduled on
  a switch, so a bill reminder from a household you have left the screen of does not fire from the wrong space.
- **The active space is remembered** per device, so a cold start returns to where you were; the very first
  launch after the upgrade defaults to the household a person is already in, so nothing looks different.

### Screens

- **Home header** gets a space chip: the active space's name (_Personal_, _Home_...) with a chevron. Tapping it
  opens the **switcher**, a sheet listing spaces with a check on the active one, and _Manage households_.
  A solo account that has never joined one sees no chip at all.
- **Settings -> Household** becomes **Households**: a list (name, role, member count) plus _Create_ and _Join
  with a code_. A row opens the household's screen, which is today's Household screen scoped to that household,
  with its name, a _Rename_ action for the owner, and _Switch to this household_.
- **Create** asks for a name and says what will happen: a new, empty household; your own expenses stay yours.
- Everything inside a space (Home, Summary, Search, balances) is unchanged: it shows the active space.

## Consequences, stated plainly

- **Spaces never mix.** There are no totals across households, and an expense cannot be moved between spaces.
  To record something in two places, add it in each.
- **Switching needs the network and an empty queue.** That is the price of holding one book at a time; the
  alternative (all books offline) is deliberately not built.
- **Existing households are untouched.** Rows stay where they are; people who joined under the old rules find
  their old personal data waiting in the personal space, because it was never moved.
- **A creator's data that was moved in under the old rules stays in the household.** There is no way to take it
  back out; said in the release notes.
- **"Currency" is per space.** A personal space in one currency and a household in another is fine; every
  amount already carries its space's currency.

## Build order

Each step ships on its own, with tests first:

1. **Server model and resolution.** Migration (drop the two unique constraints, add `households.name`),
   `X-Space-Id` resolution and validation, `spaces` on `/v1/me`, and `409 household_ambiguous` on the older
   single-household routes for a person in several. Old routes keep working for one-household people, and
   "at most one household" is still enforced by the create and join routes (under a per-person lock, now that
   no unique index does it) until step 2 lifts it. The limit of 10 and the `household_limit` / `already_member`
   errors arrive with that step, where they first become reachable.
   _A household made before households had books of their own is scoped by its owner's account id, so its owner has
   no separate personal space: `spaces` lists it once, as the household, and the personal id selects it._
2. **Household management by id.** The `/v1/households/{id}` family, `GET /v1/households`, rename, and the
   changed create/join/delete/account-deletion rules, with the old routes as aliases.
3. **Phone core.** Spaces list in the store, the header on every request, a chosen-target `reconcileDataScope`,
   the fall-back to personal, reminder rescheduling.
4. **Screens.** The chip and switcher, the Households list, create-with-name, rename, switch.
5. **Compatibility and QA.** Run the old-app paths against the new server, the migration on a copy of real
   data, and the device checklist for a person in two households.

## Not in this version

Seeing several spaces at once, totals or search across spaces, moving or copying expenses between spaces,
copying personal data into a new household, per-space notification settings, holding every space offline,
a per-person cap other than the safety limit, and transferring a household's currency.
