import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MEMORY_MAINTENANCE_PROMPT } from './memoryMaintenance'

describe('MEMORY_MAINTENANCE_PROMPT', () => {
  it('is mirrored verbatim in the README (no drift)', () => {
    const readme = readFileSync(join(__dirname, '../../README.md'), 'utf8')
    expect(readme).toContain(MEMORY_MAINTENANCE_PROMPT)
  })
})
