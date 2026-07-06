import type { AppState } from './types'

/**
 * Selectores puros: centralizan las reglas de gating que en el App.tsx viejo
 * estaban repetidas inline en cada vista. Aceptan subconjuntos estructurales
 * de AppState para ser fáciles de testear sin construir el estado entero.
 */

export function canSync(s: Pick<AppState, 'config' | 'machineId' | 'preflight'>): boolean {
  return !!s.config && !!s.machineId && !!s.preflight?.ok
}

export function conflicts(s: Pick<AppState, 'status'>): string[] {
  return s.status?.conflicted ?? []
}

export type OnboardingStep = 'preflight' | 'connect' | 'register' | 'first-project' | 'done'

/**
 * En qué paso del onboarding está la máquina, derivado del estado real.
 * Es la cadena dura de precondiciones del backend (register exige connect, etc).
 */
export function onboardingStep(
  s: Pick<AppState, 'preflight' | 'config' | 'machineId'>,
): OnboardingStep {
  if (!s.preflight?.ok) return 'preflight'
  if (!s.config) return 'connect'
  if (!s.machineId) return 'register'
  if (Object.keys(s.config.projects).length === 0) return 'first-project'
  return 'done'
}

/**
 * ¿Hay que secuestrar al usuario con el wizard? 'first-project' NO bloquea
 * (se puede usar la app sin proyectos), así que no cuenta.
 */
export function needsOnboarding(
  s: Pick<AppState, 'preflight' | 'config' | 'machineId'>,
): boolean {
  const step = onboardingStep(s)
  return step === 'preflight' || step === 'connect' || step === 'register'
}
