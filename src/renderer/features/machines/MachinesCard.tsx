import { Trans, useTranslation } from 'react-i18next'
import { Badge, StatusDot } from '../../components/Badge'
import { Icon } from '../../components/Icon'
import { IconButton } from '../../components/IconButton'
import { api } from '../../state/api'
import { useAppState } from '../../state/store'
import { useActions } from '../../state/useActions'

/**
 * Machines section, rendered inside Settings (#13 — Machines is no longer a
 * top-level route). When Settings is visible the machine is always registered
 * (otherwise the onboarding wizard takes over), so this only shows the
 * registered state + the known-machines list. Registration itself lives in the
 * wizard's register step; a machine that's gone for good can be removed here (it
 * would otherwise keep the automatic shared-config rename waiting forever).
 */
export function MachinesCard(): JSX.Element | null {
  const { t } = useTranslation()
  const { config, machineId, busy } = useAppState()
  const actions = useActions()
  if (!config) return null

  const remove = async (id: string): Promise<void> => {
    const ok = await actions.confirm({
      title: t('machines.removeTitle', { machineId: id }),
      body: t('machines.removeBody', { machineId: id }),
      confirmLabel: t('machines.removeConfirm'),
      danger: true,
    })
    if (!ok) return
    await actions.run(async () => {
      await api.machineRemove(id)
      return t('machines.removed', { machineId: id })
    })
  }
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
                {id === machineId ? (
                  <Badge>{t('machines.thisMachine')}</Badge>
                ) : (
                  <IconButton
                    icon="trash"
                    size={15}
                    label={t('machines.removeLabel', { machineId: id })}
                    disabled={busy}
                    onClick={() => void remove(id)}
                    className="machine-row__remove"
                  />
                )}
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
