import { useState } from 'react';
import { SyncPill } from './SyncPill';
import { SyncSheet } from './SyncSheet';
import { useSync } from './SyncProvider';

/**
 * The pill and the sheet it opens, wired to the running engine.
 *
 * What the app bars on Home and Summary put in their trailing slot - and the only thing
 * either screen knows about sync. `docs/design/02-offline-and-sync.md` §3 puts the pill on
 * those two screens and nowhere else: not on pushed screens, not on sheets, not on the
 * auth screens, because it is the single place the app talks about connectivity and
 * repeating it everywhere would make it furniture nobody reads.
 *
 * The open/closed state is local to this component rather than lifted into the provider.
 * Two tabs each render one of these, and the sheet belongs to the tab the user tapped: a
 * shared flag would open it on both.
 */
export function SyncIndicator() {
  const { engine, status } = useSync();
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <SyncPill inputs={status} onPress={() => setSheetOpen(true)} />
      <SyncSheet
        visible={sheetOpen}
        status={status}
        onClose={() => setSheetOpen(false)}
        onRetry={engine.sync}
      />
    </>
  );
}
