import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { PinnedCreate } from '../features/pinned/PinnedCreate'
import { PinnedDetail } from '../features/pinned/PinnedDetail'
import { PinnedTree } from '../features/pinned/PinnedTree'
import {
  buildPinnedTree,
  findPinnedEntry,
  groupId,
  type PinnedGroup,
  type PinnedTarget,
} from '../features/pinned/pinnedGroups'
import { useAppState } from '../state/store'
import { ViewHeader } from './ViewHeader'

/** The group holding `key`, if any (to open it when its file gets selected). */
function groupOf(groups: PinnedGroup[], key: string): string | undefined {
  return groups.find((g) => g.entries.some((e) => e.key === key))?.id
}

/**
 * Pinned files module (#113): every single-file source in one two-pane tree, like
 * the Notebook. General holds the global pins; each project holds its file slots.
 * Selecting a file shows where it lives and its path on each machine; "+" on a
 * group (or the header button, for General) pins a new one there.
 */
export function Pinned(): JSX.Element {
  const { t } = useTranslation()
  const { config, machineId, focus } = useAppState()
  const groups = useMemo(() => (config ? buildPinnedTree(config) : []), [config])

  // A jump from elsewhere (the Projects overview) lands on that file.
  const [selected, setSelected] = useState<string | null>(() =>
    focus?.route === 'pinned' ? focus.target : null,
  )
  const [creating, setCreating] = useState<PinnedTarget | null>(null)
  // Groups with files start open, empty ones closed; a click overrides either way.
  const [openOverride, setOpenOverride] = useState<Map<string, boolean>>(() => {
    const id = selected ? groupOf(groups, selected) : undefined
    return new Map(id ? [[id, true]] : [])
  })

  const isOpen = (id: string): boolean => {
    const o = openOverride.get(id)
    if (o !== undefined) return o
    return id === 'general' || !!groups.find((g) => g.id === id)?.entries.length
  }
  const setOpen = (id: string, open: boolean): void =>
    setOpenOverride((prev) => new Map(prev).set(id, open))

  const select = (key: string): void => {
    setCreating(null)
    setSelected(key)
  }
  const startCreate = (target: PinnedTarget): void => {
    setOpen(groupId(target), true)
    setCreating(target)
  }
  const onCreated = (key: string): void => {
    setCreating(null)
    setSelected(key)
  }

  // The selected file can vanish (removed here, or by a sync) → back to the hint.
  const entry = findPinnedEntry(groups, selected)
  const registered = !!machineId

  return (
    <div className="view view--wide">
      <ViewHeader
        eyebrow={t('pinned.eyebrow')}
        title={t('pinned.title')}
        sub={t('pinned.sub')}
        action={
          config ? (
            <Button
              variant="primary"
              icon="pin"
              disabled={!registered}
              onClick={() => startCreate({ scope: 'general' })}
            >
              {t('pinned.add')}
            </Button>
          ) : undefined
        }
      />

      {!config ? (
        <EmptyState icon="pin" title={t('pinned.notConnected')}>
          {t('pinned.notConnectedHint')}
        </EmptyState>
      ) : (
        <div className="notebook">
          <aside className="notebook__tree">
            <PinnedTree
              groups={groups}
              selected={creating ? null : selected}
              machineId={machineId}
              canAdd={registered}
              isOpen={isOpen}
              onToggle={(id) => setOpen(id, !isOpen(id))}
              onSelect={select}
              onAdd={startCreate}
            />
          </aside>

          <section className="notebook__detail">
            {creating ? (
              <PinnedCreate
                key={groupId(creating)}
                target={creating}
                onCancel={() => setCreating(null)}
                onCreated={onCreated}
              />
            ) : entry ? (
              <PinnedDetail key={entry.key} entry={entry} />
            ) : (
              <EmptyState icon="file-text" title={t('pinned.pickTitle')}>
                {registered ? t('pinned.pickHint') : t('pinned.registerFirst')}
              </EmptyState>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
