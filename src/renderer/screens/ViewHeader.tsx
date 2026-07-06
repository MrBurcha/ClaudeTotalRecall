import type { ReactNode } from 'react'

export function ViewHeader({
  eyebrow,
  title,
  sub,
  action,
}: {
  eyebrow: string
  title: string
  sub?: string
  action?: ReactNode
}): JSX.Element {
  return (
    <div className="view__head">
      <div className="row between row-nowrap">
        <div className="stack-1">
          <span className="view__eyebrow">{eyebrow}</span>
          <h1 className="view__title">{title}</h1>
        </div>
        {action}
      </div>
      {sub && <p className="view__sub">{sub}</p>}
    </div>
  )
}
