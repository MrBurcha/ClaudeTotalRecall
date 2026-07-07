import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import en from './en.json'

type Dict = Record<string, unknown>

const RENDERER = join(dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return e.name === 'i18n' ? [] : sourceFiles(p)
    if (!/\.tsx?$/.test(e.name) || e.name.endsWith('.test.ts') || e.name.endsWith('.test.tsx')) return []
    return [p]
  })
}

/**
 * Extract fully-static t() / i18n.t() keys, i.e. `t('a.b')` where the string
 * literal is immediately followed by `,` or `)`. Dynamic keys such as
 * `t('errors.' + code)` or `t(`x.${y}`)` are skipped on purpose (the closing
 * quote is followed by `+` / not a plain quote), and are covered by the family
 * assertions below.
 */
function staticKeys(src: string): string[] {
  const out: string[] = []
  const re = /\bt\(\s*'([^']+)'\s*[,)]/g
  let m: RegExpExecArray | null
  // Only real dotted keys (filters out doc-comment placeholders like 'relativeTime.<key>').
  while ((m = re.exec(src))) if (/^[A-Za-z0-9_.]+$/.test(m[1])) out.push(m[1])
  return out
}

function lookup(key: string): unknown {
  return key.split('.').reduce<unknown>((o, part) => (o && typeof o === 'object' ? (o as Dict)[part] : undefined), en)
}

/** True if the key exists, or (for count-based calls) its `_one`/`_other` plural variants do. */
function has(key: string): boolean {
  return lookup(key) !== undefined || lookup(`${key}_one`) !== undefined || lookup(`${key}_other`) !== undefined
}

describe('i18n static keys exist in the catalog', () => {
  it('every static t() key used in the renderer is defined in en.json', () => {
    const missing: string[] = []
    for (const file of sourceFiles(RENDERER)) {
      const src = readFileSync(file, 'utf8')
      for (const key of staticKeys(src)) {
        if (!has(key)) missing.push(`${key}  (${file.replace(RENDERER, 'renderer')})`)
      }
    }
    expect(missing, `missing keys:\n${missing.join('\n')}`).toEqual([])
  })

  it('the dynamic key families are complete', () => {
    // Keys built at runtime as `t(prefix + variable)` — assert the whole family.
    for (const k of ['now', 'seconds', 'minutes', 'hours', 'days']) {
      expect(has(k === 'now' ? 'relativeTime.now' : `relativeTime.${k}_other`), `relativeTime.${k}`).toBe(true)
    }
    for (const k of ['create', 'overwrite', 'delete', 'noop', 'skip']) expect(has(`tag.${k}`), `tag.${k}`).toBe(true)
    for (const k of ['noLocalSettings', 'noRepoSettings', 'sourceMissing', 'notInSource', 'noPathForMachine'])
      expect(has(`planReason.${k}`), `planReason.${k}`).toBe(true)
    for (const k of ['git.missing', 'git.install', 'gh.missing', 'gh.install', 'ghAuth.ok', 'ghAuth.fix', 'ghAuth.noGh', 'ghAuth.installFirst'])
      expect(has(`preflight.${k}`), `preflight.${k}`).toBe(true)
    for (const k of ['home', 'projects', 'machines', 'settings']) expect(has(`nav.${k}`), `nav.${k}`).toBe(true)
  })
})
