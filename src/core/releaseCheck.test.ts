import { describe, expect, it } from 'vitest'
import { checkForNewRelease, isNewerVersion, type ReleaseCheckDeps } from './releaseCheck'

const jsonResponse = (body: unknown, ok = true, status = 200): Response =>
  ({
    ok,
    status,
    json: async () => body,
  }) as Response

describe('isNewerVersion', () => {
  it('is true when the candidate is newer', () => {
    expect(isNewerVersion('v0.9.0', '0.8.1')).toBe(true)
    expect(isNewerVersion('v1.0.0', '0.9.9')).toBe(true)
    expect(isNewerVersion('v0.8.2', '0.8.1')).toBe(true)
  })

  it('is false when equal or older', () => {
    expect(isNewerVersion('v0.8.1', '0.8.1')).toBe(false)
    expect(isNewerVersion('v0.8.0', '0.8.1')).toBe(false)
    expect(isNewerVersion('v0.7.9', '0.8.1')).toBe(false)
  })

  it('is false for malformed tags', () => {
    expect(isNewerVersion('not-a-version', '0.8.1')).toBe(false)
    expect(isNewerVersion('v1.0.0-beta', '0.8.1')).toBe(false)
    expect(isNewerVersion('v0.9.0', 'garbage')).toBe(false)
  })
})

describe('checkForNewRelease', () => {
  it('reports an update when the latest tag is newer', async () => {
    const deps: ReleaseCheckDeps = { fetch: async () => jsonResponse({ tag_name: 'v0.9.0' }) }
    const result = await checkForNewRelease('0.8.1', deps)
    expect(result).toEqual({ ok: true, latestVersion: 'v0.9.0' })
  })

  it('reports no update when already on the latest', async () => {
    const deps: ReleaseCheckDeps = { fetch: async () => jsonResponse({ tag_name: 'v0.8.1' }) }
    const result = await checkForNewRelease('0.8.1', deps)
    expect(result).toEqual({ ok: true, latestVersion: null })
  })

  it('reports no update when the latest tag is older', async () => {
    const deps: ReleaseCheckDeps = { fetch: async () => jsonResponse({ tag_name: 'v0.7.0' }) }
    const result = await checkForNewRelease('0.8.1', deps)
    expect(result).toEqual({ ok: true, latestVersion: null })
  })

  it('treats a non-200 response (e.g. 404, no stable release yet) as a network failure', async () => {
    const deps: ReleaseCheckDeps = { fetch: async () => jsonResponse({}, false, 404) }
    const result = await checkForNewRelease('0.8.1', deps)
    expect(result).toEqual({ ok: false, reason: 'network' })
  })

  it('reports a network failure when fetch rejects', async () => {
    const deps: ReleaseCheckDeps = {
      fetch: async () => {
        throw new Error('offline')
      },
    }
    const result = await checkForNewRelease('0.8.1', deps)
    expect(result).toEqual({ ok: false, reason: 'network' })
  })

  it('reports a parse failure on malformed JSON', async () => {
    const deps: ReleaseCheckDeps = {
      fetch: async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('bad json')
          },
        }) as unknown as Response,
    }
    const result = await checkForNewRelease('0.8.1', deps)
    expect(result).toEqual({ ok: false, reason: 'parse' })
  })

  it('reports a parse failure when the response shape is unexpected', async () => {
    const deps: ReleaseCheckDeps = { fetch: async () => jsonResponse({ nope: true }) }
    const result = await checkForNewRelease('0.8.1', deps)
    expect(result).toEqual({ ok: false, reason: 'parse' })
  })

  it('reports a parse failure when tag_name does not look like a version', async () => {
    const deps: ReleaseCheckDeps = {
      fetch: async () => jsonResponse({ tag_name: 'not-a-version' }),
    }
    const result = await checkForNewRelease('0.8.1', deps)
    expect(result).toEqual({ ok: false, reason: 'parse' })
  })
})
