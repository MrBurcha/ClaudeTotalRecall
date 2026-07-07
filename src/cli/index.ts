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
  syncOutgoing,
  syncIncoming,
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
  return ['y', 'yes'].includes(ans)
}

const TYPE_LABEL: Record<PlanAction['type'], string> = {
  create: '＋ create   ',
  overwrite: '~ overwrite',
  delete: '－ delete   ',
  noop: '· same     ',
  skip: '» skip     ',
}

function printPlan(plan: Plan): void {
  const counts: Record<string, number> = {}
  for (const a of plan.actions) counts[a.type] = (counts[a.type] ?? 0) + 1
  out(`\n${plan.verb} plan (${plan.actions.length} actions):`)
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

// ── commands ─────────────────────────────────────────────────────────────────
async function cmdCheck(): Promise<number> {
  const res = await runPreflight()
  for (const c of res.checks) {
    out(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
    if (!c.ok && c.fix) out(`      → ${c.fix}`)
  }
  out(res.ok ? '\nPreflight OK.' : '\nPreflight has problems.')
  return res.ok ? 0 : 1
}

async function cmdConnect(args: string[]): Promise<number> {
  const remote = args.find((a) => !a.startsWith('-'))
  if (!remote) {
    out('Missing remote. Usage: claude-total-recall connect <remote-url>')
    return 1
  }
  const adapter = createPlatformAdapter()
  const res = await connectRepo(remote, adapter)
  out(
    res.initialized
      ? 'Repo connected and initial structure created.'
      : 'Repo connected (already had content).',
  )
  return 0
}

async function cmdStatus(): Promise<number> {
  const adapter = createPlatformAdapter()
  const st = await repoStatus(adapter)
  out(`branch: ${st.branch}`)
  out(`ahead: ${st.ahead}  behind: ${st.behind}  dirty: ${st.dirty}`)
  if (st.conflicted.length) out(`conflicts: ${st.conflicted.join(', ')}`)
  return 0
}

async function cmdRegister(args: string[]): Promise<number> {
  const adapter = createPlatformAdapter()
  const res = await registerMachine(adapter, flagValue(args, '--name'))
  out(
    res.alreadyRegistered
      ? `Machine "${res.machineId}" was already registered.`
      : `Machine "${res.machineId}" registered (${res.machine.os}, ${res.machine.hostname}).`,
  )
  return 0
}

async function cmdSync(verb: Verb, args: string[]): Promise<number> {
  const adapter = createPlatformAdapter()
  const dryRun = hasFlag(args, '--dry-run')
  const yes = hasFlag(args, '--yes')

  // incoming: pull the latest before writing to the machine (except on dry-run).
  if (verb === 'incoming' && !dryRun) {
    const pulled = await pullRepo(adapter)
    if (!pulled.ok) {
      out(`Conflicts while pulling the repo: ${pulled.conflicts.join(', ')}`)
      out('Resolve the conflicts before the incoming sync.')
      return 1
    }
  }

  const plan = await buildVerbPlan(adapter, verb, meta())
  printPlan(plan)

  if (dryRun) {
    out('(dry-run: nothing was touched)')
    return 0
  }
  const mutating = plan.actions.some((a) => a.type !== 'noop' && a.type !== 'skip')
  if (!mutating) {
    out('Nothing to do.')
    return 0
  }
  if (!yes && !(await confirm('Run this Plan?'))) {
    out('Cancelled.')
    return 1
  }

  if (verb === 'outgoing') {
    const r = await syncOutgoing(adapter, plan)
    out(`Applied: ${r.exec.applied} (create=${r.exec.created}, overwrite=${r.exec.overwritten}, delete=${r.exec.deleted}).`)
    if (r.conflicts.length) {
      out(`Conflicts while integrating: ${r.conflicts.join(', ')}. Resolve them and retry.`)
      return 1
    }
    out(r.pushed ? 'Pushed to the remote.' : r.committed ? 'Committed (no push).' : 'Nothing to commit.')
  } else {
    const r = await syncIncoming(adapter, plan)
    out(`Applied: ${r.exec.applied} (create=${r.exec.created}, overwrite=${r.exec.overwritten}, delete=${r.exec.deleted}).`)
  }
  return 0
}

function usage(): void {
  out('claude-total-recall <command>\n')
  out('  check                        preflight (git/gh/auth)')
  out('  connect <remote>             clone/initialize the repo')
  out('  status                       repo status')
  out('  register [--name X]          register this machine')
  out('  outgoing [--dry-run] [--yes]  machine → repo')
  out('  incoming [--dry-run] [--yes]  repo → machine')
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
    case 'outgoing':
      return cmdSync('outgoing', args)
    case 'incoming':
      return cmdSync('incoming', args)
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      usage()
      return 0
    default:
      out(`Unknown command: ${command}`)
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
