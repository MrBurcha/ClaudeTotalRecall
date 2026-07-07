import brandIcon from '@build/icons/256x256.png'

/**
 * The app's brand mark: the real app icon shown as a small rounded tile. It is
 * the single visual identity across the sidebar, the About dialog and the
 * onboarding wizard. Rebrand the whole app by replacing `build/icon.png` and
 * running `npm run icons` (which regenerates the sized `build/icons/*` this
 * reads, plus the packaging icons) — no code change. The rounded bezel is pure
 * CSS (`.brand-mark`), so the source image itself never needs editing.
 */
export function BrandMark({ size = 22 }: { size?: number }): JSX.Element {
  return <img src={brandIcon} width={size} height={size} className="brand-mark" alt="" aria-hidden />
}
