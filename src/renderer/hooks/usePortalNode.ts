import { useEffect, useState } from 'react'

/**
 * Returns a shared node (#overlay-root) mounted on <body> for overlay portals.
 * It's created once and never removed (several overlays share it).
 * Returns null on the first render; the overlay mounts once it's ready.
 */
export function usePortalNode(): HTMLElement | null {
  const [node, setNode] = useState<HTMLElement | null>(null)
  useEffect(() => {
    let el = document.getElementById('overlay-root')
    if (!el) {
      el = document.createElement('div')
      el.id = 'overlay-root'
      document.body.appendChild(el)
    }
    setNode(el)
  }, [])
  return node
}
