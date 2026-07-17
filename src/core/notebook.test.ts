import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPlatformAdapter } from '../platform'
import { run } from './exec'
import { Git } from './git'
import { connectRepo, createProject, registerMachine, workingCopyDir } from './service'
import {
  createFolder,
  createNote,
  deleteEntry,
  moveEntry,
  notebookTree,
  readNote,
  renameEntry,
  writeNote,
} from './notebook'

const bases: string[] = []

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function newBase(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'claude-total-recall-nb-'))
  bases.push(base)
  return base
}

async function bareRemote(base: string, name = 'remote'): Promise<string> {
  const remote = join(base, `${name}.git`)
  await run('git', ['init', '--bare', '--initial-branch=main', remote])
  return remote
}

function adapterFor(home: string) {
  return createPlatformAdapter(process.platform, home)
}

/** A connected + registered machine, the normal precondition for Notebook use. */
async function setupMachine(base: string, home: string, remote: string) {
  const a = adapterFor(join(base, home))
  await connectRepo(remote, a)
  await registerMachine(a, home)
  return a
}

function nbPath(adapter: ReturnType<typeof adapterFor>, rel: string): string {
  return join(workingCopyDir(adapter), 'memories/notebook', rel)
}

afterEach(async () => {
  for (const b of bases.splice(0)) await rm(b, { recursive: true, force: true })
})

describe('notebookTree', () => {
  it('always exposes a General root and one root per configured project', async () => {
    const base = await newBase()
    const remote = await bareRemote(base)
    const a = await setupMachine(base, 'home1', remote)
    await createProject(a, 'Alpha')
    await createProject(a, 'Beta')

    const tree = await notebookTree(a)
    expect(tree.roots.map((r) => r.id)).toEqual(['general', 'Alpha', 'Beta'])
    expect(tree.roots[0].kind).toBe('general')
    expect(tree.roots[1].kind).toBe('project')
    expect(tree.roots.every((r) => r.children.length === 0)).toBe(true)
  })

  it('surfaces a project folder present on disk even if it is not configured', async () => {
    const base = await newBase()
    const remote = await bareRemote(base)
    const a = await setupMachine(base, 'home1', remote)
    // Simulate an orphaned container (project deleted from config but notes remain).
    await createNote(a, { relPath: 'projects/Ghost/leftover.md', content: '# still here' })

    const tree = await notebookTree(a)
    const ghost = tree.roots.find((r) => r.id === 'Ghost')
    expect(ghost).toBeDefined()
    expect(ghost!.children.map((c) => c.name)).toEqual(['leftover.md'])
  })

  it('builds a nested tree with folders before files, hiding .gitkeep', async () => {
    const base = await newBase()
    const remote = await bareRemote(base)
    const a = await setupMachine(base, 'home1', remote)
    await createFolder(a, 'general/sub')
    await createNote(a, { relPath: 'general/sub/deep.md', content: 'x' })
    await createNote(a, { relPath: 'general/top.md', content: 'y' })

    const tree = await notebookTree(a)
    const general = tree.roots[0]
    expect(general.children.map((c) => `${c.kind}:${c.name}`)).toEqual(['dir:sub', 'file:top.md'])
    const sub = general.children[0]
    expect(sub.children!.map((c) => c.name)).toEqual(['deep.md'])
  })
})

describe('createNote / readNote / writeNote', () => {
  it('creates, reads and edits a note, committing locally each time (no push)', async () => {
    const base = await newBase()
    const remote = await bareRemote(base)
    const a = await setupMachine(base, 'home1', remote)
    const git = new Git(workingCopyDir(a))

    await createNote(a, { relPath: 'general/idea.md', content: '# Idea' })
    expect(await exists(nbPath(a, 'general/idea.md'))).toBe(true)
    const read1 = await readNote(a, 'general/idea.md')
    expect(read1.content).toBe('# Idea')
    expect(read1.exists).toBe(true)

    // Local commit landed but nothing was pushed (still ahead of origin).
    const before = await git.status()
    expect(before.ahead).toBeGreaterThan(0)

    await writeNote(a, { relPath: 'general/idea.md', content: '# Idea v2' })
    expect((await readNote(a, 'general/idea.md')).content).toBe('# Idea v2')
  })

  it('rejects creating a note that already exists', async () => {
    const base = await newBase()
    const remote = await bareRemote(base)
    const a = await setupMachine(base, 'home1', remote)
    await createNote(a, { relPath: 'general/dup.md', content: 'a' })
    await expect(createNote(a, { relPath: 'general/dup.md', content: 'b' })).rejects.toThrow()
  })
})

describe('createFolder', () => {
  it('creates a folder that persists in git via .gitkeep', async () => {
    const base = await newBase()
    const remote = await bareRemote(base)
    const a = await setupMachine(base, 'home1', remote)
    await createFolder(a, 'general/prompts')
    expect(await exists(nbPath(a, 'general/prompts/.gitkeep'))).toBe(true)
  })
})

describe('renameEntry / moveEntry', () => {
  it('renames a note within its folder', async () => {
    const base = await newBase()
    const remote = await bareRemote(base)
    const a = await setupMachine(base, 'home1', remote)
    await createNote(a, { relPath: 'general/old.md', content: 'z' })
    await renameEntry(a, { relPath: 'general/old.md', newName: 'new.md' })
    expect(await exists(nbPath(a, 'general/old.md'))).toBe(false)
    expect(await exists(nbPath(a, 'general/new.md'))).toBe(true)
    expect((await readNote(a, 'general/new.md')).content).toBe('z')
  })

  it('moves a note into another container', async () => {
    const base = await newBase()
    const remote = await bareRemote(base)
    const a = await setupMachine(base, 'home1', remote)
    await createProject(a, 'Target')
    await createNote(a, { relPath: 'general/roam.md', content: 'q' })
    await moveEntry(a, { relPath: 'general/roam.md', toDir: 'projects/Target' })
    expect(await exists(nbPath(a, 'general/roam.md'))).toBe(false)
    expect((await readNote(a, 'projects/Target/roam.md')).content).toBe('q')
  })
})

describe('deleteEntry', () => {
  it('deletes a note and commits the removal', async () => {
    const base = await newBase()
    const remote = await bareRemote(base)
    const a = await setupMachine(base, 'home1', remote)
    await createNote(a, { relPath: 'general/gone.md', content: 'bye' })
    await deleteEntry(a, 'general/gone.md')
    expect(await exists(nbPath(a, 'general/gone.md'))).toBe(false)
    expect((await readNote(a, 'general/gone.md')).exists).toBe(false)
  })
})

describe('security', () => {
  it('rejects path traversal in the relPath', async () => {
    const base = await newBase()
    const remote = await bareRemote(base)
    const a = await setupMachine(base, 'home1', remote)
    await expect(createNote(a, { relPath: '../../escape.md', content: 'x' })).rejects.toThrow()
    await expect(readNote(a, '../../../etc/passwd')).resolves.toMatchObject({ exists: false })
  })

  it('refuses to create a secret-shaped note', async () => {
    const base = await newBase()
    const remote = await bareRemote(base)
    const a = await setupMachine(base, 'home1', remote)
    await expect(
      createNote(a, { relPath: 'general/.credentials.json', content: '{}' }),
    ).rejects.toThrow()
    await expect(
      createNote(a, { relPath: 'general/transcript.jsonl', content: 'x' }),
    ).rejects.toThrow()
  })
})

describe('commit isolation', () => {
  it('a Notebook commit never sweeps in another flow’s staged change', async () => {
    const base = await newBase()
    const remote = await bareRemote(base)
    const a = await setupMachine(base, 'home1', remote)
    const wc = workingCopyDir(a)
    const git = new Git(wc)

    // Simulate a concurrent flow having staged an unrelated change (e.g. syncOutgoing
    // staged a machine edit) that has NOT been committed yet.
    await writeFile(join(wc, 'memories/user/CLAUDE.md'), '# machine edit\n')
    await git.add(['-A', '--', 'memories/user/CLAUDE.md'])

    // A Notebook save must commit ONLY its own path.
    await createNote(a, { relPath: 'general/note.md', content: 'hi' })

    const head = await git.log(1)
    expect(head[0].subject).toContain('notebook: create general/note.md')
    expect(head[0].changes.map((c) => c.path)).toEqual(['memories/notebook/general/note.md'])
    // The foreign change is still staged, untouched by the Notebook commit.
    const staged = await git.raw(['diff', '--cached', '--name-only'])
    expect(staged.stdout).toContain('memories/user/CLAUDE.md')
  })
})

describe('sync integration', () => {
  it('pushes a pending Notebook commit to the remote on the next full sync cycle', async () => {
    const base = await newBase()
    const remote = await bareRemote(base)
    const a = await setupMachine(base, 'home1', remote)

    await createNote(a, { relPath: 'general/shared.md', content: '# shared' })
    // The save is local-only; run a sync cycle (the engine's else-branch pushes ahead commits).
    const { runSyncCycle } = await import('./syncEngine')
    const outcome = await runSyncCycle(a)
    expect(outcome.kind).toBe('synced')

    // A second machine clones and sees the note.
    const b = await setupMachine(base, 'home2', remote)
    const read = await readNote(b, 'general/shared.md')
    expect(read.content).toBe('# shared')
  })

  it('does not lose an unpushed Notebook commit across a config change', async () => {
    const base = await newBase()
    const remote = await bareRemote(base)
    const a = await setupMachine(base, 'home1', remote)

    await createNote(a, { relPath: 'general/precious.md', content: '# do not lose me' })
    // A config edit runs commitConfigChange, which resets --hard origin. The hardening
    // must push the pending Notebook commit first so it survives.
    await createProject(a, 'SomeProject')

    expect(await readFile(nbPath(a, 'general/precious.md'), 'utf8')).toBe('# do not lose me')
  })
})
