import { Trans, useTranslation } from 'react-i18next'
import { Badge, StatusDot } from '../../components/Badge'
import { Icon } from '../../components/Icon'
import { useAppState } from '../../state/store'

/**
 * Machines section, rendered inside Settings (#13 — Machines is no longer a
 * top-level route). When Settings is visible the machine is always registered
 * (otherwise the onboarding wizard takes over), so this only shows the
 * registered state + the read-only known-machines list. Registration itself
 * lives in the wizard's register step.
 */
export function MachinesCard(): JSX.Element | null {
  const { t } = useTranslation()
  const { config, machineId } = useAppState()
  if (!config) return null
  const machines = Object.entries(config.machines)

  return (
    <div className="card">
      <div className="card__head">
        <span className="card__title">{t('machines.title')}</span>
      </div>
      {machineId && (
        <span className="cluster">
          <StatusDot tone="ok" />
          <Trans
            i18nKey="machines.registeredAs"
            values={{ machineId }}
            components={{ b: <b className="mono" /> }}
          />
        </span>
      )}
      <div className="stack stack-2">
        <span className="label">{t('machines.knownMachines', { count: machines.length })}</span>
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
      </div>
    </div>
  )
}
