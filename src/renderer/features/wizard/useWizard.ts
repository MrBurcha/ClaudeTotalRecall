import { useTranslation } from 'react-i18next'
import { onboardingStep, type OnboardingStep } from '../../state/selectors'
import { useAppState } from '../../state/store'

export interface WizardStepMeta {
  key: OnboardingStep
  labelKey: string
}

export interface WizardStep {
  key: OnboardingStep
  label: string
}

export const WIZARD_STEPS: WizardStepMeta[] = [
  { key: 'preflight', labelKey: 'wizard.step.preflight' },
  { key: 'connect', labelKey: 'wizard.step.connect' },
  { key: 'register', labelKey: 'wizard.step.register' },
  { key: 'first-project', labelKey: 'wizard.step.firstProject' },
]

/**
 * Derives the live step from state (it keeps no index of its own). After each
 * run()+refresh() the step is re-derived → the wizard auto-advances on its own.
 */
export function useWizard(): { step: OnboardingStep; index: number; steps: WizardStep[] } {
  const { t } = useTranslation()
  const state = useAppState()
  const step = onboardingStep(state)
  const index =
    step === 'done' ? WIZARD_STEPS.length : WIZARD_STEPS.findIndex((s) => s.key === step)
  const steps = WIZARD_STEPS.map((s) => ({ key: s.key, label: t(s.labelKey) }))
  return { step, index, steps }
}
