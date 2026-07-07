import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { HistoryEntry } from '../../../core/types'
import { Icon, type IconName } from '../../components/Icon'
import { api } from '../../state/api'
import { useAppState } from '../../state/store'
import { relativeParts } from './relativeTime'

/** Direction/kind icon for an entry; outgoing points ↑ if it came from THIS machine, ↓ otherwise. */
function iconFor(e: HistoryEntry, currentMachine: string | null): IconName {
  switch (e.type) {
    case 'outgoing':
      return e.machineId && e.machineId === currentMachine ? 'arrow-up' : 'arrow-down'
    case 'set-folder':
      return 'file-diff'
    case 'remove-folder':
    case 'delete-project':
      return 'trash'
    case 'new-project':
      return 'plus'
    case 'rename-project':
      return 'pencil'
    case 'register':
      return 'monitor'
    case 'pin':
      return 'file-plus'
    case 'unpin':
      return 'file-minus'
    case 'conflicts':
      return 'alert'
    default:
      return 'sync'
  }
}

function labelFor(e: HistoryEntry, currentMachine: string | null, t: TFunction): string {
  switch (e.type) {
    case 'outgoing':
      return e.machineId && e.machineId === currentMachine
        ? t('activity.outgoingLocal')
        : t('activity.outgoingRemote')
    case 'set-folder':
      return t('activity.sourceUpdated', { slot: e.slot, project: e.project })
    case 'remove-folder':
      return t('activity.sourceRemoved', { slot: e.slot, project: e.project })
    case 'new-project':
      return t('activity.projectCreated', { name: e.project })
    case 'delete-project':
      return t('activity.projectDeleted', { name: e.project })
    case 'rename-project':
      return t('activity.projectRenamed', { from: e.from, to: e.to })
    case 'register':
      return t('activity.machineRegistered', { machine: e.machineId })
    case 'pin':
      return t('activity.filePinned', { pin: e.pin })
    case 'unpin':
      return t('activity.fileUnpinned', { pin: e.pin })
    case 'conflicts':
      return t('activity.conflictsResolved')
    default:
      return t('activity.change')
  }
}

function timeText(at: string, now: number, t: TFunction): string {
  const then = Date.parse(at)
  if (Number.isNaN(then)) return ''
  const p = relativeParts(then, now)
  return p.key === 'now' ? t('relativeTime.now') : t(`relativeTime.${p.key}`, { count: p.count })
}

function metaBits(e: HistoryEntry, t: TFunction): string {
  const bits: string[] = []
  if (e.machineId) bits.push(e.machineId)
  if (e.type === 'outgoing' && e.files > 0) bits.push(t('activity.files', { count: e.files }))
  return bits.join(' · ')
}

/**
 * "Recent activity" (#8): a collapsible timeline on the Sync home, derived from
 * the memories repo's git log. Refetches when a sync cycle settles (the engine's
 * push doesn't carry the log, so we re-read on lastSyncedAt/status change).
 */
export function RecentActivity(): JSX.Element {
  const { t } = useTranslation()
  const { machineId, syncEngine } = useAppState()
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let alive = true
    void api
      .repoHistory(20)
      .then((h) => {
        if (alive) setEntries(h)
      })
      .catch(() => {
        /* no repo yet; ignored */
      })
    return () => {
      alive = false
    }
  }, [syncEngine?.lastSyncedAt, syncEngine?.status])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  return (
    <section className="advanced">
      <button className="advanced__head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} />
        <span className="grow">
          <span className="advanced__title">{t('activity.title')}</span>
        </span>
      </button>

      {open && (
        <div className="advanced__body">
          {entries.length === 0 ? (
            <p className="muted">{t('activity.empty')}</p>
          ) : (
            <ul className="folder-list">
              {entries.map((e) => (
                <li key={e.hash} className="folder-row">
                  <div className="folder-row__main">
                    <Icon name={iconFor(e, machineId)} size={15} />
                    <span className="grow">{labelFor(e, machineId, t)}</span>
                    <span className="muted mono">{timeText(e.at, now, t)}</span>
                  </div>
                  {metaBits(e, t) && (
                    <div className="muted mono folder-row__others">{metaBits(e, t)}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
