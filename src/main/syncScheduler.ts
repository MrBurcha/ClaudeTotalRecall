import { watch, type FSWatcher } from 'node:fs'
import { createPlatformAdapter, type PlatformAdapter } from '../platform'
import { loadAutoSyncPrefs, saveAutoSyncPrefs } from '../core/localState'
import { isSecretExcluded } from '../core/plan'
import { projectSlotPath, projectSlots, userLevelItems } from '../core/resolve'
import * as svc from '../core/service'
import { runSyncCycle, scatterResolved, type SyncOutcome } from '../core/syncEngine'
import type { AutoSyncPrefs, SyncEngineState } from '../core/types'

// El watch usa notificaciones nativas del SO (inotify/FSEvents): ~0% CPU en
// reposo. El debounce trailing coalescea ráfagas de guardado en un solo ciclo.
const DEBOUNCE_MS = 10_000
const MIN_INTERVAL_MS = 15_000
const MAX_INTERVAL_MS = 3_600_000

function clampInterval(ms: number): number {
  return Math.min(Math.max(ms, MIN_INTERVAL_MS), MAX_INTERVAL_MS)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Ruido que el watcher debe ignorar para no despertarse al pedo: secretos
 * (`*.jsonl`, `.credentials.json`, `.claude.json`) que además nunca se sincronizan,
 * y directorios que cambian mucho y no aportan (`.git`, `node_modules`).
 */
function isNoise(rel: string): boolean {
  if (isSecretExcluded(rel)) return true
  const segs = rel.split(/[\\/]/)
  return segs.includes('.git') || segs.includes('node_modules')
}

/**
 * Motor de auto-sync del proceso main. Dueño del *timing* (watch de archivos +
 * poll del remoto), la máquina de estados y el push a la UI. NO tiene lógica de
 * git: delega en `runSyncCycle` (core). Corre sólo mientras la app está abierta.
 */
export class SyncScheduler {
  private readonly adapter: PlatformAdapter = createPlatformAdapter()
  private state: SyncEngineState = {
    status: 'idle',
    auto: true,
    intervalMs: 120_000,
    lastSyncedAt: null,
    conflicts: [],
    lastError: null,
  }

  private ready = false
  private inFlight = false
  private pending = false
  private armed = false
  private watchers: FSWatcher[] = []
  private pollTimer: NodeJS.Timeout | null = null
  private debounceTimer: NodeJS.Timeout | null = null

  constructor(private readonly broadcast: (state: SyncEngineState) => void) {}

  getState(): SyncEngineState {
    return this.state
  }

  /** true si el motor está pausado esperando resolución de conflicto. */
  private get pausedByConflict(): boolean {
    return this.state.status === 'conflict'
  }

  /** Arranca en whenReady: lee prefs, converge una vez y arma watch+poll si auto. */
  async start(): Promise<void> {
    await this.reload()
  }

  /** Frena todo (before-quit): cierra watchers y timers. */
  stop(): void {
    this.disarm()
  }

  /** Re-lee prefs/readiness y re-arma. La llama machine:register al completarse. */
  async reload(): Promise<void> {
    const prefs = await loadAutoSyncPrefs(this.adapter)
    this.setState({ auto: prefs.enabled, intervalMs: clampInterval(prefs.intervalMs) })
    this.ready = await this.isReady()
    if (this.ready && this.state.auto) await this.cycle()
    this.reconcileTimers()
  }

  /** Cambia las prefs (persiste), re-arma con el nuevo intervalo y converge si recién se activó. */
  async setAuto(prefs: AutoSyncPrefs): Promise<SyncEngineState> {
    const clamped = { enabled: prefs.enabled, intervalMs: clampInterval(prefs.intervalMs) }
    await saveAutoSyncPrefs(this.adapter, clamped)
    const wasOff = !this.state.auto
    this.disarm() // forzar re-armado con el nuevo intervalo
    this.setState({ auto: clamped.enabled, intervalMs: clamped.intervalMs })
    this.reconcileTimers()
    if (wasOff && clamped.enabled && this.ready) void this.cycle()
    return this.state
  }

  /** Disparo manual ("Sincronizar ahora"): corre aunque auto esté off; no en conflicto. */
  async syncNow(): Promise<SyncEngineState> {
    if (!this.pausedByConflict) await this.cycle()
    return this.state
  }

  /** Tras finalizar un merge en el panel Avanzado: baja el resultado y reanuda. */
  async resumeAfterConflict(): Promise<void> {
    try {
      await scatterResolved(this.adapter)
      this.setState({
        status: 'idle',
        conflicts: [],
        lastError: null,
        lastSyncedAt: Date.now(),
      })
    } catch (e) {
      this.setState({ status: 'offline', lastError: errorMessage(e) })
    }
    this.reconcileTimers()
  }

  // ── ciclo (mutex + pendiente) ────────────────────────────────────────────────
  private async cycle(): Promise<void> {
    if (this.pausedByConflict) return
    if (this.inFlight) {
      this.pending = true
      return
    }
    this.inFlight = true
    try {
      if (!(await this.isReady())) {
        this.ready = false
        this.disarm()
        return
      }
      this.ready = true
      // Guard: si el working copy ya tiene conflictos (de un flujo manual o un
      // ciclo previo), no sincronizar; pedir resolución.
      const existing = await svc.listConflicts(this.adapter)
      if (existing.length > 0) {
        this.setState({ status: 'conflict', conflicts: existing })
        this.reconcileTimers()
        return
      }
      this.setState({ status: 'syncing', lastError: null })
      this.applyOutcome(await runSyncCycle(this.adapter))
    } catch (e) {
      this.applyOutcome({ kind: 'error', message: errorMessage(e) })
    } finally {
      this.inFlight = false
      if (this.pending) {
        this.pending = false
        if (!this.pausedByConflict) void this.cycle()
      }
    }
  }

  private applyOutcome(o: SyncOutcome): void {
    if (o.kind === 'synced') {
      this.setState({ status: 'idle', lastSyncedAt: Date.now(), conflicts: [], lastError: null })
    } else if (o.kind === 'conflict') {
      this.setState({ status: 'conflict', conflicts: o.files })
    } else {
      this.setState({ status: 'offline', lastError: o.message })
    }
    this.reconcileTimers()
  }

  private async isReady(): Promise<boolean> {
    const machineId = await svc.currentMachineId(this.adapter).catch(() => null)
    if (!machineId) return false
    const config = await svc.loadRepoConfig(this.adapter).catch(() => null)
    return !!config
  }

  // ── armado/desarmado de watch + poll ─────────────────────────────────────────
  private reconcileTimers(): void {
    const shouldRun = this.ready && this.state.auto && this.state.status !== 'conflict'
    if (shouldRun) this.arm()
    else this.disarm()
  }

  private arm(): void {
    if (this.armed) return
    this.armed = true
    void this.setupWatchers()
    this.pollTimer = setInterval(() => void this.cycle(), this.state.intervalMs)
    this.pollTimer.unref?.()
  }

  private disarm(): void {
    this.armed = false
    for (const w of this.watchers) {
      try {
        w.close()
      } catch {
        /* ya cerrado */
      }
    }
    this.watchers = []
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  /** Debounce trailing con reset: cada cambio reinicia los 10 s de calma. */
  private onLocalChange(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.cycle()
    }, DEBOUNCE_MS)
    this.debounceTimer.unref?.()
  }

  /**
   * Observa SÓLO las raíces sincronizadas (no el home entero): `~/.claude` no
   * recursivo (capta CLAUDE.md y settings.json sin entrar a projects/*.jsonl),
   * los dirs user-level recursivos, y las carpetas de proyecto de esta máquina.
   */
  private async setupWatchers(): Promise<void> {
    for (const t of await this.watchTargets()) {
      try {
        const w = watch(t.path, { recursive: t.recursive }, (_evt, filename) => {
          if (filename && isNoise(filename.toString())) return
          this.onLocalChange()
        })
        w.on('error', () => {
          /* path borrado o SO sin soporte: se ignora, el poll cubre igual */
        })
        w.unref?.()
        this.watchers.push(w)
      } catch {
        /* path inexistente u OS sin recursive watch: lo cubre el poll */
      }
    }
  }

  private async watchTargets(): Promise<{ path: string; recursive: boolean }[]> {
    const a = this.adapter
    const targets: { path: string; recursive: boolean }[] = [
      { path: a.claudeHome(), recursive: false },
    ]
    for (const item of userLevelItems(a)) {
      if (item.kind === 'dir') targets.push({ path: item.realPath, recursive: true })
    }
    const config = await svc.loadRepoConfig(a).catch(() => null)
    const machineId = await svc.currentMachineId(a).catch(() => null)
    if (config && machineId) {
      for (const name of Object.keys(config.projects)) {
        for (const slot of projectSlots(config, name)) {
          const p = projectSlotPath(config, name, slot, machineId)
          if (p) targets.push({ path: p, recursive: true })
        }
      }
    }
    return targets
  }

  private setState(patch: Partial<SyncEngineState>): void {
    this.state = { ...this.state, ...patch }
    this.broadcast(this.state)
  }
}
