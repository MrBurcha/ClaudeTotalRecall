import { useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Icon } from '../../components/Icon'
import { Menu, type MenuAction } from '../../components/Menu'
import type { NotebookNode, NotebookRoot, NotebookTree } from '../../../core/types'

export interface TreeCtx {
  selected: string | null
  expanded: Set<string>
  creating: { parent: string; kind: 'note' | 'folder' } | null
  renaming: string | null
  moving: string | null
  busy: boolean
  onToggle: (path: string) => void
  onSelect: (path: string) => void
  onStartCreate: (parent: string, kind: 'note' | 'folder') => void
  onSubmitCreate: (name: string) => void
  onCancelCreate: () => void
  onStartRename: (path: string) => void
  onSubmitRename: (name: string) => void
  onCancelRename: () => void
  onStartMove: (path: string) => void
  onDropMove: (destDir: string) => void
  onDelete: (path: string) => void
}

/** A transient inline text input for creating or renaming an entry. */
function InlineInput({
  initial,
  placeholder,
  onSubmit,
  onCancel,
}: {
  initial: string
  placeholder: string
  onSubmit: (v: string) => void
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState(initial)
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const v = value.trim()
      if (v) onSubmit(v)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }
  return (
    <input
      className="input input--mono nb-tree__input"
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKey}
      onBlur={onCancel}
      autoFocus
      spellCheck={false}
    />
  )
}

/**
 * The kebab menu actions for a row. Containers (a root or a folder) can add a note
 * or subfolder; anything but a root can also be renamed, moved or deleted.
 */
function rowActions(
  ctx: TreeCtx,
  t: TFunction,
  path: string,
  kind: 'root' | 'dir' | 'file',
): MenuAction[] {
  const actions: MenuAction[] = []
  if (kind === 'root' || kind === 'dir') {
    actions.push(
      {
        icon: 'file-plus',
        label: t('notebook.newNote'),
        onSelect: () => ctx.onStartCreate(path, 'note'),
      },
      {
        icon: 'folder-plus',
        label: t('notebook.newFolder'),
        onSelect: () => ctx.onStartCreate(path, 'folder'),
      },
    )
  }
  if (kind !== 'root') {
    actions.push(
      { icon: 'pencil', label: t('notebook.rename'), onSelect: () => ctx.onStartRename(path) },
      { icon: 'arrow-right', label: t('notebook.move'), onSelect: () => ctx.onStartMove(path) },
      {
        icon: 'trash',
        label: t('common.remove'),
        danger: true,
        onSelect: () => ctx.onDelete(path),
      },
    )
  }
  return actions
}

/** The create-note/folder input, shown as the first child of its target container. */
function CreateRow({ ctx, parent }: { ctx: TreeCtx; parent: string }): JSX.Element | null {
  const { t } = useTranslation()
  if (!ctx.creating || ctx.creating.parent !== parent) return null
  const isNote = ctx.creating.kind === 'note'
  return (
    <div
      className="nb-tree__row nb-tree__row--input"
      style={{ paddingLeft: depth(parent) * 14 + 26 }}
    >
      <Icon name={isNote ? 'file-text' : 'folder'} size={15} />
      <InlineInput
        initial=""
        placeholder={isNote ? t('notebook.notePlaceholder') : t('notebook.folderPlaceholder')}
        onSubmit={ctx.onSubmitCreate}
        onCancel={ctx.onCancelCreate}
      />
    </div>
  )
}

function depth(path: string): number {
  return path.split('/').length - 1
}

function TreeNode({ node, ctx }: { node: NotebookNode; ctx: TreeCtx }): JSX.Element {
  const { t } = useTranslation()
  const pad = depth(node.path) * 14 + 8
  const isDir = node.kind === 'dir'
  const open = ctx.expanded.has(node.path)
  const renaming = ctx.renaming === node.path
  const isMoveSelf = ctx.moving === node.path || node.path.startsWith(`${ctx.moving}/`)
  const dropTarget = isDir && ctx.moving !== null && !isMoveSelf

  const onRowClick = (): void => {
    if (ctx.moving && dropTarget) return ctx.onDropMove(node.path)
    if (isDir) ctx.onToggle(node.path)
    else ctx.onSelect(node.path)
  }

  return (
    <>
      <div
        className={[
          'nb-tree__row',
          !isDir && ctx.selected === node.path ? 'nb-tree__row--active' : '',
          dropTarget ? 'nb-tree__row--drop' : '',
          isMoveSelf ? 'nb-tree__row--dim' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ paddingLeft: pad }}
        onClick={onRowClick}
      >
        {isDir ? (
          <Icon
            name={open ? 'chevron-down' : 'chevron-right'}
            size={14}
            className="nb-tree__chev"
          />
        ) : (
          <span className="nb-tree__chev" />
        )}
        <Icon name={isDir ? 'folder' : 'file-text'} size={15} />
        {renaming ? (
          <InlineInput
            initial={node.name}
            placeholder={node.name}
            onSubmit={ctx.onSubmitRename}
            onCancel={ctx.onCancelRename}
          />
        ) : (
          <span className="grow truncate">{node.name}</span>
        )}
        {!renaming && !ctx.moving && (
          <Menu
            label={t('notebook.actions')}
            actions={rowActions(ctx, t, node.path, isDir ? 'dir' : 'file')}
            disabled={ctx.busy}
          />
        )}
        {dropTarget && <span className="nb-tree__droplabel">{t('notebook.moveHere')}</span>}
      </div>
      {isDir && open && (
        <>
          <CreateRow ctx={ctx} parent={node.path} />
          {node.children?.map((c) => (
            <TreeNode key={c.path} node={c} ctx={ctx} />
          ))}
        </>
      )}
    </>
  )
}

function RootRow({ root, ctx }: { root: NotebookRoot; ctx: TreeCtx }): JSX.Element {
  const { t } = useTranslation()
  const open = ctx.expanded.has(root.path)
  const label = root.kind === 'general' ? t('notebook.general') : root.id
  const dropTarget =
    ctx.moving !== null && !root.path.startsWith(`${ctx.moving}/`) && ctx.moving !== root.path

  const onRowClick = (): void => {
    if (ctx.moving && dropTarget) return ctx.onDropMove(root.path)
    ctx.onToggle(root.path)
  }

  return (
    <div className="nb-tree__group">
      <div
        className={['nb-tree__row nb-tree__root', dropTarget ? 'nb-tree__row--drop' : '']
          .filter(Boolean)
          .join(' ')}
        onClick={onRowClick}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} className="nb-tree__chev" />
        <Icon name={root.kind === 'general' ? 'book' : 'folder'} size={15} />
        <span className="grow truncate">{label}</span>
        {!ctx.moving && (
          <Menu
            label={t('notebook.actions')}
            actions={rowActions(ctx, t, root.path, 'root')}
            disabled={ctx.busy}
          />
        )}
        {dropTarget && <span className="nb-tree__droplabel">{t('notebook.moveHere')}</span>}
      </div>
      {open && (
        <>
          <CreateRow ctx={ctx} parent={root.path} />
          {root.children.map((c) => (
            <TreeNode key={c.path} node={c} ctx={ctx} />
          ))}
          {root.children.length === 0 && !ctx.creating && (
            <div className="nb-tree__empty muted" style={{ paddingLeft: 34 }}>
              {t('notebook.emptyFolder')}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function NotebookTreeView({ tree, ctx }: { tree: NotebookTree; ctx: TreeCtx }): JSX.Element {
  return (
    <div className="nb-tree">
      {tree.roots.map((r) => (
        <RootRow key={r.path} root={r} ctx={ctx} />
      ))}
    </div>
  )
}
