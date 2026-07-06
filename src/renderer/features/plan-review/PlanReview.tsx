import { useMemo, useState } from 'react'
import type { PlanAction, PlanActionType } from '../../../core/types'
import { Button } from '../../components/Button'
import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import { SegmentedControl } from '../../components/SegmentedControl'
import { Tag } from '../../components/Badge'
import type { ModalDescriptor } from '../../state/types'
import { useActions } from '../../state/useActions'
import { groupActions, type PlanGroup } from './groupActions'

type Filter = 'all' | PlanActionType

function short(hash?: string): string {
  return hash ? hash.slice(0, 7) : '∅'
}

function visible(actions: PlanAction[], filter: Filter, showUnchanged: boolean): PlanAction[] {
  return actions.filter((a) => {
    if (filter !== 'all') return a.type === filter
    if (a.type === 'noop' || a.type === 'skip') return showUnchanged
    return true
  })
}

function CountChip({ type, n }: { type: PlanActionType; n: number }): JSX.Element {
  return (
    <span className="cluster">
      <Tag type={type} />
      <span className="nums dim">{n}</span>
    </span>
  )
}

function ActionRow({ action }: { action: PlanAction }): JSX.Element {
  const [open, setOpen] = useState(false)
  const hasDetails = !!(action.from || action.to || action.hashFrom || action.hashTo)
  return (
    <li className="plan-row">
      <button
        type="button"
        className="plan-row__head"
        onClick={() => hasDetails && setOpen((v) => !v)}
        aria-expanded={hasDetails ? open : undefined}
      >
        <Tag type={action.type} />
        <span className="mono grow truncate">{action.logicalPath}</span>
        {action.reason && <span className="muted plan-row__reason">{action.reason}</span>}
        {hasDetails && <Icon name={open ? 'chevron-down' : 'chevron-right'} size={15} />}
      </button>
      {open && hasDetails && (
        <div className="plan-row__details mono">
          {action.from && <div>desde: {action.from}</div>}
          {action.to && <div>hacia: {action.to}</div>}
          {(action.hashFrom || action.hashTo) && (
            <div>
              hash: {short(action.hashFrom)} → {short(action.hashTo)}
            </div>
          )}
          {action.transform && <div>contenido computado ({action.transform})</div>}
        </div>
      )}
    </li>
  )
}

function Group({
  group,
  filter,
  showUnchanged,
}: {
  group: PlanGroup
  filter: Filter
  showUnchanged: boolean
}): JSX.Element | null {
  const rows = visible(group.actions, filter, showUnchanged)
  if (rows.length === 0) return null
  return (
    <section className="stack-2">
      <div className="label">
        {group.kind === 'user' ? 'Usuario' : `Proyecto · ${group.title}`}
      </div>
      <ul className="plan-list">
        {rows.map((a) => (
          <ActionRow key={a.slot} action={a} />
        ))}
      </ul>
    </section>
  )
}

export function PlanReview({
  modal,
}: {
  modal: Extract<ModalDescriptor, { kind: 'plan-review' }>
}): JSX.Element {
  const { verb, plan } = modal
  const actions = useActions()
  const { groups, counts, mutating } = useMemo(() => groupActions(plan), [plan])
  const [filter, setFilter] = useState<Filter>('all')
  const [showUnchanged, setShowUnchanged] = useState(false)

  const dest = verb === 'gather' ? 'el repo' : 'tu máquina'
  const summaryParts: string[] = []
  if (counts.create) summaryParts.push(`crear ${counts.create}`)
  if (counts.overwrite) summaryParts.push(`sobrescribir ${counts.overwrite}`)
  if (counts.delete) summaryParts.push(`borrar ${counts.delete}`)

  const title = (
    <span className="cluster">
      Revisar cambios
      <span className="pill">
        <Icon name={verb === 'gather' ? 'arrow-up' : 'arrow-down'} size={14} />
        {verb === 'gather' ? 'máquina → repo' : 'repo → máquina'}
      </span>
    </span>
  )

  return (
    <Modal
      title={title}
      onClose={actions.closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={actions.closeModal}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            icon={verb === 'gather' ? 'arrow-up' : 'arrow-down'}
            disabled={!mutating}
            onClick={() => actions.executePlan(verb, plan.id)}
          >
            {verb === 'gather' ? 'Subir cambios' : 'Aplicar cambios'}
          </Button>
        </>
      }
    >
      {mutating ? (
        <p className="dim">
          Se van a {summaryParts.join(', ').replace(/, ([^,]*)$/, ' y $1')} archivo(s) en {dest}.
        </p>
      ) : (
        <p className="muted">Nada para hacer: todo está sincronizado.</p>
      )}

      <div className="cluster">
        <CountChip type="create" n={counts.create} />
        <CountChip type="overwrite" n={counts.overwrite} />
        <CountChip type="delete" n={counts.delete} />
      </div>

      {mutating && (
        <div className="row between">
          <SegmentedControl<Filter>
            ariaLabel="Filtrar por tipo"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'Todos' },
              { value: 'create', label: 'Crea' },
              { value: 'overwrite', label: 'Sobrescribe' },
              { value: 'delete', label: 'Borra' },
            ]}
          />
          <label className="cluster muted plan-toggle">
            <input
              type="checkbox"
              checked={showUnchanged}
              onChange={(e) => setShowUnchanged(e.target.checked)}
            />
            Mostrar sin cambios
          </label>
        </div>
      )}

      <div className="stack">
        {groups.map((g) => (
          <Group key={g.key} group={g} filter={filter} showUnchanged={showUnchanged} />
        ))}
      </div>
    </Modal>
  )
}
