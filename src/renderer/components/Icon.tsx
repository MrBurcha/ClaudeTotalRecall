import type { ReactNode } from 'react'

/**
 * Set de íconos propio en SVG inline (la CSP prohíbe librerías/CDN externos).
 * Todos usan stroke=currentColor y viewBox 24, así heredan color y tamaño del
 * contexto. Reemplaza los glifos unicode (↑ ↓ ⓘ ·) de la UI vieja.
 */
export type IconName =
  | 'orbit'
  | 'monitor'
  | 'folder'
  | 'folder-open'
  | 'sliders'
  | 'vault'
  | 'arrow-up'
  | 'arrow-down'
  | 'arrow-right'
  | 'arrow-up-right'
  | 'arrow-down-left'
  | 'sync'
  | 'spinner'
  | 'check'
  | 'alert'
  | 'x-circle'
  | 'git-branch'
  | 'plus'
  | 'trash'
  | 'pencil'
  | 'x'
  | 'chevron-right'
  | 'chevron-down'
  | 'search'
  | 'command'
  | 'info'
  | 'sun'
  | 'moon'
  | 'lock'
  | 'file-plus'
  | 'file-diff'
  | 'file-minus'

const ICONS: Record<IconName, ReactNode> = {
  orbit: (
    <>
      <circle cx="12" cy="12" r="2.5" />
      <ellipse cx="12" cy="12" rx="10" ry="4.4" />
      <circle cx="2" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  'folder-open': (
    <>
      <path d="M3 8V6a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v1" />
      <path d="M3 8h16.6a1.5 1.5 0 0 1 1.45 1.9l-1.7 6A2 2 0 0 1 17.4 17H5a2 2 0 0 1-2-2z" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 6h9M18 6h2M4 12h2M11 12h9M4 18h9M18 18h2" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="15" cy="18" r="2" />
    </>
  ),
  vault: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="12" cy="12" r="3.4" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </>
  ),
  'arrow-up': <path d="M12 19V5M6 11l6-6 6 6" />,
  'arrow-down': <path d="M12 5v14M18 13l-6 6-6-6" />,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  'arrow-up-right': <path d="M7 17 17 7M8 7h9v9" />,
  'arrow-down-left': <path d="M17 7 7 17M16 17H7V8" />,
  sync: (
    <>
      <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8M20 3.5V8h-4.5" />
      <path d="M20 12a8 8 0 0 1-13.7 5.6L4 16M4 20.5V16h4.5" />
    </>
  ),
  spinner: <path d="M12 3a9 9 0 1 0 9 9" />,
  check: <path d="M5 12.5l4.5 4.5L19 6.5" />,
  alert: (
    <>
      <path d="M12 3.4 1.7 20.6h20.6z" />
      <path d="M12 10v4.5M12 17.6h.01" />
    </>
  ),
  'x-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </>
  ),
  'git-branch': (
    <>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="8" r="2" />
      <path d="M6 7v10M18 10v1a5 5 0 0 1-5 5H8" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l1 13a1 1 0 0 0 1 .9h7a1 1 0 0 0 1-.9l1-13" />,
  pencil: (
    <>
      <path d="M4 20h4L19.5 8.5l-4-4L4 16z" />
      <path d="M14 6l4 4" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6 6 18" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  command: (
    <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3Z" />
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  'file-plus': (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M12 12v5M9.5 14.5h5" />
    </>
  ),
  'file-diff': (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M12 11v4M10 13h4M10 17.5h4" />
    </>
  ),
  'file-minus': (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9.5 14.5h5" />
    </>
  ),
}

export function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName
  size?: number
  className?: string
}): JSX.Element {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  )
}
