import { randomUUID } from 'node:crypto'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { createPlatformAdapter } from '../platform'
import { runPreflight } from '../core/preflight'
import type { Plan, PlanAction, Verb } from '../core/types'
import {
  buildVerbPlan,
  connectRepo,
  pullRepo,
  registerMachine,
  repoStatus,
  syncGather,
  syncScatter,
} from '../core/service'

// ── util ─────────────────────────────────────────────────────────────────────
function out(s = ''): void {
  stdout.write(s + '\n')
}
function meta(): { id: string; createdAt: string } {
  return { id: randomUUID(), createdAt: new Date().toISOString() }
}
function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
}
function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}
async function confirm(message: string): Promise<boolean> {
  if (!stdin.isTTY) return false
  const rl = createInterface({ input: stdin, output: stdout })
  const ans = (await rl.question(`${message} [y/N] `)).trim().toLowerCase()
  rl.close()
  return ['y', 'yes', 's', 'si', 'sí'].includes(ans)
}

const TYPE_LABEL: Record<PlanAction['type'], string> = {
  create: '＋ crear   ',
  overwrite: '~ pisar   ',
  delete: '－ borrar  ',
  noop: '· igual   ',
  skip: '» saltear ',
}

function printPlan(plan: Plan): void {
  const counts: Record<string, number> = {}
  for (const a of plan.actions) counts[a.type] = (counts[a.type] ?? 0) + 1
  out(`\nPlan de ${plan.verb} (${plan.actions.length} acciones):`)
  out(
    `  create=${counts.create ?? 0}  overwrite=${counts.overwrite ?? 0}  ` +
      `delete=${counts.delete ?? 0}  noop=${counts.noop ?? 0}  skip=${counts.skip ?? 0}`,
  )
  const shown = plan.actions.filter((a) => a.type !== 'noop')
  if (shown.length > 0) {
    out('')
    for (const a of shown) {
      const reason = a.reason ? `  (${a.reason})` : ''
      out(`  ${TYPE_LABEL[a.type]} ${a.logicalPath}${reason}`)
    }
  }
  out('')
}

// ── comandos ─────────────────────────────────────────────────────────────────
async function cmdCheck(): Promise<number> {
  const res = await runPreflight()
  for (const c of res.checks) {
    out(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
    if (!c.ok && c.fix) out(`      → ${c.fix}`)
  }
  out(res.ok ? '\nPreflight OK.' : '\nPreflight con problemas.')
  return res.ok ? 0 : 1
}

async function cmdConnect(args: string[]): Promise<number> {
  const remote = args.find((a) => !a.startsWith('-'))
  if (!remote) {
    out('Falta el remote. Uso: claudetr connect <remote-url>')
    return 1
  }
  const adapter = createPlatformAdapter()
  const res = await connectRepo(remote, adapter)
  out(
    res.initialized
      ? 'Repo conectado y estructura inicial creada.'
      : 'Repo conectado (ya tenía contenido).',
  )
  return 0
}

async function cmdStatus(): Promise<number> {
  const adapter = createPlatformAdapter()
  const st = await repoStatus(adapter)
  out(`branch: ${st.branch}`)
  out(`ahead: ${st.ahead}  behind: ${st.behind}  dirty: ${st.dirty}`)
  if (st.conflicted.length) out(`conflictos: ${st.conflicted.join(', ')}`)
  return 0
}

async function cmdRegister(args: string[]): Promise<number> {
  const adapter = createPlatformAdapter()
  const res = await registerMachine(adapter, flagValue(args, '--name'))
  out(
    res.alreadyRegistered
      ? `Máquina "${res.machineId}" ya estaba registrada.`
      : `Máquina "${res.machineId}" registrada (${res.machine.os}, ${res.machine.hostname}).`,
  )
  return 0
}

async function cmdSync(verb: Verb, args: string[]): Promise<number> {
  const adapter = createPlatformAdapter()
  const dryRun = hasFlag(args, '--dry-run')
  const yes = hasFlag(args, '--yes')

  // scatter: traer lo último antes de escribir en la máquina (salvo dry-run).
  if (verb === 'scatter' && !dryRun) {
    const pulled = await pullRepo(adapter)
    if (!pulled.ok) {
      out(`Conflictos al traer el repo: ${pulled.conflicts.join(', ')}`)
      out('Resolvé los conflictos antes de scatter.')
      return 1
    }
  }

  const plan = await buildVerbPlan(adapter, verb, meta())
  printPlan(plan)

  if (dryRun) {
    out('(dry-run: no se tocó nada)')
    return 0
  }
  const mutating = plan.actions.some((a) => a.type !== 'noop' && a.type !== 'skip')
  if (!mutating) {
    out('Nada para hacer.')
    return 0
  }
  if (!yes && !(await confirm('¿Ejecutar este Plan?'))) {
    out('Cancelado.')
    return 1
  }

  if (verb === 'gather') {
    const r = await syncGather(adapter, plan)
    out(`Aplicado: ${r.exec.applied} (create=${r.exec.created}, overwrite=${r.exec.overwritten}, delete=${r.exec.deleted}).`)
    if (r.conflicts.length) {
      out(`Conflictos al integrar: ${r.conflicts.join(', ')}. Resolvelos y reintentá.`)
      return 1
    }
    out(r.pushed ? 'Pusheado al remoto.' : r.committed ? 'Commiteado (sin push).' : 'Sin cambios para commitear.')
  } else {
    const r = await syncScatter(adapter, plan)
    out(`Aplicado: ${r.exec.applied} (create=${r.exec.created}, overwrite=${r.exec.overwritten}, delete=${r.exec.deleted}).`)
  }
  return 0
}

function usage(): void {
  out('claudetr <command>\n')
  out('  check                      preflight (git/gh/auth)')
  out('  connect <remote>           clonar/inicializar el repo')
  out('  status                     estado del repo')
  out('  register [--name X]        registrar esta máquina')
  out('  gather  [--dry-run] [--yes]  máquina → repo')
  out('  scatter [--dry-run] [--yes]  repo → máquina')
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv
  switch (command) {
    case 'check':
      return cmdCheck()
    case 'connect':
      return cmdConnect(args)
    case 'status':
      return cmdStatus()
    case 'register':
      return cmdRegister(args)
    case 'gather':
      return cmdSync('gather', args)
    case 'scatter':
      return cmdSync('scatter', args)
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      usage()
      return 0
    default:
      out(`Comando desconocido: ${command}`)
      usage()
      return 1
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((err: unknown) => {
    out(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  })
