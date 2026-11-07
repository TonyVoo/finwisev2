# 30 - Cultivation ("tu tiên") appearance

A third appearance beside Light and Dark. Not a recolour: a visual language, a vocabulary and a small game layer, all
optional and all computed from what the person already records. Everything here applies only while the appearance is
chosen (`scheme === 'tutien'`); the other two are untouched.

## 1. What the references agree on

Found in xianxia games and tools (ink-wash scrolls with gold accents; translucent dark panels with thin gold borders;
thin progress bars with a mint-to-gold gradient; realm ladders tied to colour; background art kept as its own layer
under the interface) and in the genre's own grammar (realms with early / middle / late / peak stages, a core that
condenses in the dantian, seals, talismans, mist over mountains). Three rules follow:

1. **Atmosphere is a layer, content is a layer.** The scenery sits behind everything and never carries information;
   panels sit on it and carry all of it.
2. **Gold is rare.** Gold marks what is yours and what moves: titles, the active tab, the primary action, progress.
   Everything else is parchment on ink. If gold is everywhere it stops meaning anything.
3. **Progress is a realm, not a number.** A bar fills, a name changes, and the change is an event.

## 2. Language

| Element | Light/Dark app | Cultivation |
| --- | --- | --- |
| Ground | flat canvas | ink-wash scenery: night gradient, a gold moon, three ridges of mountains in jade-black, mist between them (one Skia canvas under every screen, static) |
| Titles | system sans | Noto Serif bold, gold, spaced; a gold rule with a diamond under them |
| Panels | white card | "scroll panel": translucent ink surface, gold hairline, small gold corner brackets |
| Primary button | solid fill | "seal": gold fill, serif label, inset hairline |
| Tab bar | line icons | seal-like icons (stone, yin-yang, compass, gate), active tab gold with a diamond beneath |
| Progress | plain bar | qi gauge: jade-to-gold gradient, a tick at each realm boundary |
| Empty state | icon in a circle | a crane over mountains, drawn |
| Loading | spinner | a turning yin-yang |
| Names | Expenses, Summary, Investing... | Linh thạch, Đạo cảnh, Thiên cơ, Động phủ... (headings only; never an amount, date or action) |

## 3. The game layer: tu vi (cultivation)

The person's own discipline, made visible. Computed on the device from their records; nothing is sent, nothing is
stored but the last realm shown (to notice a breakthrough).

**Đạo hạnh (points)** = days an expense was recorded (1 each) + months that ended with income above spending (15
each) + savings goals reached (50 each).

**Realms** (large realm, then Sơ / Trung / Hậu / Đỉnh kỳ, a quarter of the realm each):

| Realm | From | Realm | From |
| --- | --- | --- | --- |
| Luyện Khí | 0 | Nguyên Anh | 250 |
| Trúc Cơ | 30 | Hóa Thần | 500 |
| Kim Đan | 100 | Phi Thăng | 1000 |

The Home hero shows realm and stage, the qi gauge to the next stage, and the unbroken run of days with an entry ("bế
quan N ngày"). Crossing into a new realm shows a **breakthrough** once: a gold ring opens over the screen, a light
haptic, the realm's name; tap to continue. Savings goals borrow the same realm names by percent saved.

## 4. Rules that keep it honest

- Wording changes only names (headings, tab labels, empty-state titles). Money, dates, validation, destructive actions
  and errors keep their plain words (`tests/copy/tutien.test.ts`).
- Contrast is held to the same minimums as Dark (`tests/theme/tutienPalette.test.ts`); decoration is hidden from screen
  readers and never the only carrier of meaning.
- Motion is short, runs once or slowly, and is skipped when the person asked the system to reduce motion.
- No network, no new data collected, no gamified pressure: there is no penalty state, only a realm that does not go
  down.

## 5. Assets still wanted from an artist or an image model

The scenery and the crane are drawn in code (paths and gradients) so the appearance works with no asset pipeline. A
hand-painted backdrop, an app icon and splash in this style, and a brush-calligraphy face for the largest titles would
lift it further; the plugins offered alongside this change (Icon Creator, image-generation, Icons8, Streamline) are
for exactly those.
