import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileChange, PlanActionType } from '../../core/types'

export function Pill({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}): JSX.Element {
  return <span className={className ? `pill ${className}` : 'pill'}>{children}</span>
}

export function Badge({ children, muted }: { children: ReactNode; muted?: boolean }): JSX.Element {
  return <span className={muted ? 'badge badge--muted' : 'badge'}>{children}</span>
}

export function StatusDot({
  tone = 'muted',
}: {
  tone?: 'ok' | 'warn' | 'danger' | 'muted'
}): JSX.Element {
  return <span className={tone === 'muted' ? 'status-dot' : `status-dot status-dot--${tone}`} />
}

/** Human label for each Plan action type (reuses the .tag--* colors). */
export function Tag({ type }: { type: PlanActionType }): JSX.Element {
  const { t } = useTranslation()
  return <span className={`tag tag--${type}`}>{t(`tag.${type}`)}</span>
}

/** Colored dot + word for a file-change status in the activity feed (Added / Updated / Removed). */
export function FileTag({ status }: { status: FileChange['status'] }): JSX.Element {
  const { t } = useTranslation()
  return (
    <span className={`file-tag file-tag--${status}`}>
      <span className="file-tag__dot" aria-hidden="true" />
      {t(`fileTag.${status}`)}
    </span>
  )
}
