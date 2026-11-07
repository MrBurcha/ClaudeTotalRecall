import { useTranslation } from 'react-i18next'
import { Icon } from '../../components/Icon'
import type { PinnedEntry, PinnedGroup, PinnedTarget } from './pinnedGroups'

export interface PinnedTreeProps {
  groups: PinnedGroup[]
  selected: string | null
  machineId: string | null
  /** false until this machine is registered (nothing can be pinned yet) */
  canAdd: boolean
  isOpen: (groupId: string) => boolean
  onToggle: (groupId: string) => void
  onSelect: (key: string) => void
  onAdd: (target: PinnedTarget) => void
}

function EntryRow({
  entry,
  selected,
  machineId,
  onSelect,
}: {
  entry: PinnedEntry
  selected: boolean
  machineId: string | null
  onSelect: (key: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const missingHere = !!machineId && !entry.byMachine[machineId]
  return (
    <div
      className={['nb-tree__row pinned-tree__entry', selected ? 'nb-tree__row--active' : '']
        .filter(Boolean)
        .join(' ')}
      title={entry.key}
      onClick={() => onSelect(entry.key)}
    >
      <span className="nb-tree__chev" />
      <Icon name="file-text" size={15} />
      <span className="grow truncate">{entry.name}</span>
      {missingHere && (
        <span className="pinned-tree__missing" title={t('pinned.noPathHere')}>
          <Icon name="alert" size={13} />
        </span>
      )}
    </div>
  )
}

function GroupRow({ group, ...p }: PinnedTreeProps & { group: PinnedGroup }): JSX.Element {
  const { t } = useTranslation()
  const open = p.isOpen(group.id)
  const general = group.scope === 'general'
  const target: PinnedTarget = general
    ? { scope: 'general' }
    : { scope: 'project', project: group.project ?? '' }
  const addLabel = general ? t('pinned.addGeneral') : t('pinned.addToProject')

  return (
    <div className="nb-tree__group">
      <div className="nb-tree__row nb-tree__root" onClick={() => p.onToggle(group.id)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} className="nb-tree__chev" />
        <Icon name={general ? 'pin' : 'folder'} size={15} />
        <span className="grow truncate">{general ? t('pinned.general') : group.project}</span>
        {group.entries.length > 0 && (
          <span className="muted pinned-tree__count nums">{group.entries.length}</span>
        )}
        {p.canAdd && (
          <button
            type="button"
            className="nb-menu__trigger pinned-tree__add"
            aria-label={addLabel}
            title={addLabel}
            onClick={(e) => {
              e.stopPropagation()
              p.onAdd(target)
            }}
          >
            <Icon name="plus" size={15} />
          </button>
        )}
      </div>
      {open && (
        <>
          {group.entries.map((e) => (
            <EntryRow
              key={e.key}
              entry={e}
              selected={p.selected === e.key}
              machineId={p.machineId}
              onSelect={p.onSelect}
            />
          ))}
          {group.entries.length === 0 && (
            <div className="nb-tree__empty muted pinned-tree__empty">{t('pinned.emptyGroup')}</div>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Left pane of the Pinned module: the Notebook's tree pattern (same classes), with
 * General first and one group per project. Each group's "+" starts a new file there.
 */
export function PinnedTree(props: PinnedTreeProps): JSX.Element {
  return (
    <div className="nb-tree">
      {props.groups.map((g) => (
        <GroupRow key={g.id} group={g} {...props} />
      ))}
    </div>
  )
}
