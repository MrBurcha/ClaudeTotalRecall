import { onboardingStep, type OnboardingStep } from '../../state/selectors'
import { useAppState } from '../../state/store'

export interface WizardStepMeta {
  key: OnboardingStep
  label: string
}

export const WIZARD_STEPS: WizardStepMeta[] = [
  { key: 'preflight', label: 'Requisitos' },
  { key: 'connect', label: 'Repo' },
  { key: 'register', label: 'Máquina' },
  { key: 'first-project', label: 'Proyecto' },
]

/**
 * Deriva el paso vivo del estado (no mantiene índice propio). Tras cada
 * run()+refresh() el paso se re-deriva → el wizard auto-avanza solo.
 */
export function useWizard(): { step: OnboardingStep; index: number; steps: WizardStepMeta[] } {
  const state = useAppState()
  const step = onboardingStep(state)
  const index = step === 'done' ? WIZARD_STEPS.length : WIZARD_STEPS.findIndex((s) => s.key === step)
  return { step, index, steps: WIZARD_STEPS }
}
