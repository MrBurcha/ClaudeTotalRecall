import { useCallback, useEffect, useState } from 'react'
import type { Config, Plan, PreflightResult, Project, RepoStatus, Verb } from '../core/types'

const api = window.claudetr

type View = 'dashboard' | 'machines' | 'projects' | 'settings'
interface Toast {
  msg: string
  err?: boolean
}

export function App(): JSX.Element {
  const [view, setView] = useState<View>('dashboard')
  const [config, setConfig] = useState<Config | null>(null)
  const [status, setStatus] = useState<RepoStatus | null>(null)
  const [machineId, setMachineId] = useState<string | null>(null)
  const [preflight, setPreflight] = useState<PreflightResult | null>(null)
  const [planModal, setPlanModal] = useState<{ verb: Verb; plan: Plan } | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)

  const notify = useCallback((msg: string, err = false) => {
    setToast({ msg, err })
    setTimeout(() => setToast(null), 4200)
  }, [])

  const refresh = useCallback(async () => {
    const [cfg, mid, pf] = await Promise.all([
      api.configLoad(),
      api.machineCurrent(),
      api.preflightRun(),
    ])
    setConfig(cfg)
    setMachineId(mid)
    setPreflight(pf)
    if (cfg) {
      try {
        setStatus(await api.repoStatus())
      } catch {
        setStatus(null)
      }
    } else {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = useCallback(
    async (fn: () => Promise<string | void>) => {
      setBusy(true)
      try {
        const m = await fn()
        await refresh()
        if (m) notify(m)
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e), true)
      } finally {
        setBusy(false)
      }
    },
    [refresh, notify],
  )

  const openPlan = (verb: Verb) =>
    run(async () => {
      if (verb === 'scatter') {
        const pulled = await api.repoPull()
        if (!pulled.ok) {
          setStatus(await api.repoStatus())
          throw new Error(`Hay conflictos que resolver antes de scatter: ${pulled.conflicts.join(', ')}`)
        }
      }
      const plan = await api.planBuild(verb)
      setPlanModal({ verb, plan })
    })

  const confirmPlan = () => {
    if (!planModal) return
    const { verb, plan } = planModal
    setPlanModal(null)
    void run(async () => {
      const res = await api.planExecute(verb, plan.id)
      if ('conflicts' in res && res.conflicts.length > 0) {
        return `Conflictos al integrar: ${res.conflicts.join(', ')}. Resolvelos abajo.`
      }
      return `${verb} aplicado: ${res.exec.applied} acción(es).`
    })
  }

  const conflicts = status?.conflicted ?? []

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          ClaudeTR<small>Claude Total Recall</small>
        </div>
        {(['dashboard', 'machines', 'projects', 'settings'] as View[]).map((v) => (
          <button
            key={v}
            className={`navitem ${view === v ? 'active' : ''}`}
            onClick={() => setView(v)}
          >
            {{ dashboard: 'Dashboard', machines: 'Máquinas', projects: 'Proyectos', settings: 'Ajustes' }[v]}
          </button>
        ))}
        <div className="spacer" />
        <div className="pill">
          <span className={`dot ${machineId ? 'ok' : 'warn'}`} />
          {machineId ?? 'sin registrar'}
        </div>
      </nav>

      <main className="content">
        {conflicts.length > 0 && (
          <ConflictsBanner files={conflicts} busy={busy} run={run} />
        )}

        {view === 'dashboard' && (
          <Dashboard
            config={config}
            status={status}
            machineId={machineId}
            preflight={preflight}
            busy={busy}
            onGather={() => openPlan('gather')}
            onScatter={() => openPlan('scatter')}
            goSettings={() => setView('settings')}
          />
        )}
        {view === 'machines' && (
          <Machines config={config} machineId={machineId} busy={busy} run={run} />
        )}
        {view === 'projects' && (
          <Projects config={config} machineId={machineId} busy={busy} run={run} notify={notify} />
        )}
        {view === 'settings' && (
          <Settings config={config} preflight={preflight} busy={busy} run={run} refresh={refresh} />
        )}
      </main>

      {planModal && (
        <PlanPreview
          verb={planModal.verb}
          plan={planModal.plan}
          busy={busy}
          onConfirm={confirmPlan}
          onCancel={() => setPlanModal(null)}
        />
      )}
      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  )
}

// ── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard(props: {
  config: Config | null
  status: RepoStatus | null
  machineId: string | null
  preflight: PreflightResult | null
  busy: boolean
  onGather: () => void
  onScatter: () => void
  goSettings: () => void
}): JSX.Element {
  const { config, status, machineId, preflight, busy } = props
  const preflightOk = preflight?.ok ?? false
  const canSync = !!config && !!machineId && preflightOk

  return (
    <>
      <h1>Dashboard</h1>
      <p className="sub">Sincronizá la memoria de Claude Code entre tus máquinas.</p>

      {!preflightOk && (
        <div className="card">
          <h2>Preflight</h2>
          <p className="muted">Faltan requisitos (git/gh/auth). Revisalos en Ajustes.</p>
          <button className="btn" onClick={props.goSettings}>
            Ir a Ajustes
          </button>
        </div>
      )}
      {!config && preflightOk && (
        <div className="card">
          <h2>Conectá tu repo</h2>
          <p className="muted">Todavía no hay un repo conectado. Configuralo en Ajustes.</p>
          <button className="btn" onClick={props.goSettings}>
            Conectar repo
          </button>
        </div>
      )}
      {config && !machineId && (
        <div className="card">
          <h2>Registrá esta máquina</h2>
          <p className="muted">Esta computadora todavía no está registrada. Hacelo en Máquinas.</p>
        </div>
      )}

      <div className="card">
        <h2>Estado del repo</h2>
        {status ? (
          <div className="row" style={{ gap: 16 }}>
            <span className="pill">
              <span className="dot ok" />
              {status.branch}
            </span>
            <span className="pill">↑ {status.ahead} ahead</span>
            <span className="pill">↓ {status.behind} behind</span>
            <span className="pill">
              <span className={`dot ${status.dirty ? 'warn' : 'ok'}`} />
              {status.dirty ? 'con cambios' : 'limpio'}
            </span>
          </div>
        ) : (
          <p className="muted">Sin repo conectado.</p>
        )}
      </div>

      <div className="card">
        <h2>Sincronizar</h2>
        <div className="row">
          <button className="btn primary big" disabled={!canSync || busy} onClick={props.onGather}>
            Gather · máquina → repo
          </button>
          <button className="btn big" disabled={!canSync || busy} onClick={props.onScatter}>
            Scatter · repo → máquina
          </button>
        </div>
        <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
          Cada acción muestra un preview del Plan antes de tocar disco.
        </p>
      </div>
    </>
  )
}

// ── Máquinas ─────────────────────────────────────────────────────────────────
function Machines(props: {
  config: Config | null
  machineId: string | null
  busy: boolean
  run: (fn: () => Promise<string | void>) => Promise<void>
}): JSX.Element {
  const { config, machineId, busy, run } = props
  const [name, setName] = useState('')
  const machines = config ? Object.entries(config.machines) : []

  return (
    <>
      <h1>Máquinas</h1>
      <p className="sub">Cada computadora que sincroniza tiene un id lógico.</p>

      <div className="card">
        <h2>{machineId ? 'Esta máquina' : 'Registrar esta máquina'}</h2>
        {machineId ? (
          <p>
            Registrada como <b className="mono">{machineId}</b>.
          </p>
        ) : (
          <div className="row">
            <input
              className="txt"
              style={{ maxWidth: 260 }}
              placeholder="nombre lógico (ej. thinkpad-t480)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              className="btn primary"
              disabled={busy || !config}
              onClick={() =>
                run(async () => {
                  const r = await api.machineRegister(name.trim() || undefined)
                  return `Máquina "${r.machineId}" registrada.`
                })
              }
            >
              Registrar
            </button>
          </div>
        )}
        {!config && <p className="muted">Conectá un repo primero (Ajustes).</p>}
      </div>

      <div className="card">
        <h2>Máquinas conocidas ({machines.length})</h2>
        {machines.length === 0 ? (
          <p className="muted">Ninguna todavía.</p>
        ) : (
          <ul className="plain">
            {machines.map(([id, m]) => (
              <li key={id}>
                <b className="mono">{id}</b> {id === machineId && <span className="pill">esta</span>}
                <div className="muted mono">
                  {m.os} · {m.hostname} · {m.home}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

// ── Proyectos ────────────────────────────────────────────────────────────────
type RunFn = (fn: () => Promise<string | void>) => Promise<void>

/** Abre el picker y, si se eligió algo, completa un input editable (no persiste). */
async function pickInto(setter: (v: string) => void): Promise<void> {
  const path = await api.projectPickFolder()
  if (path) setter(path)
}

function Projects(props: {
  config: Config | null
  machineId: string | null
  busy: boolean
  run: RunFn
  notify: (m: string, err?: boolean) => void
}): JSX.Element {
  const { config, machineId, busy, run } = props
  const [newName, setNewName] = useState('')
  const projects = config ? Object.entries(config.projects) : []

  return (
    <>
      <h1>Proyectos</h1>
      <p className="sub">
        Un proyecto agrupa carpetas de memoria; el path de cada carpeta se guarda literal por máquina.
      </p>

      <div className="card">
        <h2>Nuevo proyecto</h2>
        <div className="row">
          <input
            className="txt"
            style={{ maxWidth: 280 }}
            placeholder="mi-proyecto"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            className="btn primary"
            disabled={busy || !machineId || !newName.trim()}
            onClick={() =>
              run(async () => {
                const n = newName.trim()
                await api.projectCreate(n)
                setNewName('')
                return `Proyecto "${n}" creado.`
              })
            }
          >
            Crear
          </button>
        </div>
        <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
          Nombre lógico que une el proyecto entre tus máquinas (letras, números, . _ -).
        </p>
        {!machineId && <p className="muted">Registrá esta máquina primero.</p>}
      </div>

      {projects.length === 0 ? (
        <div className="card">
          <p className="muted">Ningún proyecto todavía.</p>
        </div>
      ) : (
        projects.map(([pname, p]) => (
          <ProjectCard
            key={pname}
            name={pname}
            project={p}
            machineId={machineId}
            busy={busy}
            run={run}
          />
        ))
      )}
    </>
  )
}

function ProjectCard(props: {
  name: string
  project: Project
  machineId: string | null
  busy: boolean
  run: RunFn
}): JSX.Element {
  const { name, project, machineId, busy, run } = props
  const mid = machineId ?? ''
  const folders = Object.entries(project.folders)
  const [newSlot, setNewSlot] = useState('memory')
  const [newPath, setNewPath] = useState('')

  return (
    <div className="card">
      <div className="row between">
        <h2 style={{ margin: 0 }}>{name}</h2>
        <button
          className="btn"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`¿Eliminar el proyecto "${name}" para todas las máquinas?`)) {
              void run(async () => {
                await api.projectDelete(name)
                return `Proyecto "${name}" eliminado.`
              })
            }
          }}
        >
          Eliminar proyecto
        </button>
      </div>

      {folders.length === 0 ? (
        <p className="muted">Sin carpetas todavía.</p>
      ) : (
        <ul className="plain">
          {folders.map(([slot, byMachine]) => (
            <FolderRow
              key={slot}
              project={name}
              slot={slot}
              byMachine={byMachine}
              machineId={mid}
              busy={busy}
              run={run}
            />
          ))}
        </ul>
      )}

      <div style={{ marginTop: 12 }}>
        <div className="muted" style={{ marginBottom: 6 }}>
          Agregar carpeta
        </div>
        <div className="row">
          <input
            className="txt"
            style={{ maxWidth: 140 }}
            placeholder="memory"
            value={newSlot}
            onChange={(e) => setNewSlot(e.target.value)}
          />
          <input
            className="txt"
            style={{ flex: 1, minWidth: 200 }}
            placeholder="/path/a/la/carpeta (podés pegarlo o elegirlo)"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
          />
          <button className="btn" disabled={busy} onClick={() => void pickInto(setNewPath)}>
            Elegir…
          </button>
          <button
            className="btn primary"
            disabled={busy || !newSlot.trim() || !newPath.trim()}
            onClick={() =>
              run(async () => {
                const s = newSlot.trim()
                await api.projectSetFolder(name, s, newPath.trim())
                setNewPath('')
                return `Carpeta "${s}" agregada a ${name}.`
              })
            }
          >
            Agregar
          </button>
        </div>
      </div>
    </div>
  )
}

function FolderRow(props: {
  project: string
  slot: string
  byMachine: Record<string, string>
  machineId: string
  busy: boolean
  run: RunFn
}): JSX.Element {
  const { project, slot, byMachine, machineId, busy, run } = props
  const current = byMachine[machineId] ?? ''
  const [path, setPath] = useState(current)
  useEffect(() => setPath(current), [current])
  const others = Object.keys(byMachine).filter((m) => m !== machineId)
  const changed = path.trim() !== current
  const hasLocal = !!byMachine[machineId]

  return (
    <li>
      <div className="row" style={{ gap: 8 }}>
        <b className="mono" style={{ minWidth: 72 }}>
          {slot}
        </b>
        <input
          className="txt"
          style={{ flex: 1, minWidth: 200 }}
          placeholder="sin path en esta máquina"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <button className="btn" disabled={busy} onClick={() => void pickInto(setPath)}>
          Elegir…
        </button>
        <button
          className="btn primary"
          disabled={busy || !changed || !path.trim()}
          onClick={() =>
            run(async () => {
              await api.projectSetFolder(project, slot, path.trim())
              return `Guardado ${project}/${slot}.`
            })
          }
        >
          Guardar
        </button>
        {hasLocal && (
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.projectRemoveFolder(project, slot)
                return `Quitado ${project}/${slot} de esta máquina.`
              })
            }
          >
            Quitar de acá
          </button>
        )}
      </div>
      {others.length > 0 && (
        <div className="muted mono" style={{ marginTop: 4 }}>
          también en: {others.join(', ')}
        </div>
      )}
    </li>
  )
}

// ── Ajustes ──────────────────────────────────────────────────────────────────
function Settings(props: {
  config: Config | null
  preflight: PreflightResult | null
  busy: boolean
  run: (fn: () => Promise<string | void>) => Promise<void>
  refresh: () => Promise<void>
}): JSX.Element {
  const { config, preflight, busy, run } = props
  const [remote, setRemote] = useState('')
  const [localJson, setLocalJson] = useState('{}')

  useEffect(() => {
    void api.settingsLocalLoad().then((o) => setLocalJson(JSON.stringify(o, null, 2)))
  }, [])

  return (
    <>
      <h1>Ajustes</h1>
      <p className="sub">Repo, preflight y overrides locales de settings.</p>

      <div className="card">
        <h2>Preflight</h2>
        <ul className="plain">
          {(preflight?.checks ?? []).map((c) => (
            <li key={c.name}>
              <span className={`dot ${c.ok ? 'ok' : 'danger'}`} /> <b>{c.name}</b>{' '}
              <span className="muted">{c.detail}</span>
              {!c.ok && c.fix && <div className="muted mono">→ {c.fix}</div>}
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>Repo</h2>
        {config ? (
          <p className="mono muted">{config.repo.remote}</p>
        ) : (
          <div className="row">
            <input
              className="txt"
              placeholder="https://github.com/usuario/claude-memories.git"
              value={remote}
              onChange={(e) => setRemote(e.target.value)}
            />
            <button
              className="btn primary"
              disabled={busy || !remote.trim()}
              onClick={() =>
                run(async () => {
                  const r = await api.repoConnect(remote.trim())
                  return r.initialized ? 'Repo conectado (estructura creada).' : 'Repo conectado.'
                })
              }
            >
              Conectar
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <h2>settings.local.json</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Las claves acá se quedan en esta máquina y no viajan al repo.
        </p>
        <textarea
          className="txt"
          value={localJson}
          onChange={(e) => setLocalJson(e.target.value)}
        />
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                let parsed
                try {
                  parsed = JSON.parse(localJson)
                } catch {
                  throw new Error('JSON inválido.')
                }
                await api.settingsLocalSave(parsed)
                return 'Overrides locales guardados.'
              })
            }
          >
            Guardar
          </button>
        </div>
      </div>
    </>
  )
}

// ── Plan preview (modal) ─────────────────────────────────────────────────────
function PlanPreview(props: {
  verb: Verb
  plan: Plan
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element {
  const { verb, plan, busy } = props
  const counts = plan.actions.reduce<Record<string, number>>((acc, a) => {
    acc[a.type] = (acc[a.type] ?? 0) + 1
    return acc
  }, {})
  const shown = plan.actions.filter((a) => a.type !== 'noop')
  const mutating = plan.actions.some((a) => a.type !== 'noop' && a.type !== 'skip')

  return (
    <div className="overlay" onClick={props.onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <b>Preview del Plan · {verb}</b>
          <div className="muted" style={{ marginTop: 4 }}>
            create {counts.create ?? 0} · overwrite {counts.overwrite ?? 0} · delete{' '}
            {counts.delete ?? 0} · noop {counts.noop ?? 0} · skip {counts.skip ?? 0}
          </div>
        </header>
        <div className="body">
          {shown.length === 0 ? (
            <p className="muted">Nada para hacer: todo está sincronizado.</p>
          ) : (
            shown.map((a, i) => (
              <div className="action" key={i}>
                <span className={`tag ${a.type}`}>{a.type}</span>
                <span className="mono">{a.logicalPath}</span>
                {a.reason && <span className="muted">{a.reason}</span>}
              </div>
            ))
          )}
        </div>
        <footer>
          <button className="btn" onClick={props.onCancel}>
            Cancelar
          </button>
          <button className="btn primary" disabled={busy || !mutating} onClick={props.onConfirm}>
            Confirmar
          </button>
        </footer>
      </div>
    </div>
  )
}

// ── Banner de conflictos ─────────────────────────────────────────────────────
function ConflictsBanner(props: {
  files: string[]
  busy: boolean
  run: (fn: () => Promise<string | void>) => Promise<void>
}): JSX.Element {
  const { files, busy, run } = props
  return (
    <div className="banner">
      <b>Conflictos por resolver ({files.length})</b>
      <p className="muted" style={{ marginTop: 4 }}>
        Por cada archivo, quedate con tu versión (local) o la del repo (remoto).
      </p>
      <ul className="plain">
        {files.map((f) => (
          <li key={f}>
            <div className="row between">
              <span className="mono">{f}</span>
              <div className="row">
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => run(() => api.conflictResolve(f, 'local').then(() => undefined))}
                >
                  Local
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => run(() => api.conflictResolve(f, 'remote').then(() => undefined))}
                >
                  Remoto
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <button
        className="btn primary"
        disabled={busy}
        onClick={() =>
          run(async () => {
            const r = await api.conflictComplete()
            return r.pushed ? 'Conflictos resueltos y pusheados.' : 'Conflictos resueltos.'
          })
        }
        style={{ marginTop: 8 }}
      >
        Finalizar merge
      </button>
    </div>
  )
}
