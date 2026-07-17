import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './Icon'

export interface MenuAction {
  icon?: IconName
  label: string
  danger?: boolean
  onSelect: () => void
}

interface Coords {
  top: number
  left: number
  flipUp: boolean
}

const ROW_H = 34 // estimated menu item height, for the flip-up decision

/**
 * A kebab (⋯) button that opens a small dropdown of actions. The menu renders in
 * a portal with fixed positioning so it never clips inside a scrolling container,
 * right-aligns to the trigger, and flips above when there isn't room below. Closes
 * on outside click, Escape, scroll or resize.
 */
export function Menu({
  label,
  actions,
  disabled,
  icon = 'more-vertical',
  className,
}: {
  label: string
  actions: MenuAction[]
  disabled?: boolean
  icon?: IconName
  className?: string
}): JSX.Element {
  const [coords, setCoords] = useState<Coords | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const open = coords !== null
  const close = (): void => setCoords(null)

  const toggle = (e: MouseEvent): void => {
    e.stopPropagation()
    if (open) return close()
    const b = btnRef.current?.getBoundingClientRect()
    if (!b) return
    const flipUp = b.bottom + 8 + actions.length * ROW_H > window.innerHeight
    setCoords({ left: b.right, top: flipUp ? b.top - 4 : b.bottom + 4, flipUp })
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    // Any scroll (the tree pane or the window) invalidates the fixed position.
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={['nb-menu__trigger', open ? 'nb-menu__trigger--open' : '', className ?? '']
          .filter(Boolean)
          .join(' ')}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={toggle}
      >
        <Icon name={icon} size={16} />
      </button>
      {coords &&
        createPortal(
          <div className="nb-menu__backdrop" onClick={close}>
            <div
              className="nb-menu"
              role="menu"
              style={{
                position: 'fixed',
                top: coords.top,
                left: coords.left,
                transform: coords.flipUp ? 'translate(-100%, -100%)' : 'translateX(-100%)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {actions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  role="menuitem"
                  className={a.danger ? 'nb-menu__item nb-menu__item--danger' : 'nb-menu__item'}
                  onClick={(e) => {
                    e.stopPropagation()
                    close()
                    a.onSelect()
                  }}
                >
                  {a.icon && <Icon name={a.icon} size={15} />}
                  <span className="grow truncate">{a.label}</span>
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
