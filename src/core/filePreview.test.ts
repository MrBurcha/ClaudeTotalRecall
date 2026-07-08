import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAX_PREVIEW_BYTES, readMemoryFilePreview } from './filePreview'

let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'ctr-preview-'))
  await mkdir(join(root, 'memories', 'user'), { recursive: true })
  await writeFile(join(root, 'memories', 'user', 'CLAUDE.md'), '# hi\n')
  await writeFile(join(root, 'memories', 'user', 'bin'), Buffer.from([0x41, 0x00, 0x42]))
  await writeFile(join(root, 'memories', 'user', 'big.txt'), 'a'.repeat(MAX_PREVIEW_BYTES + 100))
  // A real file that lives OUTSIDE memories/ — the traversal guard must refuse it.
  await mkdir(join(root, 'secret'), { recursive: true })
  await writeFile(join(root, 'secret', 'outside.txt'), 'nope')
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('readMemoryFilePreview', () => {
  it('reads a normal text file', async () => {
    const p = await readMemoryFilePreview(root, 'memories/user/CLAUDE.md')
    expect(p).toMatchObject({ exists: true, binary: false, truncated: false, content: '# hi\n' })
  })

  it('flags a missing file as exists:false with empty content', async () => {
    const p = await readMemoryFilePreview(root, 'memories/user/nope.md')
    expect(p.exists).toBe(false)
    expect(p.content).toBe('')
  })

  it('flags a binary file (NUL byte) and returns no content', async () => {
    const p = await readMemoryFilePreview(root, 'memories/user/bin')
    expect(p).toMatchObject({ exists: true, binary: true, content: '' })
  })

  it('truncates an oversized file to the byte cap but reports the full size', async () => {
    const p = await readMemoryFilePreview(root, 'memories/user/big.txt')
    expect(p.exists).toBe(true)
    expect(p.truncated).toBe(true)
    expect(p.content.length).toBe(MAX_PREVIEW_BYTES)
    expect(p.size).toBe(MAX_PREVIEW_BYTES + 100)
  })

  it('refuses a real file reached via traversal outside memories/', async () => {
    expect((await readMemoryFilePreview(root, '../secret/outside.txt')).exists).toBe(false)
    expect((await readMemoryFilePreview(root, 'memories/../secret/outside.txt')).exists).toBe(false)
  })

  it('refuses an absolute path outside the repo', async () => {
    expect((await readMemoryFilePreview(root, '/etc/hostname')).exists).toBe(false)
  })
})
