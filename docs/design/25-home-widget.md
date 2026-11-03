# 25 - Home-screen widget (Android)

A small widget: **today's total** and an **Add** button that opens Add expense. Android only; iOS would need a
WidgetKit extension and is not done.

## Pieces

- **`modules/home-widget`** - a local Expo module. `QuickAddWidgetProvider` is an `AppWidgetProvider` (3x1, resizable
  horizontally) drawn from a `RemoteViews` layout. The button and the card open `expensetracker://expense/new`, the
  link the app already answers to, so one tap lands on Add expense.
- **What the widget shows is written by the app**, already formatted in the account currency and language, into a private
  preferences file (`update(title, amount, add)`); the widget never reads the app's database.
- **`useWidgetSync`** (`src/widget/useWidgetSync.ts`) re-writes it whenever today's spending (`daySpendTotal`, income not
  counted), the currency or the language changes, and calls `clear()` when the signed-in app goes away, so a signed-out
  phone does not keep showing someone's spending.
- **Settings -> Add a home-screen widget** asks the launcher to offer it (`requestPinAppWidget`); where the launcher
  cannot, a message says how to add it by hand (long-press the home screen -> Widgets -> Expenses).

## Things to know

- The widget is on the home screen, **outside the app lock**: anyone holding the unlocked phone sees today's total. It
  appears only if the person adds it, and shows nothing else.
- It refreshes when the app writes (opening the app, adding an entry, a sync); it does not wake itself on a timer
  (`updatePeriodMillis=0`), so a day rolling over shows the new day after the app is next opened.
