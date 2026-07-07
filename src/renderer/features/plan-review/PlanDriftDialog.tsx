import { Trans, useTranslation } from 'react-i18next'

import { Button } from '../../components/Button'
import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import type { ModalDescriptor } from '../../state/types'
import { useActions } from '../../state/useActions'

/**
 * Shown when executePlan reports drift (the disk changed between the preview and
 * execution). Offers to rebuild (safe) or force (applies the old plan).
 */
export function PlanDriftDialog({
  modal,
}: {
  modal: Extract<ModalDescriptor, { kind: 'plan-drift' }>
}): JSX.Element {
  const { verb, planId, drifted } = modal
  const actions = useActions()
  const { t } = useTranslation()

  return (
    <Modal
      title={
        <span className="cluster">
          <Icon name="alert" size={18} />
          {t('planDrift.title')}
        </span>
      }
      onClose={actions.closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={actions.closeModal}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={() => actions.executePlan(verb, planId, true)}>
            {t('planDrift.forceAnyway')}
          </Button>
          <Button variant="primary" icon="sync" onClick={() => actions.rebuildPlan(verb)}>
            {t('planDrift.rebuild')}
          </Button>
        </>
      }
    >
      <p className="dim">{t('planDrift.body', { count: drifted.length })}</p>
      <ul className="plan-list">
        {drifted.map((a) => (
          <li key={a.slot} className="plan-row">
            <span className="plan-row__head">
              <span className="mono truncate">{a.logicalPath}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="muted">
        <Trans i18nKey="planDrift.help" components={{ b: <b /> }} />
      </p>
    </Modal>
  )
}
