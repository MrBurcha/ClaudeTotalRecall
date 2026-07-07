import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Badge, StatusDot } from '../components/Badge'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { TextField } from '../components/Field'
import { Icon } from '../components/Icon'
import { api } from '../state/api'
import { useAppState } from '../state/store'
import { useActions } from '../state/useActions'
import { ViewHeader } from './ViewHeader'

export function Machines(): JSX.Element {
  const { t } = useTranslation()
  const { config, machineId, busy } = useAppState()
  const actions = useActions()
  const [name, setName] = useState('')
  const machines = config ? Object.entries(config.machines) : []

  const register = (): Promise<void> =>
    actions.run(async () => {
      const r = await api.machineRegister(name.trim() || undefined)
      return t('machines.registered', { machineId: r.machineId })
    })

  return (
    <div className="view">
      <ViewHeader
        eyebrow={t('machines.eyebrow')}
        title={t('machines.title')}
        sub={t('machines.sub')}
      />

      {!config ? (
        <div className="card">
          <EmptyState icon="git-branch" title={t('machines.connectRepoTitle')}>
            {t('machines.connectRepoBody')}
          </EmptyState>
        </div>
      ) : !machineId ? (
        <div className="card">
          <div className="card__head">
            <span className="card__title">{t('machines.registerThisMachine')}</span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void register()
            }}
          >
            <TextField
              label={t('machines.logicalNameLabel')}
              placeholder="thinkpad-t480"
              value={name}
              onChange={(e) => setName(e.target.value)}
              hint={t('machines.logicalNameHint')}
            />
          </form>
          <div className="row">
            <Button variant="primary" icon="monitor" disabled={busy} onClick={register}>
              {t('machines.register')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="card">
          <span className="cluster">
            <StatusDot tone="ok" />
            <Trans
              i18nKey="machines.registeredAs"
              values={{ machineId }}
              components={{ b: <b className="mono" /> }}
            />
          </span>
        </div>
      )}

      <div className="card">
        <div className="card__head">
          <span className="card__title">{t('machines.knownMachines', { count: machines.length })}</span>
        </div>
        {machines.length === 0 ? (
          <EmptyState icon="monitor" title={t('machines.noneYetTitle')}>
            {t('machines.noneYetBody')}
          </EmptyState>
        ) : (
          <ul className="machine-list">
            {machines.map(([id, m]) => (
              <li key={id} className="machine-row">
                <div className="machine-row__main">
                  <Icon name="monitor" size={17} />
                  <b className="mono">{id}</b>
                  {id === machineId && <Badge>{t('machines.thisMachine')}</Badge>}
                </div>
                <div className="muted mono machine-row__meta truncate">
                  {m.os} · {m.hostname} · {m.home}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
