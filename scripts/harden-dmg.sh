#!/usr/bin/env bash
# Applies the real macOS Finder "invisible" attribute (SetFile -a V) to every
# top-level item in a built .dmg EXCEPT the .app bundle and the /Applications
# alias, so no internal dmg-builder resource (background image, .DS_Store,
# .VolumeIcon.icns, etc.) shows up as a stray icon when a user has Finder's
# "Show Hidden Files" (Cmd+Shift+.) toggled on.
#
# SetFile -a V sets the classic FinderInfo "kIsInvisible" bit. Unlike a
# leading-dot filename or the UF_HIDDEN chflag (both of which Finder reveals
# when "Show Hidden Files" is on), the FinderInfo invisible bit is NOT
# affected by that toggle — it's the mechanism that actually survives it.
#
# electron-builder's dmg target ships a read-only compressed image (UDZO by
# default — confirmed against node_modules/dmg-builder/out/dmg.js), so this
# script converts a copy to a writable image, mounts it, flips the bit on
# every root item except the two `dmg.contents` entries, unmounts, re-
# compresses back to UDZO, and replaces the original artifact in place (same
# path/filename, so a later `gh release upload release/*.dmg` still finds it).
#
# Deliberately its own CI step, not an electron-builder `afterAllArtifactBuild`
# hook (those are documented as racy under `--publish always`: electron-
# builder#3908 / #7145). The release workflow builds with `--publish never`,
# runs this script, then uploads manually.
#
# Usage:
#   bash scripts/harden-dmg.sh release/*.dmg
#
# macOS only (hdiutil/SetFile). Requires Xcode Command Line Tools (SetFile).
set -euo pipefail

[ "$(uname -s)" = "Darwin" ] || { echo "✗ harden-dmg.sh only runs on macOS (hdiutil/SetFile)." >&2; exit 1; }
[ "$#" -gt 0 ] || { echo "✗ Usage: $(basename "$0") <dmg> [<dmg> ...]" >&2; exit 1; }

# SetFile ships with Xcode Command Line Tools, but its bin dir isn't always on
# PATH. Try PATH first, then the two well-known CLT/Xcode install locations,
# so a missing tool fails up front with an actionable message — instead of a
# cryptic "command not found" after we've already converted/mounted a dmg.
SETFILE=""
if command -v SetFile >/dev/null 2>&1; then
  SETFILE="SetFile"
else
  for candidate in \
    /Library/Developer/CommandLineTools/usr/bin/SetFile \
    /Applications/Xcode.app/Contents/Developer/usr/bin/SetFile
  do
    [ -x "$candidate" ] && { SETFILE="$candidate"; break; }
  done
fi
[ -n "$SETFILE" ] || {
  echo "✗ SetFile not found (Xcode Command Line Tools required)." >&2
  echo "  Install with: xcode-select --install" >&2
  exit 1
}

# All intermediate dmg files live here — never inside the artifact's own
# directory (release/). Otherwise a crash mid-run could leave a stray *.dmg
# in release/ that a later `release/*.dmg` glob (e.g. gh release upload)
# would pick up and publish by mistake.
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/harden-dmg.XXXXXX")"

# Tracks the currently-attached mount point (if any) so the EXIT trap can
# force-detach it on error, without re-detaching dmgs already finished
# earlier in the loop.
CURRENT_MOUNT=""

cleanup() {
  local status=$?
  if [ -n "$CURRENT_MOUNT" ]; then
    hdiutil detach "$CURRENT_MOUNT" -force -quiet >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK_DIR" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT

# fseventsd/mdworker can briefly hold the volume open right after we write
# extended attributes, so a plain detach can transiently fail with "Resource
# busy". Mirrors dmg-builder's own retry (node_modules/dmg-builder/out/
# dmgUtil.js `detach()`): try clean, then wait and force.
detach_mount() {
  local mnt="$1"
  if ! hdiutil detach "$mnt" -quiet 2>/dev/null; then
    sleep 3
    hdiutil detach "$mnt" -force -quiet
  fi
}

TOTAL_HIDDEN=0
i=0

for dmg in "$@"; do
  [ -f "$dmg" ] || { echo "✗ Not a file: $dmg" >&2; exit 1; }
  i=$((i + 1))

  # Index-based temp names (not derived from the dmg's basename) so two
  # inputs that happen to share a basename (e.g. from different
  # subdirectories) can never collide in $WORK_DIR.
  rw_dmg="$WORK_DIR/$i.rw.dmg"
  compressed_dmg="$WORK_DIR/$i.out.dmg"
  mount_dir="$WORK_DIR/$i.mnt"
  mkdir -p "$mount_dir"

  echo "→ Hardening $dmg"

  # 1) Convert the read-only compressed dmg to a writable one.
  hdiutil convert "$dmg" -format UDRW -o "$rw_dmg"

  # 2) Mount read-write at a directory WE chose (-mountpoint), instead of
  #    parsing `hdiutil attach`'s text table for the mount path — that table
  #    breaks the moment the volume title has spaces (ours always does —
  #    "Claude Total Recall 0.8.0"), and rows for entries hdiutil didn't
  #    mount (EFI partition, partition map, etc.) would need filtering.
  #    -nobrowse keeps it out of Finder's sidebar; -noautoopen stops Finder
  #    from popping a window; -noverify skips the (slow, unneeded) checksum
  #    pass; -readwrite is explicit even though UDRW defaults to it.
  hdiutil attach -nobrowse -noautoopen -noverify -readwrite -mountpoint "$mount_dir" "$rw_dmg" >/dev/null
  CURRENT_MOUNT="$mount_dir"

  [ -n "$(ls -A "$mount_dir" 2>/dev/null)" ] || { echo "✗ Mounted volume is empty: $mount_dir" >&2; exit 1; }

  # 3) Hide everything except the two known-good, declared-visible items
  #    (electron-builder.yml's dmg.contents: the .app bundle and the
  #    /Applications alias). Deliberately a "hide everything not explicitly
  #    known-good" loop, not a hardcoded fix for the one filename reported
  #    so far — we don't know what dmg-builder's compiled binary names its
  #    background resource.
  shopt -s nullglob dotglob
  entries=("$mount_dir"/*)
  shopt -u nullglob dotglob

  saw_app=0
  saw_applications=0
  hidden=()
  for entry in "${entries[@]}"; do
    name="$(basename "$entry")"
    case "$name" in
      *.app)
        saw_app=1
        continue
        ;;
      Applications)
        saw_applications=1
        continue
        ;;
    esac
    "$SETFILE" -a V "$entry"
    hidden+=("$name")
  done

  # Sanity check: if we didn't see both expected visible items, this dmg's
  # contents don't match what electron-builder.yml declares — fail loudly
  # rather than silently risk having hidden the wrong thing.
  [ "$saw_app" -eq 1 ] || { echo "✗ No top-level *.app bundle found in $dmg — refusing to continue." >&2; exit 1; }
  [ "$saw_applications" -eq 1 ] || { echo "✗ No top-level 'Applications' alias found in $dmg — refusing to continue." >&2; exit 1; }

  if [ "${#hidden[@]}" -eq 0 ]; then
    echo "  (nothing else at the volume root — nothing to hide)"
  else
    echo "  Hid ${#hidden[@]} item(s): ${hidden[*]}"
  fi
  TOTAL_HIDDEN=$((TOTAL_HIDDEN + ${#hidden[@]}))

  # 4) Unmount before converting back.
  detach_mount "$mount_dir"
  CURRENT_MOUNT=""

  # 5) Recompress to UDZO (electron-builder's own default format for this
  #    config) at zlib level 9, matching dmgbuild's own default compression
  #    level, for size parity with the original.
  hdiutil convert "$rw_dmg" -format UDZO -imagekey zlib-level=9 -o "$compressed_dmg"

  # 6) Replace the original artifact in place, same path/filename, so the
  #    later `gh release upload release/*.dmg` step uploads this hardened
  #    file under the exact name electron-builder produced.
  mv -f "$compressed_dmg" "$dmg"

  rm -f "$rw_dmg"
  rmdir "$mount_dir" 2>/dev/null || true

  echo "✓ Hardened $dmg"
done

echo "✓ Done: hardened $# dmg(s), hid $TOTAL_HIDDEN item(s) total."
