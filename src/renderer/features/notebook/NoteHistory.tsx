import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type {
  NotebookDiff,
  NotebookFile,
  NotebookHistory,
  NotebookVersion,
  NotebookVersionKind,
} from '../../../core/types'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { Icon } from '../../components/Icon'
import { SegmentedControl } from '../../components/SegmentedControl'
import { Skeleton } from '../../components/Skeleton'
import { api, normalizeError } from '../../state/api'
import { relativeParts } from '../sync/relativeTime'
import { DiffView } from './DiffView'
import { NoteContent } from './NoteDetail'

type Mode = 'version' | 'diff'

function kindLabel(kind: NotebookVersionKind, t: TFunction): string {
  switch (kind) {
    case 'create':
      return t('notebook.history.kind.create')
    case 'update':
      return t('notebook.history.kind.update')
    case 'rename':
      return t('notebook.history.kind.rename')
    case 'restore':
      return t('notebook.history.kind.restore')
    case 'delete':
      return t('notebook.history.kind.delete')
    default:
      return t('notebook.history.kind.other')
  }
}

function timeAgo(at: string, now: number, t: TFunction): string {
  const then = Date.parse(at)
  if (Number.isNaN(then)) return ''
  const p = relativeParts(then, now)
  return p.key === 'now' ? t('relativeTime.now') : t(`relativeTime.${p.key}`, { count: p.count })
}

/** Absolute, locale-formatted commit date ("Nov 7, 2026, 3:02 PM"). */
export function versionDate(at: string, locale: string | undefined): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return at
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

/** Default selection: the newest version that differs from the note, else the newest one. */
function defaultVersion(versions: NotebookVersion[]): string | null {
  const older = versions.find((v) => v.available && !v.current)
  return (older ?? versions.find((v) => v.available) ?? null)?.hash ?? null
}

export interface NoteHistoryProps {
  /** the note's current notebook-relative path */
  path: string
  name: string
  busy: boolean
  onBack: () => void
  /** asks for confirmation and restores; the parent owns the save flow */
  onRestore: (version: NotebookVersion) => void
}

/**
 * The version history of the open note (#107), shown in place of the note: the
 * commits that touched it (following renames) on the left, the selected version
 * on the right — read-only, or compared with the current content — with a
 * "Restore this version" action.
 */
export function NoteHistory(props: NoteHistoryProps): JSX.Element {
  const { t, i18n } = useTranslation()
  const { path } = props
  const [history, setHistory] = useState<NotebookHistory | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('version')
  const [file, setFile] = useState<NotebookFile | null>(null)
  const [diff, setDiff] = useState<NotebookDiff | null>(null)
  const [viewError, setViewError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setHistory(null)
    setListError(null)
    api
      .notebookHistory(path)
      .then((h) => {
        if (!alive) return
        setHistory(h)
        setSelectedHash(defaultVersion(h.versions))
      })
      .catch((e) => {
        if (alive) setListError(normalizeError(e))
      })
    return () => {
      alive = false
    }
  }, [path])

  const selected = history?.versions.find((v) => v.hash === selectedHash) ?? null
  const selHash = selected?.available ? selected.hash : null
  const selPath = selected?.path ?? ''

  useEffect(() => {
    if (!selHash) return
    let alive = true
    setFile(null)
    setDiff(null)
    setViewError(null)
    const load =
      mode === 'version'
        ? api.notebookReadVersion(selHash, selPath).then((f) => alive && setFile(f))
        : api.notebookDiffVersion(path, selHash, selPath).then((d) => alive && setDiff(d))
    load.catch((e) => {
      if (alive) setViewError(normalizeError(e))
    })
    return () => {
      alive = false
    }
  }, [selHash, selPath, mode, path])

  const modes = useMemo(
    () => [
      { value: 'version' as const, label: t('notebook.history.modeVersion') },
      { value: 'diff' as const, label: t('notebook.history.modeDiff') },
    ],
    [t],
  )

  const now = Date.now()
  const locale = i18n.resolvedLanguage

  function viewBody(): JSX.Element {
    if (!selected) return <p className="muted note-detail__note">{t('notebook.history.pick')}</p>
    if (!selected.available) {
      return <p className="muted note-detail__note">{t('notebook.history.unavailable')}</p>
    }
    if (viewError) return <p className="muted note-detail__note">{viewError}</p>
    if (mode === 'diff') return diff ? <DiffView diff={diff} /> : <Skeleton h={160} radius={10} />
    return file ? <NoteContent name={props.name} file={file} /> : <Skeleton h={160} radius={10} />
  }

  // A version can be restored when it has content that differs from the note now.
  // Binary versions are refused server-side with a clear error.
  const restorable = !!selected?.available && !selected.current && !file?.binary

  return (
    <div className="note-detail">
      <div className="note-detail__head">
        <div className="note-history__heading">
          <Icon name="history" size={15} />
          <span className="note-history__title">{t('notebook.history.title')}</span>
          <span className="note-detail__crumb mono truncate" title={path}>
            {path}
          </span>
        </div>
        <Button size="sm" variant="ghost" onClick={props.onBack}>
          {t('notebook.history.back')}
        </Button>
      </div>

      <div className="note-history">
        <div className="note-history__list">
          {listError ? (
            <p className="muted note-history__msg">{listError}</p>
          ) : !history ? (
            <div className="note-history__msg">
              <Skeleton h={44} radius={8} />
            </div>
          ) : history.versions.length === 0 ? (
            <p className="muted note-history__msg">{t('notebook.history.empty')}</p>
          ) : (
            <ol className="note-history__items" aria-label={t('notebook.history.listAria')}>
              {history.versions.map((v) => (
                <li key={v.hash}>
                  <button
                    type="button"
                    className={[
                      'note-history__item',
                      v.hash === selectedHash ? 'note-history__item--active' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    aria-current={v.hash === selectedHash ? 'true' : undefined}
                    onClick={() => setSelectedHash(v.hash)}
                    title={`${versionDate(v.at, locale)} · ${v.subject}`}
                  >
                    <span className="note-history__row">
                      <span className="grow truncate">{kindLabel(v.kind, t)}</span>
                      {v.current && <Badge>{t('notebook.history.current')}</Badge>}
                    </span>
                    <span className="note-history__row muted">
                      <span className="grow truncate">{timeAgo(v.at, now, t)}</span>
                      <span className="mono note-history__hash">{v.shortHash}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          {history?.truncated && (
            <p className="muted note-history__msg">
              {t('notebook.history.truncated', { limit: history.versions.length })}
            </p>
          )}
        </div>

        <div className="note-history__view">
          {selected && (
            <div className="note-history__toolbar">
              <div className="note-history__meta">
                <span>{versionDate(selected.at, locale)}</span>
                <span className="mono muted">{selected.shortHash}</span>
                {selected.available && selected.path !== path && (
                  <span className="muted truncate" title={selected.path}>
                    {t('notebook.history.thenNamed', { path: selected.path })}
                  </span>
                )}
              </div>
              {selected.available && (
                <div className="cluster">
                  <SegmentedControl<Mode>
                    ariaLabel={t('notebook.history.modeAria')}
                    value={mode}
                    onChange={setMode}
                    options={modes}
                  />
                  <Button
                    size="sm"
                    icon="rotate-ccw"
                    disabled={props.busy || !restorable}
                    onClick={() => props.onRestore(selected)}
                  >
                    {t('notebook.history.restore')}
                  </Button>
                </div>
              )}
            </div>
          )}
          <div className="note-history__content">{viewBody()}</div>
        </div>
      </div>
    </div>
  )
}
