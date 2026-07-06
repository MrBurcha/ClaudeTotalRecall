import { useEffect, useState } from 'react'
import { StatusDot } from '../components/Badge'
import { Button } from '../components/Button'
import { TextArea } from '../components/Field'
import { SegmentedControl } from '../components/SegmentedControl'
import { AutoToggle } from '../features/sync/AutoToggle'
import { api } from '../state/api'
import { useAppState } from '../state/store'
import { useActions } from '../state/useActions'
import { ViewHeader } from './ViewHeader'

export function Settings(): JSX.Element {
  const { config, preflight, busy, version, syncEngine } = useAppState()
  const actions = useActions()
  const intervalValue = String(syncEngine?.intervalMs ?? 120_000)
  const [remote, setRemote] = useState('')
  const [localJson, setLocalJson] = useState('{}')

  useEffect(() => {
    void api.settingsLocalLoad().then((o) => setLocalJson(JSON.stringify(o, null, 2)))
  }, [])

  const connect = (): Promise<void> =>
    actions.run(async () => {
      const r = await api.repoConnect(remote.trim())
      return r.initialized ? 'Repo conectado (estructura creada).' : 'Repo conectado.'
    })

  const saveLocal = (): Promise<void> =>
    actions.run(async () => {
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(localJson)
      } catch {
        throw new Error('JSON inválido.')
      }
      await api.settingsLocalSave(parsed)
      return 'Overrides locales guardados.'
    })

  return (
    <div className="view">
      <ViewHeader
        eyebrow="Configuración"
        title="Ajustes"
        sub="Requisitos del sistema, repo y overrides locales de settings."
      />

      <div className="card">
        <div className="card__head">
          <span className="card__title">Requisitos</span>
        </div>
        <ul className="check-list">
          {(preflight?.checks ?? []).map((c) => (
            <li key={c.name} className="check-row">
              <StatusDot tone={c.ok ? 'ok' : 'danger'} />
              <div className="grow">
                <div className="cluster">
                  <b className="mono">{c.name}</b>
                  {c.detail && <span className="muted">{c.detail}</span>}
                </div>
                {!c.ok && c.fix && <div className="muted mono check-fix">→ {c.fix}</div>}
              </div>
            </li>
          ))}
        </ul>
        <div className="row">
          <Button icon="sync" disabled={busy} onClick={() => void actions.refresh()}>
            Volver a chequear
          </Button>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <span className="card__title">Repo</span>
        </div>
        {config ? (
          <p className="mono muted truncate">{config.repo.remote}</p>
        ) : (
          <div className="row row-nowrap">
            <input
              className="input input--mono grow"
              placeholder="git@github.com:usuario/claude-memories.git"
              value={remote}
              onChange={(e) => setRemote(e.target.value)}
            />
            <Button variant="primary" icon="git-branch" disabled={busy || !remote.trim()} onClick={connect}>
              Conectar
            </Button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card__head">
          <span className="card__title">Sincronización automática</span>
        </div>
        <p className="muted">
          Sube al instante cuando cambian los archivos y baja del repo cada tanto. Corre mientras la
          app está abierta.
        </p>
        <div className="row between">
          <AutoToggle />
          <div className="stack stack-1">
            <span className="label">Chequeo del remoto</span>
            <SegmentedControl<string>
              ariaLabel="Frecuencia de chequeo del remoto"
              value={intervalValue}
              onChange={(ms) => void actions.setSyncInterval(Number(ms))}
              options={[
                { value: '30000', label: '30 s' },
                { value: '60000', label: '1 min' },
                { value: '120000', label: '2 min' },
                { value: '300000', label: '5 min' },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <span className="card__title">settings.local.json</span>
        </div>
        <p className="muted">Las claves acá se quedan en esta máquina y no viajan al repo.</p>
        <TextArea value={localJson} onChange={(e) => setLocalJson(e.target.value)} spellCheck={false} />
        <div className="row">
          <Button variant="primary" icon="check" disabled={busy} onClick={saveLocal}>
            Guardar
          </Button>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <span className="card__title">Acerca de</span>
        </div>
        <p className="muted">
          ClaudeTR v{version ?? '—'} — sincroniza la memoria de Claude Code entre tus máquinas vía un
          repo privado de GitHub.
        </p>
      </div>
    </div>
  )
}
