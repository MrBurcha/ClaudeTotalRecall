import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { Icon } from '../../components/Icon'
import { SegmentedControl } from '../../components/SegmentedControl'
import { api } from '../../state/api'
import { useAppState } from '../../state/store'
import { useActions } from '../../state/useActions'

type Side = 'local' | 'remote'

/**
 * Replaces the red banner. Collects the local/remote choice per file and only
 * applies everything and closes the merge at the end (so the list doesn't
 * disappear as it gets resolved). Local = what's on this machine; Remote = what's
 * in the repo.
 */
export function ConflictResolver({ files }: { files: string[] }): JSX.Element {
  const { t } = useTranslation()
  const { busy } = useAppState()
  const actions = useActions()
  const [choices, setChoices] = useState<Record<string, Side>>({})
  const allChosen = files.every((f) => choices[f])

  const finalize = (): Promise<void> =>
    actions.run(async () => {
      for (const f of files) await api.conflictResolve(f, choices[f])
      const r = await api.conflictComplete()
      return r.pushed ? t('conflicts.resolvedPushed') : t('conflicts.resolved')
    })

  return (
    <div className="card card--danger">
      <div className="card__head">
        <span className="card__title cluster">
          <Icon name="alert" size={18} />
          {t('conflicts.title', { count: files.length })}
        </span>
      </div>
      <p className="muted">
        <Trans i18nKey="conflicts.explainer" components={{ b: <b /> }} />
      </p>
      <ul className="conflict-list">
        {files.map((f) => (
          <li key={f} className="conflict-row">
            <span className="mono grow truncate">{f}</span>
            <SegmentedControl<Side>
              ariaLabel={t('conflicts.resolutionFor', { name: f })}
              value={choices[f] ?? null}
              onChange={(side) => setChoices((c) => ({ ...c, [f]: side }))}
              options={[
                { value: 'local', label: t('conflicts.local') },
                { value: 'remote', label: t('conflicts.remote') },
              ]}
            />
          </li>
        ))}
      </ul>
      <div className="row between">
        <span className="muted">
          {allChosen ? t('conflicts.readyToFinalize') : t('conflicts.chooseEach')}
        </span>
        <Button variant="primary" icon="check" disabled={busy || !allChosen} onClick={finalize}>
          {t('conflicts.finalizeMerge')}
        </Button>
      </div>
    </div>
  )
}
