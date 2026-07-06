import { describe, expect, it } from 'vitest'

// Fase 0 smoke test: proves the vitest runner is wired up.
// Real core tests (config, settingsMerge, plan, ...) land in Fase 1+.
describe('scaffolding', () => {
  it('runs the test runner', () => {
    expect(1 + 1).toBe(2)
  })
})
