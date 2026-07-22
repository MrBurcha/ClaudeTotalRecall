import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MEMORY_MAINTENANCE_PROMPT } from './memoryMaintenance'

describe('MEMORY_MAINTENANCE_PROMPT', () => {
  it('is mirrored verbatim in the README (no drift)', () => {
    // Normalize CRLF→LF: on a Windows checkout git may materialize README with CRLF,
    // which would break the byte-exact substring match though the content is identical.
    const readme = readFileSync(join(__dirname, '../../README.md'), 'utf8').replace(/\r\n/g, '\n')
    expect(readme).toContain(MEMORY_MAINTENANCE_PROMPT)
  })
})
