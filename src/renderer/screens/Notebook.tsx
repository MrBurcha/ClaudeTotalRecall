import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { NoteDetail } from '../features/notebook/NoteDetail'
import { NoteHistory, versionDate } from '../features/notebook/NoteHistory'
import {
  NotebookSearchBox,
  NotebookSearchResults,
  useNotebookSearch,
} from '../features/notebook/NotebookSearch'
import { NotebookTreeView, type TreeCtx } from '../features/notebook/NotebookTree'
import { ancestorDirs } from '../features/notebook/notebookView'
import { api, normalizeError } from '../state/api'
import { useAppState } from '../state/store'
import { useActions } from '../state/useActions'
import { ViewHeader } from './ViewHeader'
import type { NotebookFile, NotebookTree, NotebookVersion } from '../../core/types'

const parentOf = (rel: string): string => rel.split('/').slice(0, -1).join('/')
const baseOf = (rel: string): string => rel.split('/').slice(-1)[0]

/** Rewrites a path after `from` was renamed/moved to `to`: exact match or descendant. */
const rewritePath = (p: string, from: string, to: string): string =>
  p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p

export function Notebook(): JSX.Element {
  const { t, i18n } = useTranslation()
  const state = useAppState()
  const actions = useActions()

  const [tree, setTree] = useState<NotebookTree | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [file, setFile] = useState<NotebookFile | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['general']))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState<TreeCtx['creating']>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [moving, setMoving] = useState<string | null>(null)
  // Version history (#107) replaces the note view in the detail pane while open.
  const [historyOpen, setHistoryOpen] = useState(false)
  // Full-text search (#108): results replace the tree while the query is non-empty.
  const [query, setQuery] = useState('')
  const [searchNonce, setSearchNonce] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const search = useNotebookSearch(query, searchNonce)
  const searching = query.trim() !== ''

  const connected = !!state.config

  const loadTree = async (): Promise<void> => {
    setTree(await api.notebookTree())
  }

  useEffect(() => {
    if (!connected) return
    void api
      .notebookTree()
      .then(setTree)
      .catch((e) => actions.notify(normalizeError(e), 'err'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected])

  /** Wraps a mutation: local busy, reload tree, refresh repo status (unsynced badge), toast. */
  const runNb = async (fn: () => Promise<void>, okMsg?: string): Promise<void> => {
    setBusy(true)
    try {
      await fn()
      await loadTree()
      setSearchNonce((n) => n + 1) // re-run an active search against the new content
      await actions.refresh()
      if (okMsg) actions.notify(okMsg, 'ok')
    } catch (e) {
      actions.notify(normalizeError(e), 'err')
    } finally {
      setBusy(false)
    }
  }

  const openNote = async (rel: string): Promise<void> => {
    setSelected(rel)
    setEditing(false)
    setHistoryOpen(false)
    setBusy(true)
    try {
      setFile(await api.notebookRead(rel))
    } catch (e) {
      actions.notify(normalizeError(e), 'err')
    } finally {
      setBusy(false)
    }
  }

  const toggle = (path: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const startCreate = (parent: string, kind: 'note' | 'folder'): void => {
    setExpanded((prev) => new Set(prev).add(parent))
    setRenaming(null)
    setMoving(null)
    setCreating({ parent, kind })
  }

  const submitCreate = async (raw: string): Promise<void> => {
    if (!creating) return
    const { parent, kind } = creating
    setCreating(null)
    const name = kind === 'note' && !raw.includes('.') ? `${raw}.md` : raw
    const rel = `${parent}/${name}`
    await runNb(async () => {
      if (kind === 'folder') {
        await api.notebookCreateFolder(rel)
      } else {
        await api.notebookCreateNote(rel, '')
        setSelected(rel)
        setFile({ content: '', size: 0, truncated: false, binary: false, exists: true })
        setDraft('')
        setHistoryOpen(false)
        setEditing(true)
      }
    })
  }

  const submitRename = async (newName: string): Promise<void> => {
    const from = renaming
    setRenaming(null)
    if (!from) return
    await runNb(async () => {
      await api.notebookRename(from, newName)
      const to = `${parentOf(from)}/${newName}`
      afterRelocate(from, to)
    })
  }

  /** After a rename/move of `from` to `to`, migrate the selection and expanded keys. */
  const afterRelocate = (from: string, to: string): void => {
    setExpanded((prev) => new Set([...prev].map((p) => rewritePath(p, from, to))))
    setSelected((prev) => (prev ? rewritePath(prev, from, to) : prev))
  }

  const del = async (path: string): Promise<void> => {
    const ok = await actions.confirm({
      title: t('notebook.deleteTitle'),
      body: t('notebook.deleteBody', { name: baseOf(path) }),
      confirmLabel: t('common.remove'),
      danger: true,
    })
    if (!ok) return
    await runNb(async () => {
      await api.notebookDelete(path)
      if (selected === path || selected?.startsWith(`${path}/`)) {
        setSelected(null)
        setFile(null)
      }
    })
  }

  const dropMove = async (destDir: string): Promise<void> => {
    const from = moving
    setMoving(null)
    if (!from) return
    await runNb(async () => {
      await api.notebookMove(from, destDir)
      const to = `${destDir}/${baseOf(from)}`
      afterRelocate(from, to)
    })
  }

  const save = async (): Promise<void> => {
    if (!selected) return
    await runNb(
      async () => {
        await api.notebookWrite(selected, draft)
        setEditing(false)
        setFile(await api.notebookRead(selected))
      },
      state.syncEngine?.auto === false ? t('notebook.savedNotUploaded') : t('notebook.saved'),
    )
  }

  const copy = async (): Promise<void> => {
    if (!file) return
    try {
      await api.clipboardWrite(file.content)
      actions.notify(t('notebook.copied'), 'ok')
    } catch (e) {
      actions.notify(normalizeError(e), 'err')
    }
  }

  /**
   * Restores a past version through the normal save path (a local commit). History
   * is only reachable outside edit mode, so there is never an unsaved draft to lose;
   * the guard below keeps that true even if the UI changes.
   */
  const restore = async (v: NotebookVersion): Promise<void> => {
    const rel = selected
    if (!rel || editing) return
    const ok = await actions.confirm({
      title: t('notebook.history.restoreTitle'),
      body: t('notebook.history.restoreBody', {
        name: baseOf(rel),
        date: versionDate(v.at, i18n.resolvedLanguage),
        hash: v.shortHash,
      }),
      confirmLabel: t('notebook.history.restoreConfirm'),
    })
    if (!ok) return
    await runNb(async () => {
      const r = await api.notebookRestoreVersion(rel, v.hash, v.path)
      setFile(await api.notebookRead(rel))
      setHistoryOpen(false)
      actions.notify(
        r.committed ? t('notebook.history.restored') : t('notebook.history.alreadyCurrent'),
        r.committed ? 'ok' : 'info',
      )
    })
  }

  /** Opens a search result and expands the tree down to it (for when the search clears). */
  const openFromSearch = (rel: string): void => {
    setExpanded((prev) => new Set([...prev, ...ancestorDirs(rel)]))
    void openNote(rel)
  }

  const openFirstResult = (): void => {
    const first = search.result?.hits[0]
    if (first) openFromSearch(first.path)
  }

  const clearSearch = (): void => {
    setQuery('')
    searchRef.current?.focus()
  }

  const ctx: TreeCtx = {
    selected,
    expanded,
    creating,
    renaming,
    moving,
    busy,
    onToggle: toggle,
    onSelect: (p) => void openNote(p),
    onStartCreate: startCreate,
    onSubmitCreate: (n) => void submitCreate(n),
    onCancelCreate: () => setCreating(null),
    onStartRename: (p) => {
      setCreating(null)
      setMoving(null)
      setRenaming(p)
    },
    onSubmitRename: (n) => void submitRename(n),
    onCancelRename: () => setRenaming(null),
    onStartMove: (p) => {
      setCreating(null)
      setRenaming(null)
      setMoving(p)
    },
    onDropMove: (d) => void dropMove(d),
    onDelete: (p) => void del(p),
  }

  const ahead = state.status?.ahead ?? 0
  const unsynced =
    ahead > 0 ? (
      <span className="cluster">
        <span className="pill">
          <Icon name="arrow-up" size={13} /> {t('notebook.unsynced', { count: ahead })}
        </span>
        <Button size="sm" icon="sync" onClick={() => void actions.syncNow()}>
          {t('sync.syncNow')}
        </Button>
      </span>
    ) : undefined

  return (
    <div className="view view--wide">
      <ViewHeader
        eyebrow={t('notebook.eyebrow')}
        title={t('notebook.title')}
        sub={t('notebook.sub')}
        action={unsynced}
      />

      {!connected ? (
        <EmptyState icon="book" title={t('notebook.notConnected')}>
          {t('notebook.notConnectedHint')}
        </EmptyState>
      ) : (
        <div className="notebook">
          <aside className="notebook__tree">
            <NotebookSearchBox
              value={query}
              inputRef={searchRef}
              onChange={setQuery}
              onSubmit={openFirstResult}
            />
            {moving && (
              <div className="notebook__moving">
                <span className="grow truncate">
                  {t('notebook.movingBanner', { name: baseOf(moving) })}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setMoving(null)}>
                  {t('common.cancel')}
                </Button>
              </div>
            )}
            {searching ? (
              <NotebookSearchResults
                query={query}
                state={search}
                selected={selected}
                onOpen={openFromSearch}
                onClear={clearSearch}
              />
            ) : tree ? (
              <NotebookTreeView tree={tree} ctx={ctx} />
            ) : (
              <p className="muted nb-tree__empty">{t('common.loading')}</p>
            )}
          </aside>

          <section className="notebook__detail">
            {selected && file && historyOpen ? (
              <NoteHistory
                path={selected}
                name={baseOf(selected)}
                busy={busy}
                onBack={() => setHistoryOpen(false)}
                onRestore={(v) => void restore(v)}
              />
            ) : selected && file ? (
              <NoteDetail
                path={selected}
                name={baseOf(selected)}
                file={file}
                editing={editing}
                draft={draft}
                busy={busy}
                onDraft={setDraft}
                onEdit={() => {
                  setDraft(file.content)
                  setEditing(true)
                }}
                onCancelEdit={() => setEditing(false)}
                onSave={() => void save()}
                onCopy={() => void copy()}
                onHistory={() => setHistoryOpen(true)}
              />
            ) : (
              <EmptyState icon="file-text" title={t('notebook.pickTitle')}>
                {t('notebook.pickHint')}
              </EmptyState>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
