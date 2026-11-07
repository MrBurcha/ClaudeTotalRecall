import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPlatformAdapter } from '../platform'
import { Git, type FileLogEntry } from './git'
import {
  createNote,
  diffNoteVersion,
  noteHistory,
  readNoteVersion,
  renameEntry,
  restoreNoteVersion,
  toVersions,
  versionKind,
  writeNote,
} from './notebook'
import { workingCopyDir } from './service'

// Version history (#107). A bare local working copy is enough here: history,
// diff and restore only need git + the files, not a remote or a registration.

const bases: string[] = []

afterEach(async () => {
  for (const b of bases.splice(0)) await rm(b, { recursive: true, force: true })
})

async function setup() {
  const base = await mkdtemp(join(tmpdir(), 'engram-nbh-'))
  bases.push(base)
  const a = createPlatformAdapter(process.platform, join(base, 'home'))
  const wc = workingCopyDir(a)
  await mkdir(wc, { recursive: true })
  const git = new Git(wc)
  await git.init()
  await git.config('user.email', 'test@engram.local')
  await git.config('user.name', 'Engram Test')
  // Same verbatim-bytes policy as a real memories repo (see service.ts).
  await writeFile(join(wc, '.gitattributes'), '* -text\n')
  await git.add()
  await git.commit('init')
  return { a, git, wc }
}

describe('noteHistory', () => {
  it('lists every commit newest first, following a rename, with each path at its commit', async () => {
    const { a } = await setup()
    await createNote(a, { relPath: 'general/draft.md', content: 'v1\n' })
    await writeNote(a, { relPath: 'general/draft.md', content: 'v2\n' })
    await renameEntry(a, { relPath: 'general/draft.md', newName: 'Pequeños pasos.md' })
    await writeNote(a, { relPath: 'general/Pequeños pasos.md', content: 'v3\n' })

    const { versions, truncated } = await noteHistory(a, 'general/Pequeños pasos.md')
    expect(truncated).toBe(false)
    expect(versions.map((v) => [v.kind, v.path])).toEqual([
      ['update', 'general/Pequeños pasos.md'],
      ['rename', 'general/Pequeños pasos.md'],
      ['update', 'general/draft.md'],
      ['create', 'general/draft.md'],
    ])
    expect(versions.every((v) => v.available)).toBe(true)
    expect(versions.map((v) => v.current)).toEqual([true, false, false, false])
    expect(versions[0].shortHash).toBe(versions[0].hash.slice(0, 7))
    expect(versions[0].subject).toBe('notebook: update general/Pequeños pasos.md')

    // Viewing an old version works after the rename, using its path at that commit.
    const v1 = await readNoteVersion(a, { hash: versions[3].hash, path: versions[3].path })
    expect(v1).toMatchObject({ content: 'v1\n', exists: true, binary: false, truncated: false })
  })

  it('returns an empty history for a note that was never committed', async () => {
    const { a } = await setup()
    expect(await noteHistory(a, 'general/nothing.md')).toEqual({ versions: [], truncated: false })
  })
})

describe('readNoteVersion', () => {
  it('reports a path that did not exist at that commit as missing', async () => {
    const { a, git } = await setup()
    await createNote(a, { relPath: 'general/a.md', content: 'x' })
    const head = (await git.revParse('HEAD'))!
    expect(await readNoteVersion(a, { hash: head, path: 'general/other.md' })).toMatchObject({
      exists: false,
    })
  })

  it('flags a binary version and shows no content', async () => {
    const { a, git, wc } = await setup()
    const abs = join(wc, 'memories/notebook/general/blob.bin')
    await mkdir(join(wc, 'memories/notebook/general'), { recursive: true })
    await writeFile(abs, Buffer.from([0x50, 0x00, 0x01, 0x02]))
    await git.add()
    await git.commit('add binary')
    const head = (await git.revParse('HEAD'))!
    expect(await readNoteVersion(a, { hash: head, path: 'general/blob.bin' })).toMatchObject({
      content: '',
      binary: true,
      exists: true,
      size: 4,
    })
  })

  it('rejects traversal in the path and anything that is not an object id', async () => {
    const { a, git } = await setup()
    const head = (await git.revParse('HEAD'))!
    await expect(readNoteVersion(a, { hash: head, path: '../../claudetr.json' })).rejects.toThrow()
    await expect(readNoteVersion(a, { hash: head, path: '.gitattributes' })).rejects.toThrow()
    for (const bad of ['HEAD', '--output=x', 'abc', 'abcdef1..HEAD', 'main~1']) {
      await expect(readNoteVersion(a, { hash: bad, path: 'general/a.md' })).rejects.toMatchObject({
        code: 'notebook.invalidVersion',
      })
    }
  })
})

describe('diffNoteVersion', () => {
  it('diffs an old version (old side) against the current content (new side)', async () => {
    const { a } = await setup()
    await createNote(a, { relPath: 'general/n.md', content: 'one\ntwo\nthree\n' })
    await writeNote(a, { relPath: 'general/n.md', content: 'one\nTWO\nthree\nfour\n' })
    const { versions } = await noteHistory(a, 'general/n.md')
    const first = versions[1]

    const d = await diffNoteVersion(a, {
      relPath: 'general/n.md',
      hash: first.hash,
      path: first.path,
    })
    expect(d.identical).toBe(false)
    expect(d.binary).toBe(false)
    const lines = d.hunks.flatMap((h) => h.lines).map((l) => `${l.kind}:${l.text}`)
    expect(lines).toEqual(['ctx:one', 'del:two', 'add:TWO', 'ctx:three', 'add:four'])

    const same = await diffNoteVersion(a, {
      relPath: 'general/n.md',
      hash: versions[0].hash,
      path: versions[0].path,
    })
    expect(same).toMatchObject({ identical: true, hunks: [] })
  })

  it('also diffs against an uncommitted edit on disk', async () => {
    const { a, wc } = await setup()
    await createNote(a, { relPath: 'general/n.md', content: 'a\n' })
    const { versions } = await noteHistory(a, 'general/n.md')
    await writeFile(join(wc, 'memories/notebook/general/n.md'), 'a\nb\n')
    const d = await diffNoteVersion(a, {
      relPath: 'general/n.md',
      hash: versions[0].hash,
      path: versions[0].path,
    })
    expect(d.hunks.flatMap((h) => h.lines).map((l) => `${l.kind}:${l.text}`)).toEqual([
      'ctx:a',
      'add:b',
    ])
  })

  it('fails clearly when the note or the version is gone', async () => {
    const { a, git } = await setup()
    await createNote(a, { relPath: 'general/n.md', content: 'a\n' })
    const head = (await git.revParse('HEAD'))!
    await expect(
      diffNoteVersion(a, { relPath: 'general/missing.md', hash: head, path: 'general/n.md' }),
    ).rejects.toMatchObject({ code: 'notebook.notFound' })
    await expect(
      diffNoteVersion(a, { relPath: 'general/n.md', hash: head, path: 'general/never.md' }),
    ).rejects.toMatchObject({ code: 'notebook.versionNotFound' })
  })
})

describe('restoreNoteVersion', () => {
  it('writes the old content to the current path as a local restore commit', async () => {
    const { a, git, wc } = await setup()
    await createNote(a, { relPath: 'general/old.md', content: 'first\n' })
    await renameEntry(a, { relPath: 'general/old.md', newName: 'new.md' })
    await writeNote(a, { relPath: 'general/new.md', content: 'second\n' })
    const { versions } = await noteHistory(a, 'general/new.md')
    const original = versions[versions.length - 1]
    expect(original.path).toBe('general/old.md')

    const r = await restoreNoteVersion(a, {
      relPath: 'general/new.md',
      hash: original.hash,
      path: original.path,
    })
    expect(r).toEqual({ committed: true })
    expect(await readFile(join(wc, 'memories/notebook/general/new.md'), 'utf8')).toBe('first\n')
    const head = (await git.log(1))[0]
    expect(head.subject).toBe(`notebook: restore general/new.md to ${original.hash.slice(0, 7)}`)
    expect(head.changes.map((c) => c.path)).toEqual(['memories/notebook/general/new.md'])

    // The restore is itself a version, and the replaced content stays in history.
    const after = await noteHistory(a, 'general/new.md')
    expect(after.versions[0]).toMatchObject({ kind: 'restore', current: true })
    expect(after.versions).toHaveLength(versions.length + 1)

    // Restoring the content the note already has commits nothing.
    const again = await restoreNoteVersion(a, {
      relPath: 'general/new.md',
      hash: after.versions[0].hash,
      path: after.versions[0].path,
    })
    expect(again).toEqual({ committed: false })
  })

  it('refuses a binary version and an unknown one', async () => {
    const { a, git, wc } = await setup()
    await mkdir(join(wc, 'memories/notebook/general'), { recursive: true })
    await writeFile(join(wc, 'memories/notebook/general/b.md'), Buffer.from([0x41, 0x00]))
    await git.add()
    await git.commit('binary note')
    const head = (await git.revParse('HEAD'))!
    await expect(
      restoreNoteVersion(a, { relPath: 'general/b.md', hash: head, path: 'general/b.md' }),
    ).rejects.toMatchObject({ code: 'notebook.versionNotText' })
    await expect(
      restoreNoteVersion(a, { relPath: 'general/b.md', hash: head, path: 'general/zz.md' }),
    ).rejects.toMatchObject({ code: 'notebook.versionNotFound' })
  })
})

describe('versionKind / toVersions', () => {
  it('reads the Notebook verb from the subject, else the per-file status', () => {
    expect(versionKind('notebook: create general/a.md', 'added')).toBe('create')
    expect(versionKind('notebook: update general/a.md', 'modified')).toBe('update')
    expect(versionKind('notebook: move general/a.md -> general/b.md', 'renamed')).toBe('rename')
    expect(versionKind('notebook: restore general/a.md to abc1234', 'modified')).toBe('restore')
    expect(versionKind('notebook: delete general/a.md', 'deleted')).toBe('delete')
    expect(versionKind('something else', 'added')).toBe('create')
    expect(versionKind('something else', 'modified')).toBe('update')
    expect(versionKind('something else', 'renamed')).toBe('rename')
    expect(versionKind('something else', 'deleted')).toBe('delete')
    expect(versionKind('Merge branch main', null)).toBe('other')
  })

  it('carries the pre-rename path to merge rows and hides deletions/outside paths', () => {
    const row = (p: Partial<FileLogEntry>): FileLogEntry => ({
      hash: 'a'.repeat(40),
      at: '2026-01-01T00:00:00Z',
      author: 't',
      subject: 's',
      status: 'modified',
      path: null,
      fromPath: null,
      blob: null,
      ...p,
    })
    const versions = toVersions(
      [
        row({
          status: 'renamed',
          path: 'memories/notebook/general/b.md',
          fromPath: 'memories/notebook/general/a.md',
          blob: 'f'.repeat(40),
        }),
        row({ status: null, subject: 'Merge' }), // a merge: no per-file row
        row({ status: 'deleted', path: 'memories/notebook/general/a.md' }),
        row({ status: 'added', path: 'memories/user/CLAUDE.md' }),
      ],
      'memories/notebook/general/b.md',
      'f'.repeat(40),
    )
    expect(versions.map((v) => [v.kind, v.path, v.available, v.current])).toEqual([
      ['rename', 'general/b.md', true, true],
      ['other', 'general/a.md', true, false],
      ['delete', 'general/a.md', false, false],
      ['create', '', false, false],
    ])
  })
})
