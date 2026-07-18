import { useEffect, type RefObject } from 'react'

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * Atrapa el foco dentro de `ref` mientras `active`. Enfoca el primer elemento al
 * montar y devuelve el foco al elemento previo al desmontar. Ciclado con Tab/Shift+Tab.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    if (!active) return
    const root = ref.current
    if (!root) return
    const previouslyFocused = document.activeElement as HTMLElement | null

    const items = (): HTMLElement[] =>
      Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      )

    items()[0]?.focus()

    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return
      const focusables = items()
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    root.addEventListener('keydown', onKey)
    return () => {
      root.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [ref, active])
}
