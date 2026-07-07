import type { AppState } from './types'

/**
 * Pure selectors: they centralize the gating rules that in the old App.tsx were
 * repeated inline in every view. They accept structural subsets of AppState so
 * they're easy to test without building the whole state.
 */

export function canSync(s: Pick<AppState, 'config' | 'machineId' | 'preflight'>): boolean {
  return !!s.config && !!s.machineId && !!s.preflight?.ok
}

export function conflicts(s: Pick<AppState, 'status'>): string[] {
  return s.status?.conflicted ?? []
}

/**
 * Conflicted files. Prioritizes the ones reported by the auto-sync engine (they
 * arrive via real-time push, without waiting for a repoStatus refresh); falls back
 * to the repo status if the engine hasn't spoken yet.
 */
export function conflictFiles(s: Pick<AppState, 'status' | 'syncEngine'>): string[] {
  const fromEngine = s.syncEngine?.conflicts ?? []
  return fromEngine.length > 0 ? fromEngine : (s.status?.conflicted ?? [])
}

export function hasConflict(s: Pick<AppState, 'status' | 'syncEngine'>): boolean {
  return s.syncEngine?.status === 'conflict' || conflictFiles(s).length > 0
}

/** Constellation tone derived from the engine's state (hero color). */
export type EngineTone = 'ok' | 'syncing' | 'conflict' | 'offline'
export function engineTone(s: Pick<AppState, 'status' | 'syncEngine'>): EngineTone {
  if (hasConflict(s)) return 'conflict'
  const st = s.syncEngine?.status
  if (st === 'syncing') return 'syncing'
  if (st === 'offline') return 'offline'
  return 'ok'
}

export type OnboardingStep = 'preflight' | 'connect' | 'register' | 'first-project' | 'done'

/**
 * Which onboarding step the machine is on, derived from the real state.
 * It's the hard chain of backend preconditions (register requires connect, etc).
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
 * Do we need to hijack the user with the wizard? 'first-project' does NOT block
 * (the app can be used without projects), so it doesn't count.
 */
export function needsOnboarding(
  s: Pick<AppState, 'preflight' | 'config' | 'machineId'>,
): boolean {
  const step = onboardingStep(s)
  return step === 'preflight' || step === 'connect' || step === 'register'
}
