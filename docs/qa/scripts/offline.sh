#!/bin/sh
# Aeroplane mode on the emulator, the first of §2's three network mechanisms.
#
# Two steps, not one, and the second is the one that is easy to forget. `adb reverse`
# tunnels the host's port over the adb transport, which is USB/TCP to the *emulator
# process* and not the device's radio - so it survives aeroplane mode. A case that
# toggled the radio and left the tunnel up would have netinfo reporting unreachable
# while the server stayed reachable: the write syncs immediately and the case passes
# with nothing tested. That is the same vacuous-pass shape §2 records for Maestro's
# iOS `setAirplaneMode` and for `killApp`.
#
# Metro's tunnel (8081) is left up deliberately. It serves the dev channel, not the API,
# and dropping it makes Expo Go show "Cannot connect to Expo CLI" over the app under
# test (README, Notes).
#
# Honours QA_SERIAL, because the two-device cases (`F-TWO-DEV`) need each half toggled
# on its own: `SYNC-06` has D1 online while D2 is still in aeroplane mode.
#
#   sh docs/qa/scripts/offline.sh on|off
#   QA_SERIAL=emulator-5556 sh docs/qa/scripts/offline.sh on
set -e

ADB="adb"
if [ -n "$QA_SERIAL" ]; then ADB="adb -s $QA_SERIAL"; fi

case "$1" in
  on)
    $ADB shell cmd connectivity airplane-mode enable
    $ADB reverse --remove tcp:3000 2>/dev/null || true
    echo "offline: radio off, API tunnel removed"
    ;;
  off)
    $ADB shell cmd connectivity airplane-mode disable
    # Restored before the radio settles, so the first `connectivity` trigger after the
    # transition finds a route. SYNC-01's recorded caveat came from the other order:
    # the tunnel went back ~8s after the radio, the first attempt had no route, and the
    # resulting `Sync failed` could not be attributed.
    $ADB reverse tcp:3000 tcp:3001
    echo "offline: radio on, API tunnel restored"
    ;;
  *)
    echo "usage: offline.sh on|off" >&2
    exit 2
    ;;
esac
