import { useState } from 'react'
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
  const { config, machineId, busy } = useAppState()
  const actions = useActions()
  const [name, setName] = useState('')
  const machines = config ? Object.entries(config.machines) : []

  const register = (): Promise<void> =>
    actions.run(async () => {
      const r = await api.machineRegister(name.trim() || undefined)
      return `Máquina "${r.machineId}" registrada.`
    })

  return (
    <div className="view">
      <ViewHeader
        eyebrow="Identidad"
        title="Máquinas"
        sub="Cada computadora que sincroniza tiene un id lógico y su propio home."
      />

      {!config ? (
        <div className="card">
          <EmptyState icon="git-branch" title="Conectá un repo primero">
            Configurá el repo en Ajustes o desde el asistente.
          </EmptyState>
        </div>
      ) : !machineId ? (
        <div className="card">
          <div className="card__head">
            <span className="card__title">Registrar esta máquina</span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void register()
            }}
          >
            <TextField
              label="Nombre lógico (opcional)"
              placeholder="thinkpad-t480"
              value={name}
              onChange={(e) => setName(e.target.value)}
              hint="Si lo dejás vacío, usamos el hostname."
            />
          </form>
          <div className="row">
            <Button variant="primary" icon="monitor" disabled={busy} onClick={register}>
              Registrar
            </Button>
          </div>
        </div>
      ) : (
        <div className="card">
          <span className="cluster">
            <StatusDot tone="ok" />
            Esta máquina está registrada como <b className="mono">{machineId}</b>.
          </span>
        </div>
      )}

      <div className="card">
        <div className="card__head">
          <span className="card__title">Máquinas conocidas ({machines.length})</span>
        </div>
        {machines.length === 0 ? (
          <EmptyState icon="monitor" title="Ninguna todavía">
            Registrá esta máquina para empezar.
          </EmptyState>
        ) : (
          <ul className="machine-list">
            {machines.map(([id, m]) => (
              <li key={id} className="machine-row">
                <div className="machine-row__main">
                  <Icon name="monitor" size={17} />
                  <b className="mono">{id}</b>
                  {id === machineId && <Badge>esta</Badge>}
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
