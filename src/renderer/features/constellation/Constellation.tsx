import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { Machine, PendingSummary, RepoStatus } from '../../../core/types'
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

/**
 * Where the link's count sits: beside the link (not on it) and past the machine's
 * label, which sits right under the node — on a short link the midpoint lands on it.
 */
function badgeAnchor(l: { x1: number; y1: number; x2: number; y2: number }): {
  x: number
  y: number
} {
  const dx = l.x2 - l.x1
  const dy = l.y2 - l.y1
  const len = Math.hypot(dx, dy) || 1
  // Perpendicular, flipped to point right so the text reads away from the link.
  let nx = -dy / len
  let ny = dx / len
  if (nx < 0) {
    nx = -nx
    ny = -ny
  }
  const at = 0.68
  return {
    x: l.x1 + dx * at + nx * 9,
    y: l.y1 + dy * at + ny * 9 + 4,
  }
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
    <foreignObject
      x={x - size / 2}
      y={y - size / 2}
      width={size}
      height={size}
      className={className}
    >
      <Icon name={name} size={size} />
    </foreignObject>
  )
}

/** What's waiting on the current machine's link: the engine's file counts, else git's. */
function waiting(
  status: RepoStatus | null,
  pending: PendingSummary | null,
): { up: number; down: number } {
  if (pending) return { up: pending.up, down: pending.down }
  return { up: status?.ahead ?? 0, down: status?.behind ?? 0 }
}

function describe(
  t: TFunction,
  currentId: string | null,
  status: RepoStatus | null,
  pending: PendingSummary | null,
  activeOp: ActiveOp | null,
): string {
  if (activeOp)
    return t(activeOp.verb === 'outgoing' ? 'constellation.syncingUp' : 'constellation.syncingDown')
  if (!currentId) return t('constellation.overview')
  if (!status && !pending) return t('constellation.connected', { machineId: currentId })
  const w = waiting(status, pending)
  const parts: string[] = []
  if (w.up > 0) parts.push(t('constellation.pendingUp', { count: w.up }))
  if (w.down > 0) parts.push(t('constellation.pendingDown', { count: w.down }))
  if (parts.length === 0) return t('constellation.upToDate', { machineId: currentId })
  return t('constellation.machineStatus', { machineId: currentId, parts: parts.join(', ') })
}

export function Constellation({
  machines,
  currentId,
  status,
  pending = null,
  activeOp,
  tone = 'ok',
}: {
  machines: Record<string, Machine>
  currentId: string | null
  status: RepoStatus | null
  /** what's waiting to move, counted by the engine (#139) */
  pending?: PendingSummary | null
  activeOp: ActiveOp | null
  /** hero color according to the auto-sync engine */
  tone?: 'ok' | 'syncing' | 'conflict' | 'offline' | 'error'
}): JSX.Element {
  const { t } = useTranslation()
  const reduced = usePrefersReducedMotion()
  const particlesRef = useRef<SVGGElement>(null)
  const { vault, nodes, links } = computeConstellation(machines, currentId, { w: W, h: H })
  const currentLink = links.find((l) => l.isCurrent) ?? null

  // Motion means "moving right now" and nothing else (#139): only a running sync or
  // a manual operation animates. Something merely WAITING (unpushed Notebook saves,
  // edits with auto-sync off) is a static state — a dashed link plus a count — or it
  // reads as a sync that never ends. Only the current machine's link carries a real
  // direction (the backend doesn't know the state of the other machines).
  const active = !!activeOp || tone === 'syncing'
  const w = waiting(status, pending)
  let direction: FlowDirection | null = null
  if (activeOp) direction = activeOp.verb === 'outgoing' ? 'up' : 'down'
  // One engine cycle moves both ways: show the side with work, uploading by default.
  else if (active) direction = w.up === 0 && w.down > 0 ? 'down' : 'up'

  const enabled = !reduced && direction !== null && currentLink !== null
  useConstellationMotion(particlesRef, currentLink, direction, enabled, 1.8)

  const waitingNow = !active && (w.up > 0 || w.down > 0)
  const badge = waitingNow
    ? [w.up > 0 ? `↑${w.up}` : '', w.down > 0 ? `↓${w.down}` : ''].filter(Boolean).join(' ')
    : reduced && direction
      ? direction === 'up'
        ? w.up > 0
          ? `↑${w.up}`
          : ''
        : w.down > 0
          ? `↓${w.down}`
          : ''
      : ''

  return (
    <div className={cx('constellation', tone !== 'ok' && `constellation--${tone}`)}>
      <svg
        className="constellation__svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={describe(t, currentId, status, pending, activeOp)}
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
              l.isCurrent && waitingNow && 'const-link--pending',
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
                className={
                  direction === 'down' ? 'const-particle const-particle--down' : 'const-particle'
                }
                r={2.6}
                cx={vault.x}
                cy={vault.y}
                opacity={0}
              />
            ))}
          </g>
        )}

        {currentLink && badge && (
          <text
            className={cx('const-dirbadge', waitingNow && 'const-dirbadge--pending')}
            {...badgeAnchor(currentLink)}
          >
            {badge}
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
                node.isCurrent
                  ? 'const-node__label const-node__label--current'
                  : 'const-node__label'
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
