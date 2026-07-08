import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { BrandMark } from '../../components/BrandMark'
import { StatusDot } from '../../components/Badge'
import { TextField } from '../../components/Field'
import { Icon, type IconName } from '../../components/Icon'
import { IconButton } from '../../components/IconButton'
import { api } from '../../state/api'
import { needsOnboarding } from '../../state/selectors'
import { useAppState } from '../../state/store'
import { useActions } from '../../state/useActions'
import { useWizard } from './useWizard'

function StepHeader({
  icon,
  title,
  sub,
}: {
  icon: IconName
  title: string
  sub: string
}): JSX.Element {
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
            <span className="step-rail__dot">
              {i < index ? <Icon name="check" size={13} /> : i + 1}
            </span>
            <span className="step-rail__label">{s.label}</span>
          </li>
        )
      })}
    </ol>
  )
}

function PreflightPanel(): JSX.Element {
  const { t } = useTranslation()
  const { preflight, busy } = useAppState()
  const actions = useActions()
  return (
    <div className="stack">
      <StepHeader
        icon="check"
        title={t('wizard.preflight.title')}
        sub={t('wizard.preflight.sub')}
      />
      <ul className="check-list">
        {(preflight?.checks ?? []).map((c) => (
          <li key={c.name} className="check-row">
            <StatusDot tone={c.ok ? 'ok' : 'danger'} />
            <div className="grow">
              <div className="cluster">
                <b className="mono">{c.name}</b>
                {c.detail && (
                  <span className="muted">
                    {c.detailKey
                      ? t(`preflight.${c.detailKey}`, { ...c.params, defaultValue: c.detail })
                      : c.detail}
                  </span>
                )}
              </div>
              {!c.ok && c.fix && (
                <div className="muted mono check-fix">
                  →{' '}
                  {c.fixKey
                    ? t(`preflight.${c.fixKey}`, { ...c.params, defaultValue: c.fix })
                    : c.fix}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="row">
        <Button icon="sync" disabled={busy} onClick={() => void actions.refresh()}>
          {t('common.retry')}
        </Button>
      </div>
    </div>
  )
}

function ConnectPanel(): JSX.Element {
  const { t } = useTranslation()
  const { busy } = useAppState()
  const actions = useActions()
  const [remote, setRemote] = useState('')
  const connect = (): Promise<void> =>
    actions.run(async () => {
      const r = await api.repoConnect(remote.trim())
      return r.initialized ? t('wizard.connect.connectedCreated') : t('wizard.connect.connected')
    })
  return (
    <div className="stack">
      <StepHeader
        icon="git-branch"
        title={t('wizard.connect.title')}
        sub={t('wizard.connect.sub')}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (remote.trim()) void connect()
        }}
      >
        <TextField
          label={t('wizard.connect.urlLabel')}
          placeholder={t('wizard.connect.urlPlaceholder')}
          value={remote}
          onChange={(e) => setRemote(e.target.value)}
          autoFocus
        />
      </form>
      <div className="row between">
        <span className="muted cluster">
          <Icon name="lock" size={15} /> {t('wizard.connect.privacyNote')}
        </span>
        <Button
          variant="primary"
          icon="git-branch"
          disabled={busy || !remote.trim()}
          onClick={connect}
        >
          {t('common.connect')}
        </Button>
      </div>
    </div>
  )
}

function RegisterPanel(): JSX.Element {
  const { t } = useTranslation()
  const { busy } = useAppState()
  const actions = useActions()
  const [name, setName] = useState('')
  const register = (): Promise<void> =>
    actions.run(async () => {
      const r = await api.machineRegister(name.trim() || undefined)
      return t('wizard.register.registered', { machineId: r.machineId })
    })
  return (
    <div className="stack">
      <StepHeader
        icon="monitor"
        title={t('wizard.register.title')}
        sub={t('wizard.register.sub')}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void register()
        }}
      >
        <TextField
          label={t('wizard.register.nameLabel')}
          placeholder="thinkpad-t480"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </form>
      <div className="row">
        <Button variant="primary" icon="monitor" disabled={busy} onClick={register}>
          {t('wizard.register.submit')}
        </Button>
      </div>
    </div>
  )
}

function FirstProjectPanel(): JSX.Element {
  const { t } = useTranslation()
  const actions = useActions()
  return (
    <div className="stack">
      <StepHeader
        icon="folder"
        title={t('wizard.firstProject.title')}
        sub={t('wizard.firstProject.sub')}
      />
      <div className="row">
        <Button
          variant="primary"
          icon="plus"
          onClick={() => actions.openModal({ kind: 'project-create' })}
        >
          {t('wizard.firstProject.createProject')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            actions.closeWizard()
            actions.navigate('home')
          }}
        >
          {t('wizard.firstProject.later')}
        </Button>
      </div>
    </div>
  )
}

function DonePanel(): JSX.Element {
  const { t } = useTranslation()
  const actions = useActions()
  return (
    <div className="stack center wizard__done">
      <div className="wizard__done-icon">
        <Icon name="check" size={34} />
      </div>
      <h2 className="wizard__title">{t('wizard.done.title')}</h2>
      <p className="muted">{t('wizard.done.sub')}</p>
      <Button
        variant="primary"
        icon="sync"
        onClick={() => {
          actions.closeWizard()
          actions.navigate('home')
        }}
      >
        {t('wizard.done.goToSync')}
      </Button>
    </div>
  )
}

/**
 * Onboarding takeover. AppShell mounts it when needsOnboarding || wizardOpen.
 * The step is derived from state (useWizard) → it auto-advances after each action.
 * It can only be closed once there are no hard steps left pending (dismissable).
 */
export function OnboardingWizard(): JSX.Element {
  const { t } = useTranslation()
  const state = useAppState()
  const actions = useActions()
  const { step } = useWizard()
  const dismissable = !needsOnboarding(state)

  return (
    <div className="wizard">
      <div className="wizard__panel">
        <div className="wizard__brand">
          <BrandMark size={22} />
          <div>
            <div className="brand__name">Claude Total Recall</div>
            <span className="brand__tag">{t('wizard.brandTag')}</span>
          </div>
          <span className="spacer" />
          {dismissable && (
            <IconButton icon="x" label={t('wizard.closeAria')} onClick={actions.closeWizard} />
          )}
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
