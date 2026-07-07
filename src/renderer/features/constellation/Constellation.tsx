import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { Machine, RepoStatus } from '../../../core/types'
import { Icon, type IconName } from '../../components/Icon'
import { usePrefersReducedMotion } from '../../hooks/useMediaQuery'
import type { ActiveOp } from '../../state/types'
import { computeConstellation } from './layout'
import { useConstellationMotion, type FlowDirection } from './useConstellationMotion'

// Fixed logical coordinates: the SVG scales responsively via viewBox (no DOM measuring).
const W = 600
const H = 360
const PARTICLES = 7

function shorten(label: string): string {
  return label.length > 13 ? `${label.slice(0, 12)}…` : label
}

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

/** Icon positioned inside the SVG via foreignObject (reuses the Icon component). */
function Glyph({
  x,
  y,
  name,
  size,
  className,
}: {
  x: number
  y: number
  name: IconName
  size: number
  className: string
}): JSX.Element {
  return (
    <foreignObject x={x - size / 2} y={y - size / 2} width={size} height={size} className={className}>
      <Icon name={name} size={size} />
    </foreignObject>
  )
}

function describe(
  t: TFunction,
  currentId: string | null,
  status: RepoStatus | null,
  activeOp: ActiveOp | null,
): string {
  if (activeOp)
    return t(activeOp.verb === 'gather' ? 'constellation.syncingUp' : 'constellation.syncingDown')
  if (!currentId) return t('constellation.overview')
  if (!status) return t('constellation.connected', { machineId: currentId })
  const parts: string[] = []
  if (status.ahead > 0) parts.push(t('constellation.toUpload', { count: status.ahead }))
  if (status.behind > 0) parts.push(t('constellation.toDownload', { count: status.behind }))
  if (parts.length === 0) return t('constellation.upToDate', { machineId: currentId })
  return t('constellation.machineStatus', { machineId: currentId, parts: parts.join(', ') })
}

export function Constellation({
  machines,
  currentId,
  status,
  activeOp,
  tone = 'ok',
}: {
  machines: Record<string, Machine>
  currentId: string | null
  status: RepoStatus | null
  activeOp: ActiveOp | null
  /** hero color according to the auto-sync engine */
  tone?: 'ok' | 'syncing' | 'conflict' | 'offline'
}): JSX.Element {
  const { t } = useTranslation()
  const reduced = usePrefersReducedMotion()
  const particlesRef = useRef<SVGGElement>(null)
  const { vault, nodes, links } = computeConstellation(machines, currentId, { w: W, h: H })
  const currentLink = links.find((l) => l.isCurrent) ?? null

  // Only the current machine's link carries a real direction (the backend
  // doesn't know the state of the other machines).
  let direction: FlowDirection | null = null
  if (activeOp) direction = activeOp.verb === 'gather' ? 'up' : 'down'
  else if (status && status.ahead > 0) direction = 'up'
  else if (status && status.behind > 0) direction = 'down'
  // One engine cycle moves in both directions: if there's no clear direction, we upload.
  if (!direction && tone === 'syncing') direction = 'up'

  const active = !!activeOp || tone === 'syncing'
  const enabled = !reduced && direction !== null && currentLink !== null
  useConstellationMotion(particlesRef, currentLink, direction, enabled, active ? 1.8 : 1)

  const pending =
    direction === 'up' ? status?.ahead ?? 0 : direction === 'down' ? status?.behind ?? 0 : 0

  return (
    <div className={cx('constellation', tone !== 'ok' && `constellation--${tone}`)}>
      <svg
        className="constellation__svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={describe(t, currentId, status, activeOp)}
      >
        <circle className="const-ring" cx={vault.x} cy={vault.y} r={66} />
        <circle className="const-ring" cx={vault.x} cy={vault.y} r={116} />

        {links.map((l) => (
          <line
            key={l.id}
            className={cx(
              'const-link',
              l.isCurrent && direction && 'const-link--flow',
              l.isCurrent && direction === 'down' && 'const-link--down',
              l.isCurrent && status?.dirty && 'const-link--dirty',
            )}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
          />
        ))}

        {enabled && (
          <g ref={particlesRef}>
            {Array.from({ length: PARTICLES }).map((_, i) => (
              <circle
                key={i}
                className={direction === 'down' ? 'const-particle const-particle--down' : 'const-particle'}
                r={2.6}
                cx={vault.x}
                cy={vault.y}
                opacity={0}
              />
            ))}
          </g>
        )}

        {reduced && direction && currentLink && pending > 0 && (
          <text
            className="const-dirbadge"
            x={(currentLink.x1 + currentLink.x2) / 2}
            y={(currentLink.y1 + currentLink.y2) / 2 - 6}
          >
            {direction === 'up' ? `↑${pending}` : `↓${pending}`}
          </text>
        )}

        <g className={active ? 'const-vault--active' : undefined}>
          <circle className="const-vault-glow" cx={vault.x} cy={vault.y} r={vault.r + 14} />
          <circle className="const-vault-core" cx={vault.x} cy={vault.y} r={vault.r} />
          <Glyph x={vault.x} y={vault.y} name="vault" size={26} className="const-vault__glyph" />
          <text className="const-vault__label" x={vault.x} y={vault.y + vault.r + 18}>
            repo
          </text>
        </g>

        {nodes.map((node) => (
          <g key={node.id}>
            <circle
              className={node.isCurrent ? 'const-node const-node--current' : 'const-node'}
              cx={node.x}
              cy={node.y}
              r={node.r}
            />
            <Glyph
              x={node.x}
              y={node.y}
              name="monitor"
              size={20}
              className={node.isCurrent ? 'const-glyph--accent' : 'const-node__glyph'}
            />
            <text
              className={
                node.isCurrent ? 'const-node__label const-node__label--current' : 'const-node__label'
              }
              x={node.x}
              y={node.y + node.r + 15}
            >
              {shorten(node.label)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
