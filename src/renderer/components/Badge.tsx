import type { ReactNode } from 'react'
import type { PlanActionType } from '../../core/types'

export function Pill({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}): JSX.Element {
  return <span className={className ? `pill ${className}` : 'pill'}>{children}</span>
}

export function Badge({
  children,
  muted,
}: {
  children: ReactNode
  muted?: boolean
}): JSX.Element {
  return <span className={muted ? 'badge badge--muted' : 'badge'}>{children}</span>
}

export function StatusDot({ tone = 'muted' }: { tone?: 'ok' | 'warn' | 'danger' | 'muted' }): JSX.Element {
  return <span className={tone === 'muted' ? 'status-dot' : `status-dot status-dot--${tone}`} />
}

/** Etiqueta humana de cada tipo de acción del Plan (reusa colores .tag--*). */
const TAG_LABEL: Record<PlanActionType, string> = {
  create: 'crea',
  overwrite: 'sobrescribe',
  delete: 'borra',
  noop: 'igual',
  skip: 'omite',
}

export function Tag({ type }: { type: PlanActionType }): JSX.Element {
  return <span className={`tag tag--${type}`}>{TAG_LABEL[type]}</span>
}
