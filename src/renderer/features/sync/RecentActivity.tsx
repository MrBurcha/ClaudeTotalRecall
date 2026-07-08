import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { FileChange, HistoryEntry } from '../../../core/types'
import { parseMemoryPath } from '../../../core/memoryPath'
import { FileTag } from '../../components/Badge'
import { Icon, type IconName } from '../../components/Icon'
import { api } from '../../state/api'
import { useAppState } from '../../state/store'
import { relativeParts } from './relativeTime'

/**
 * Direction/kind icon. Since the feed is now an honest ledger, outgoing means "a
 * machine contributed to shared memory" (↑ from you, ↓ from another) and incoming
 * means "you received into this machine" (↙).
 */
function iconFor(e: HistoryEntry, currentMachine: string | null): IconName {
  switch (e.type) {
    case 'outgoing':
      return e.machineId && e.machineId === currentMachine ? 'arrow-up' : 'arrow-down'
    case 'incoming':
      return 'arrow-down-left'
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
      if (e.machineId && e.machineId === currentMachine) return t('activity.outgoingLocal')
      // Name the source machine when we have it; fall back to the generic label
      // for legacy commits (pre-rename `gather`) that carry no machine id. The
      // machineId is the user-chosen slug ("laptop"), friendlier than the raw
      // OS hostname, so we show it directly.
      return e.machineId
        ? t('activity.outgoingRemoteNamed', { machine: e.machineId })
        : t('activity.outgoingRemote')
    case 'incoming':
      return t('activity.incomingReceived')
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

/** Secondary line: who it came from (incoming) / which other machine (outgoing) + file count. */
function metaBits(e: HistoryEntry, currentMachine: string | null, t: TFunction): string {
  const bits: string[] = []
  if (e.type === 'incoming') {
    const from = e.fromMachines ?? []
    if (from.length) bits.push(t('activity.fromMachines', { machines: from.join(', ') }))
    if (e.files > 0) bits.push(t('activity.files', { count: e.files }))
  } else if (e.type === 'outgoing') {
    if (e.machineId && e.machineId !== currentMachine) bits.push(e.machineId)
    if (e.files > 0) bits.push(t('activity.files', { count: e.files }))
  } else if (e.machineId) {
    bits.push(e.machineId)
  }
  return bits.join(' · ')
}

/** How many files to list before collapsing the rest into a "+N more" line. */
const FILE_CAP = 8

interface FileGroup {
  key: string
  heading: string
  files: { status: FileChange['status']; leaf: string }[]
}

/**
 * Groups a commit/record's file changes into the app's buckets (a project slot,
 * user level, pinned files) with friendly headings, showing only the leaf name —
 * so the list reads in the user's vocabulary instead of the raw repo layout.
 */
function groupChanges(changes: FileChange[], t: TFunction): FileGroup[] {
  const groups = new Map<string, FileGroup>()
  for (const c of changes) {
    const loc = parseMemoryPath(c.path)
    let key: string
    let heading: string
    let leaf: string
    switch (loc.bucket) {
      case 'project':
        key = `project:${loc.project}/${loc.slot}`
        heading = `${loc.project} › ${loc.slot}`
        leaf = loc.rest || loc.slot
        break
      case 'user':
        key = 'user'
        heading = t('activity.bucketUser')
        leaf = loc.rest ? `${loc.slot}/${loc.rest}` : loc.slot
        break
      case 'pinned':
        key = 'pinned'
        heading = t('activity.bucketPinned')
        leaf = loc.pin
        break
      default:
        key = 'unknown'
        heading = t('activity.bucketUnknown')
        leaf = loc.path
    }
    let g = groups.get(key)
    if (!g) {
      g = { key, heading, files: [] }
      groups.set(key, g)
    }
    g.files.push({ status: c.status, leaf })
  }
  return [...groups.values()]
}

/**
 * "Recent activity" (#8): a collapsible timeline on the Sync home. It merges the
 * memories repo's git log (outgoing + admin events) with the local incoming
 * ledger, so it's an honest record of who contributed to shared memory and what
 * this machine received. Refetches when a sync cycle settles.
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
      .repoHistory(100)
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
              {entries.map((e) => {
                // File details only for the sync verbs: config commits also touch
                // claudetr.json, which would be noise here.
                const showFiles =
                  (e.type === 'outgoing' || e.type === 'incoming') && e.changes.length > 0
                const shown = e.changes.slice(0, FILE_CAP)
                const overflow = e.changes.length - shown.length
                const meta = metaBits(e, machineId, t)
                return (
                  <li key={e.hash} className="folder-row">
                    <div className="folder-row__main">
                      <Icon name={iconFor(e, machineId)} size={15} />
                      <span className="grow">{labelFor(e, machineId, t)}</span>
                      <span className="muted mono">{timeText(e.at, now, t)}</span>
                    </div>
                    {meta && <div className="muted mono folder-row__others">{meta}</div>}
                    {showFiles && (
                      <ul className="activity-files">
                        {groupChanges(shown, t).map((g) => (
                          <li key={g.key} className="activity-group">
                            <div className="activity-group__head">{g.heading}</div>
                            <ul className="activity-group__files">
                              {g.files.map((f, i) => (
                                <li key={`${f.leaf}:${i}`} className="activity-file">
                                  <FileTag status={f.status} />
                                  <span className="mono truncate">{f.leaf}</span>
                                </li>
                              ))}
                            </ul>
                          </li>
                        ))}
                        {overflow > 0 && (
                          <li className="muted mono">
                            {t('activity.moreFiles', { count: overflow })}
                          </li>
                        )}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
