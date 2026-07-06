import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { usePortalNode } from '../hooks/usePortalNode'

interface OverlayProps {
  onClose: () => void
  children: ReactNode
  variant?: 'modal' | 'palette'
  closeOnBackdrop?: boolean
}

/**
 * Base compartida de todos los overlays: portal a #overlay-root, atrapa foco,
 * cierra con Esc, bloquea el scroll del body y cierra al clickear el fondo.
 * El contenido (children) trae su propia caja (.modal / .palette con role=dialog).
 */
export function Overlay({
  onClose,
  children,
  variant = 'modal',
  closeOnBackdrop = true,
}: OverlayProps): JSX.Element | null {
  const node = usePortalNode()
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  if (!node) return null

  return createPortal(
    <div
      ref={ref}
      className={variant === 'palette' ? 'palette-overlay' : 'overlay'}
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose()
      }}
    >
      {children}
    </div>,
    node,
  )
}
