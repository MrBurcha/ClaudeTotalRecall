import { useState } from 'react'
import { Button } from '../../components/Button'
import { StatusDot } from '../../components/Badge'
import { TextField } from '../../components/Field'
import { Icon, type IconName } from '../../components/Icon'
import { IconButton } from '../../components/IconButton'
import { api } from '../../state/api'
import { needsOnboarding } from '../../state/selectors'
import { useAppState } from '../../state/store'
import { useActions } from '../../state/useActions'
import { useWizard } from './useWizard'

function StepHeader({ icon, title, sub }: { icon: IconName; title: string; sub: string }): JSX.Element {
  return (
    <div className="stack-2">
      <div className="wizard__step-icon">
        <Icon name={icon} size={22} />
      </div>
      <h2 className="wizard__title">{title}</h2>
      <p className="muted">{sub}</p>
    </div>
  )
}

function Rail(): JSX.Element {
  const { steps, index } = useWizard()
  return (
    <ol className="step-rail">
      {steps.map((s, i) => {
        const cls = i < index ? 'is-done' : i === index ? 'is-current' : 'is-pending'
        return (
          <li key={s.key} className={`step-rail__item ${cls}`}>
            <span className="step-rail__dot">{i < index ? <Icon name="check" size={13} /> : i + 1}</span>
            <span className="step-rail__label">{s.label}</span>
          </li>
        )
      })}
    </ol>
  )
}

function PreflightPanel(): JSX.Element {
  const { preflight, busy } = useAppState()
  const actions = useActions()
  return (
    <div className="stack">
      <StepHeader
        icon="check"
        title="Requisitos del sistema"
        sub="ClaudeTR usa git y gh para sincronizar. Revisemos que estén listos."
      />
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
  )
}

function ConnectPanel(): JSX.Element {
  const { busy } = useAppState()
  const actions = useActions()
  const [remote, setRemote] = useState('')
  const connect = (): Promise<void> =>
    actions.run(async () => {
      const r = await api.repoConnect(remote.trim())
      return r.initialized ? 'Repo conectado y estructura inicial creada.' : 'Repo conectado.'
    })
  return (
    <div className="stack">
      <StepHeader
        icon="git-branch"
        title="Conectá tu repo de memoria"
        sub="Un repo privado de GitHub donde viven tus memorias. Pegá su URL (HTTPS o SSH)."
      />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (remote.trim()) void connect()
        }}
      >
        <TextField
          label="URL del repo"
          placeholder="git@github.com:usuario/claude-memories.git"
          value={remote}
          onChange={(e) => setRemote(e.target.value)}
          autoFocus
        />
      </form>
      <div className="row between">
        <span className="muted cluster">
          <Icon name="lock" size={15} /> Nunca viajan secretos ni transcripts.
        </span>
        <Button variant="primary" icon="git-branch" disabled={busy || !remote.trim()} onClick={connect}>
          Conectar
        </Button>
      </div>
    </div>
  )
}

function RegisterPanel(): JSX.Element {
  const { busy } = useAppState()
  const actions = useActions()
  const [name, setName] = useState('')
  const register = (): Promise<void> =>
    actions.run(async () => {
      const r = await api.machineRegister(name.trim() || undefined)
      return `Máquina "${r.machineId}" registrada.`
    })
  return (
    <div className="stack">
      <StepHeader
        icon="monitor"
        title="Registrá esta máquina"
        sub="Un id lógico para esta computadora. Si lo dejás vacío, usamos el hostname."
      />
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
          autoFocus
        />
      </form>
      <div className="row">
        <Button variant="primary" icon="monitor" disabled={busy} onClick={register}>
          Registrar esta máquina
        </Button>
      </div>
    </div>
  )
}

function FirstProjectPanel(): JSX.Element {
  const actions = useActions()
  return (
    <div className="stack">
      <StepHeader
        icon="folder"
        title="¿Sumás un proyecto?"
        sub="Opcional. Un proyecto sincroniza carpetas de memoria específicas, además de tu config de usuario."
      />
      <div className="row">
        <Button variant="primary" icon="plus" onClick={() => actions.openModal({ kind: 'project-create' })}>
          Crear proyecto
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            actions.closeWizard()
            actions.navigate('home')
          }}
        >
          Después lo hago
        </Button>
      </div>
    </div>
  )
}

function DonePanel(): JSX.Element {
  const actions = useActions()
  return (
    <div className="stack center wizard__done">
      <div className="wizard__done-icon">
        <Icon name="check" size={34} />
      </div>
      <h2 className="wizard__title">Todo listo</h2>
      <p className="muted">Tu memoria está lista para sincronizar entre máquinas.</p>
      <Button
        variant="primary"
        icon="orbit"
        onClick={() => {
          actions.closeWizard()
          actions.navigate('home')
        }}
      >
        Ir a Sincronización
      </Button>
    </div>
  )
}

/**
 * Takeover de onboarding. AppShell lo monta cuando needsOnboarding || wizardOpen.
 * El paso se deriva del estado (useWizard) → auto-avanza tras cada acción. Solo
 * se puede cerrar cuando ya no hay pasos duros pendientes (dismissable).
 */
export function OnboardingWizard(): JSX.Element {
  const state = useAppState()
  const actions = useActions()
  const { step } = useWizard()
  const dismissable = !needsOnboarding(state)

  return (
    <div className="wizard">
      <div className="wizard__panel">
        <div className="wizard__brand">
          <Icon name="orbit" size={22} className="brand__mark" />
          <div>
            <div className="brand__name">ClaudeTR</div>
            <span className="brand__tag">estación de sincronización</span>
          </div>
          <span className="spacer" />
          {dismissable && <IconButton icon="x" label="Cerrar asistente" onClick={actions.closeWizard} />}
        </div>
        <Rail />
        <div className="wizard__body">
          {step === 'preflight' && <PreflightPanel />}
          {step === 'connect' && <ConnectPanel />}
          {step === 'register' && <RegisterPanel />}
          {step === 'first-project' && <FirstProjectPanel />}
          {step === 'done' && <DonePanel />}
        </div>
      </div>
    </div>
  )
}
