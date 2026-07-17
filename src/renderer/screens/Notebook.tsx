import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { NoteDetail } from '../features/notebook/NoteDetail'
import { NotebookTreeView, type TreeCtx } from '../features/notebook/NotebookTree'
import { api, normalizeError } from '../state/api'
import { useAppState } from '../state/store'
import { useActions } from '../state/useActions'
import { ViewHeader } from './ViewHeader'
import type { NotebookFile, NotebookTree } from '../../core/types'

const parentOf = (rel: string): string => rel.split('/').slice(0, -1).join('/')
const baseOf = (rel: string): string => rel.split('/').slice(-1)[0]

/** Rewrites a path after `from` was renamed/moved to `to`: exact match or descendant. */
const rewritePath = (p: string, from: string, to: string): string =>
  p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p

export function Notebook(): JSX.Element {
  const { t } = useTranslation()
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
    await runNb(async () => {
      await api.notebookWrite(selected, draft)
      setEditing(false)
      setFile(await api.notebookRead(selected))
    }, t('notebook.saved'))
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
            {tree ? (
              <NotebookTreeView tree={tree} ctx={ctx} />
            ) : (
              <p className="muted nb-tree__empty">{t('common.loading')}</p>
            )}
          </aside>

          <section className="notebook__detail">
            {selected && file ? (
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
