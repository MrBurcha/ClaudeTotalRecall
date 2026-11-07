import type { InstallerVariant } from '../../core/releaseCheck'
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

/** Another process owns this machine's sync lock (#141): this window only looks. */
export function isBlocked(s: Pick<AppState, 'syncEngine'>): boolean {
  return !!s.syncEngine?.blockedBy
}

/** Constellation tone derived from the engine's state (hero color). */
export type EngineTone = 'ok' | 'syncing' | 'conflict' | 'offline' | 'error'
export function engineTone(s: Pick<AppState, 'status' | 'syncEngine'>): EngineTone {
  if (hasConflict(s)) return 'conflict'
  const st = s.syncEngine?.status
  if (st === 'syncing') return 'syncing'
  if (st === 'offline' || isBlocked(s)) return 'offline'
  if (st === 'error') return 'error'
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
export function needsOnboarding(s: Pick<AppState, 'preflight' | 'config' | 'machineId'>): boolean {
  const step = onboardingStep(s)
  return step === 'preflight' || step === 'connect' || step === 'register'
}

/**
 * The one notice in the sidebar footer (#122): the wrong build for this Mac (#133)
 * or a newer release (#134). When both apply, a single wrong-build notice links
 * the newer release's installer (main resolves it for the real chip, so it is the
 * Apple Silicon one): updating and switching builds in one download. It keeps the
 * current version's link only if the newer release has no exact installer.
 */
export type SidebarNotice =
  | { kind: 'wrongBuild'; url: string; variant: InstallerVariant | null; latestVersion?: string }
  | { kind: 'update'; url: string; variant: InstallerVariant | null; latestVersion: string }

export function sidebarNotice(s: Pick<AppState, 'updates'>): SidebarNotice | null {
  const { update, wrongBuild } = s.updates
  if (wrongBuild) {
    if (!update) return { kind: 'wrongBuild', url: wrongBuild.url, variant: wrongBuild.variant }
    const link = update.variant !== null || wrongBuild.variant === null ? update : wrongBuild
    return {
      kind: 'wrongBuild',
      url: link.url,
      variant: link.variant,
      latestVersion: update.latestVersion,
    }
  }
  if (update) return { kind: 'update', ...update }
  return null
}
