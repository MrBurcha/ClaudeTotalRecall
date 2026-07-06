import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: IconName
  title: string
  children?: ReactNode
}): JSX.Element {
  return (
    <div className="empty">
      <Icon name={icon} size={30} className="empty__icon" />
      <div className="empty__title">{title}</div>
      {children && <div className="muted">{children}</div>}
    </div>
  )
}
