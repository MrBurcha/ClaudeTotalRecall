import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const hasDetails = !!(action.from || action.to || action.hashFrom || action.hashTo)
  // The core ships an English default `reason` plus a stable `reasonCode`; localize
  // by code when present, falling back to the English default.
  const reason = action.reasonCode
    ? t(`planReason.${action.reasonCode}`, { ...action.reasonParams, defaultValue: action.reason })
    : action.reason
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
        {reason && <span className="muted plan-row__reason">{reason}</span>}
        {hasDetails && <Icon name={open ? 'chevron-down' : 'chevron-right'} size={15} />}
      </button>
      {open && hasDetails && (
        <div className="plan-row__details mono">
          {action.from && (
            <div>
              {t('planReview.from')}: {action.from}
            </div>
          )}
          {action.to && (
            <div>
              {t('planReview.to')}: {action.to}
            </div>
          )}
          {(action.hashFrom || action.hashTo) && (
            <div>
              hash: {short(action.hashFrom)} → {short(action.hashTo)}
            </div>
          )}
          {action.transform && (
            <div>
              {t('planReview.computed')} ({action.transform})
            </div>
          )}
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
  const { t } = useTranslation()
  const rows = visible(group.actions, filter, showUnchanged)
  if (rows.length === 0) return null
  return (
    <section className="stack-2">
      <div className="label">
        {group.kind === 'user'
          ? t('planReview.userGroup')
          : t('planReview.projectGroup', { name: group.title })}
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
  const { t } = useTranslation()
  const { verb, plan } = modal
  const actions = useActions()
  const { groups, counts, mutating } = useMemo(() => groupActions(plan), [plan])
  const [filter, setFilter] = useState<Filter>('all')
  const [showUnchanged, setShowUnchanged] = useState(false)

  const dest = verb === 'outgoing' ? t('planReview.destRepo') : t('planReview.destMachine')
  const parts: string[] = []
  if (counts.create) parts.push(t('planReview.partCreate', { count: counts.create }))
  if (counts.overwrite) parts.push(t('planReview.partOverwrite', { count: counts.overwrite }))
  if (counts.delete) parts.push(t('planReview.partDelete', { count: counts.delete }))
  const list =
    parts.length > 1
      ? `${parts.slice(0, -1).join(', ')} ${t('planReview.and')} ${parts[parts.length - 1]}`
      : (parts[0] ?? '')

  const title = (
    <span className="cluster">
      {t('planReview.title')}
      <span className="pill">
        <Icon name={verb === 'outgoing' ? 'arrow-up' : 'arrow-down'} size={14} />
        {verb === 'outgoing' ? t('planReview.dirOutgoing') : t('planReview.dirIncoming')}
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
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            icon={verb === 'outgoing' ? 'arrow-up' : 'arrow-down'}
            disabled={!mutating}
            onClick={() => actions.executePlan(verb, plan.id)}
          >
            {verb === 'outgoing' ? t('planReview.push') : t('planReview.apply')}
          </Button>
        </>
      }
    >
      {mutating ? (
        <p className="dim">{t('planReview.summary', { list, dest })}</p>
      ) : (
        <p className="muted">{t('planReview.nothing')}</p>
      )}

      <div className="cluster">
        <CountChip type="create" n={counts.create} />
        <CountChip type="overwrite" n={counts.overwrite} />
        <CountChip type="delete" n={counts.delete} />
      </div>

      {mutating && (
        <div className="row between">
          <SegmentedControl<Filter>
            ariaLabel={t('planReview.filterByType')}
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('planReview.filterAll') },
              { value: 'create', label: t('planReview.filterCreate') },
              { value: 'overwrite', label: t('planReview.filterOverwrite') },
              { value: 'delete', label: t('planReview.filterDelete') },
            ]}
          />
          <label className="cluster muted plan-toggle">
            <input
              type="checkbox"
              checked={showUnchanged}
              onChange={(e) => setShowUnchanged(e.target.checked)}
            />
            {t('planReview.showUnchanged')}
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
