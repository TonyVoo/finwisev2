# Real-device checklist

The simulator cannot show everything: real notifications arriving, a real Face ID, a real
camera, real offline behaviour, and how text fits a real screen. This list is what to check on
a phone, in the order that finds problems fastest. Tick as you go, and write down what you
actually saw next to anything that is not as described.

## Setup (once)

1. Phone and Mac on the **same Wi-Fi**. Install **Expo Go** (App Store / Play Store).
2. Restart the backend so it has the latest code (new migrations are applied on start):

   ```bash
   pnpm --filter @expense-tracker/backend run migrate:deploy && pnpm --filter @expense-tracker/backend run start
   ```

3. Start Metro with your Mac's LAN address (`ipconfig getifaddr en0`):

   ```bash
   cd mobile && EXPO_PUBLIC_API_BASE_URL=http://<your-lan-ip>:3000 npx expo start --lan --clear
   ```

4. Scan the QR code with the phone's camera (iOS) or Expo Go (Android).
5. `curl http://<your-lan-ip>:3000/v1/health` from the phone's browser should answer `ok`. If not,
   the Mac firewall is blocking port 3000.

Expo Go covers nearly everything below. The two exceptions need a development build and are
marked **(dev build)**.

## 1. Sign up and the basics

- [ ] Create an account. Land on an empty Home with a prompt about your categories.
- [ ] Add an expense with the keypad. It appears at once, with no spinner.
- [ ] Add one with a note and a **receipt photo** (camera and library both). Reopen it: the photo loads.
- [ ] Swipe an expense to delete it; **Undo** brings it back.
- [ ] Pull to refresh on Home and on Summary.

## 2. Offline (the app's main promise)

- [ ] Turn on **airplane mode**. Add, edit and delete expenses. The pill says offline with a count.
- [ ] Turn it off. The pill clears within a few seconds, and the expenses reach the server
      (check a second device, or `docker exec expense-pg psql -U expense -d expense_tracker -c "select count(*) from expenses"`).
- [ ] Offline, open **Add expense → Currency → EUR**: it says it could not get the rate and lets you type one.

## 3. Income, trend and insights

- [ ] Add **income**. It shows green with a `+`, and Home shows `Income … · Net …`.
- [ ] Summary shows the donut, the 6-month bars (blue income bar beside spending) and the Insights card.
- [ ] With spending in two months, the insights say "more/less than in {month}" with the right month name.

## 4. Budgets and notifications

- [ ] In **Categories**, give one a budget, then spend to 80% of it. Accept the notification
      permission prompt when it asks. An "alert" appears on Home and a **notification** arrives.
- [ ] Put the app in the background first: does the notification still show on the lock screen?
- [ ] Go over 100%: a second, "Over budget" notification arrives. Relaunching does not repeat it.

## 5. Recurring expenses and bill reminders

- [ ] Add a recurring expense that is due **the day after tomorrow**. Accept the notification prompt.
- [ ] Tomorrow at about 9:00 a "Due tomorrow" notification should arrive. (This is the one check that
      takes a day. Do it last, and note whether it arrived.)
- [ ] Edit the rule's start date: the old reminder must not still fire.

## 6. Savings goals

- [ ] Create a goal with a deadline. The row shows "Save X a month to reach it by …".
- [ ] Add money to it; the bar and percentage move. Reach the target: it shows "Goal reached".
- [ ] Delete it; check it also disappears on a second device after a sync.
- [ ] **Goal reminders** fire at 09:00 local. Save a goal with a deadline 2 days out and set the
      phone's clock to just before 09:00 the day before: expect "Goal due tomorrow" with
      "Name · X to go". A deadline 8 days out with the clock just before 09:00 a week ahead gives
      "Goal due in a week".
- [ ] Saving a goal **with a deadline** asks for notification permission once; a goal without one
      never does. Add money: the "to go" amount in the next reminder is lower. Reach the target or
      delete the goal: no reminder fires.

## 6b. Shared household

Needs **two phones** (or a phone and a simulator) signed in to **two different accounts**, and the
backend **restarted after pulling** (it adds three tables: `pnpm --filter backend migrate:deploy`).

- [ ] Phone A: Settings -> **Household** -> **Create a household**. The members list shows A as
      Owner and "You". Nothing about A's expenses changes.
- [ ] Phone A: **Invite someone** shows an 8-character code once, with **Share code**. The share
      sheet text includes the code.
- [ ] Phone B (its own account, with a few of its own expenses): Household -> **Join with a code**.
      A wrong code shows "That code is incorrect or has expired." and nothing changes.
- [ ] Phone B with an unsynced change (airplane mode, add an expense, back online *before* it syncs)
      is told to **sync first**; once synced, the correct code works.
- [ ] After joining, B sees **A's** books and currency; B's own expenses are gone from view.
      Add an expense on B: it appears on A after a sync, and the other way round.
- [ ] The same code does **not** work a second time, or after 48 hours.
- [ ] **Who added it:** in a household, each new expense on Home reads "... - Added by <name>" (the
      part of their email before the @), and "Added by you" on your own. Rows from before the
      household, and any row with no recorded author, show nothing extra. A solo account never sees
      the line. VoiceOver/TalkBack read it as part of the row.
- [ ] **Private expenses:** inside a household, the add/edit form has a **Keep private** switch (not shown to an
      account in no household). Phone B marks an expense private: **phone A never sees it** - not in the list,
      not in Summary or any total, not in search - while B sees it with a small lock and an "Includes ... private"
      line under the total, and VoiceOver says "private". B turns the switch off: it appears on A after a sync;
      B turns it back on: it disappears from A after a sync. A cannot edit, delete or open B's private expense.
- [ ] **Leaving takes private expenses along:** B leaves (or is removed, or the owner deletes the household): B's
      private expenses are now ordinary expenses in B's own books (under the same-named category or
      Uncategorized), and none of them appear in A's books. A member who deletes their account takes their
      private expenses with them.
- [ ] Airplane mode: the "Added by" lines still show (the names are kept on the phone).
- [ ] B: **Leave household**. B is back on its own books and currency, its own expenses are back, and
      A still has everything B added while in.
- [ ] A removes B while B is in: B's phone returns to its own books on its next sync (no crash, no
      A data left behind).
- [ ] **Create** asks first ("Your current expenses move into the household..."). After creating, A's
      Home is unchanged. Creating with unsynced changes is refused ("Sync your changes first").
- [ ] **Hand over:** A taps B's row -> **Make owner** -> confirm. A now sees **Leave household**; B sees
      Invite and Delete. Nothing disappears from either phone.
- [ ] A (the original creator) leaves after handing over: A's own books are fresh default categories and
      the history stays in the household. A can add an expense straight away.
- [ ] A cannot delete their account while others are in and they own it; after handing over, they can.
- [ ] **Delete household** (as the owner): the owner gets the shared books, merged into their own
      (same-named categories combined, no duplicates); everyone else is back on their own books.
- [ ] A cannot delete their account while B is in; the banner says to delete the household first.

## 7. App lock

- [ ] Settings → **App lock**: turning it on asks for Face ID / fingerprint, and refuses cleanly if
      the phone has none enrolled.
- [ ] Kill and reopen the app: it is covered by the lock screen and Face ID prompts by itself.
- [ ] Leave the app for under 30 s and return: it does **not** ask. Leave it for over 30 s: it asks.
- [ ] Cancel the prompt: the lock screen stays, with an **Unlock** button that works.
- [ ] Turning the lock **off** also asks for Face ID.

## 8. Multi-currency

- [ ] Add an expense in **EUR** (or another): the rate fills in, the converted amount shows, and Home
      lists the home-currency amount with the original underneath.
- [ ] Try **JPY** (no decimals): the keypad has no decimal key.
- [ ] Reopen a foreign expense: the original amount and the same rate come back.
- [ ] Export CSV (Settings): the file has the Original amount and Original currency columns.

## 9. Language (Vietnamese)

- [ ] Settings → **Language → Tiếng Việt**: every screen switches at once, and stays after a relaunch.
- [ ] Walk every screen, looking for **English left over** and for **text that is cut off or wraps
      badly** (Vietnamese runs longer than English). Note the screen for each.
- [ ] Dates read `tháng 10 năm 2026`; money reads `11,19 US$`; the keypad has a comma.
- [ ] Create a **new account** while in Vietnamese: the default categories are in Vietnamese.
- [ ] On a phone whose own language is Vietnamese, a fresh install starts in Vietnamese
      (Match system).
- [ ] **(dev build)** The camera / photo / Face ID permission prompts are in Vietnamese.
      Expo Go shows its own English prompts, so this cannot be checked there.

## 10. Look and feel (the polish pass)

Haptics and animation can only be judged by hand. Run this on a real phone.

- [ ] **Keypad:** each key gives a light tick and dips slightly under your finger, then springs back.
      The amount at the top gives a small pop as each digit lands or is deleted.
- [ ] **Save** an expense: a success buzz as the screen closes. **Swipe-delete** one: a warning buzz.
- [ ] Home: the month total counts up to its new value after you add or delete an expense.
- [ ] **Settings is the third tab** (gear icon) of the floating bar, with a large title and no back arrow;
      Home's header has no gear. Opening a row (Categories, Goals, Household...) pushes it full-screen with a
      back arrow that returns to the Settings tab. Log out at the bottom scrolls fully clear of the bar.
- [ ] **Search** is a screen of its own: tapping the magnifier on Home opens it with the keyboard up, a
      back arrow, category chips and a prompt. Typing finds expenses from any month with "N results - total";
      a result opens its editor; swipe-delete works with Undo; back returns to an unchanged Home.
- [ ] **Private filter in Search:** in a household a **Private** chip leads the category chips. Selecting it
      lists only your private expenses (with their locks) and the result total; tapping it again clears it.
      Outside a household there is no such chip.
- [ ] **Bulk private / shared:** in a household, tap the **Select expenses** button in the header of Home or
      Search. A bar appears reading "None selected" with a close button, **Make private** and **Make shared**
      (both greyed until something is picked), and a circle on your own rows. Tap your own expenses to pick
      them ("1 selected", "2 selected"); tapping again unpicks. The other person's expenses cannot be picked
      and do not open while picking. Only the close button ends it. **Make private** locks the picked ones and
      shows "N expenses are now private." with **Undo**; on the other phone they vanish after a sync.
      **Make shared** reverses it. Outside a household there is no Select button and a long press does nothing.
- [ ] **Bulk selection, the other ways in:** long-pressing one of your own expenses starts the same selection
      with that one picked; with VoiceOver/TalkBack the row's actions include **Select expense**. If the long
      press does not start a selection on a device, say so: in the iOS simulator it started reliably only some
      of the time, and this has not been seen on hardware.
- [ ] **Display name:** Settings -> **Display name** -> type a name -> Save. The row shows it. In a household,
      the Members list, the member action sheet, the hand-over and remove dialogs and the "Added by" line on
      expenses all use that name instead of the start of the email; a member with no name still shows the
      email's start. Emptying the field and saving goes back to that. Offline: "You need to be online...".
- [ ] **Tab bar styles:** Settings -> **Tab bar** offers Compact, Wide and With labels; each applies at once, is
      remembered after a restart, and keeps Home, Summary and Settings clear of it. With labels every tab is named.
- [ ] **Floating tab bar:** a capsule floats above the bottom edge (clear of the home indicator), with the
      active tab showing icon and label on a highlight and the other as an icon alone. Switching gives a
      light tick; the last row of Home and the last card of Summary scroll fully clear of it, and the add
      button sits above it. Works in dark mode and with large text.
- [ ] Home, current month: a row of daily bars under the total, and an **On pace for ... this month**
      line once something is spent. Neither shows for a past month's pace line.
- [ ] Category badges show an **icon** on every list: expenses, the category picker, Categories,
      Recurring and the Summary legend. Check a Vietnamese-named category (e.g. Tạp hóa) gets a cart.
- [ ] Savings goals: each goal has a target badge (a green check once reached). **Add** money and
      watch the bar ease to its new width, with a success buzz.
- [ ] Turn on **Reduce Motion** (iOS: Accessibility → Motion; Android: Remove animations): the keypad
      spring, amount pop, count-up and goal bar all stop moving. Haptics still fire.
- [ ] Turn haptics off (iOS: Sounds & Haptics → System Haptics): nothing breaks, saves still work.
- [ ] **Welcome screen** (log out first): the logo, app name and tagline fade and rise in once.
      With Reduce Motion on, they appear at once.
- [ ] **Failed login or signup:** an empty form, or a wrong password, gives a warning buzz as the
      error appears.
- [ ] **VoiceOver / TalkBack** on Home, current month: after the total is read, "On pace for ... this
      month" is read as a hint. Settings rows and category badges are skipped, not read as "image".
- [ ] **Settings:** every row has an icon, hints wrap fully instead of ending in "...", and Delete
      account has a red icon (scroll down to see it).
- [ ] **Empty states:** a new account's Savings goals and Recurring expenses show an icon above the
      headline.
- [ ] **Rename offer (Vietnamese):** on an account created in English, switch the language to
      Tiếng Việt: a one-time offer to rename the untouched default categories appears. Accepting
      renames only those you had not changed, and it syncs to a second device. Declining never asks again.

## 10b. Reading a receipt

Needs a backend started with `OCR_SPACE_API_KEY` (free key) or `GOOGLE_VISION_API_KEY` (see `backend/.env.example`). Without either, skip to the last step.

- [ ] Add expense -> **Receipt** -> **Take photo** (a real receipt, flat and well lit). Reopen the **Receipt** row:
      **Read receipt** is there, with a line saying the photo is sent to our server. Nothing was sent before you tapped it.
- [ ] Tap **Read receipt**: the button shows progress, the sheet closes, and a card **From the receipt** shows
      what was found (amount - date - shop). **No field has changed yet.**
- [ ] **Use** fills the amount, the date, the note (only if it was empty) and a category (only if you have the
      matching default one). Check the amount against the paper: this is where a misread shows. Nothing is saved until **Save**.
- [ ] **Dismiss** leaves everything as it was. Taking another photo or removing the photo discards the card.
- [ ] Try a blurry photo, a crumpled one and a non-receipt: you should get "Nothing could be read..." or a card
      with only some fields, never a confident wrong total you cannot see.
- [ ] Airplane mode -> **Read receipt**: "Could not read that receipt. Enter the details yourself.", form untouched.
- [ ] Backend without a key: tapping **Read receipt** says "Reading receipts isn't available right now." and
      the button is gone for the rest of the session (it returns after a restart).

## 11. Both platforms

Do sections 1, 2, 4, 7, 9 and 10 on **iOS and Android** if you have both. Things that differ most:
notification permission timing, the biometric prompt, the keyboard over the sheets, and the
status bar and safe-area spacing.

## What to report

For each failure: the section and line, what you saw, a screenshot if visual, and whether it
reproduces after a restart. Visual problems at the largest text size (Settings → Display → Text
size) are worth one pass of their own.
