import { describe, it, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { resolveEnvPath, findExecutable } from './resolvePath'

describe('resolveEnvPath', () => {
  it('incluye dirs comunes cuando el PATH viene vacío', () => {
    const result = resolveEnvPath('')
    const dirs = result.split(':')
    expect(dirs).toContain('/opt/homebrew/bin')
    expect(dirs).toContain('/usr/bin')
    expect(dirs).toContain('/bin')
    expect(dirs).toContain('/usr/local/bin')
    expect(dirs).toContain('/usr/sbin')
    expect(dirs).toContain('/sbin')
    expect(dirs).toContain(path.join(os.homedir(), '.local', 'bin'))
  })

  it('preserva el orden: primero lo existente, luego los comunes que faltan', () => {
    const result = resolveEnvPath('/custom/bin')
    const dirs = result.split(':')
    expect(dirs[0]).toBe('/custom/bin')
    expect(dirs).toContain('/opt/homebrew/bin')
  })

  it('deduplica cuando el PATH ya contenía un dir común', () => {
    const result = resolveEnvPath('/usr/bin:/custom/bin')
    const dirs = result.split(':')
    const count = dirs.filter((d) => d === '/usr/bin').length
    expect(count).toBe(1)
    expect(dirs[0]).toBe('/usr/bin')
    expect(dirs[1]).toBe('/custom/bin')
  })

  it('ignora segmentos vacíos del PATH', () => {
    const result = resolveEnvPath('/custom/bin::')
    const dirs = result.split(':')
    expect(dirs).not.toContain('')
  })
})

describe('findExecutable', () => {
  it('encuentra git en una ruta absoluta que termina en /git', () => {
    const found = findExecutable('git')
    expect(found).not.toBeNull()
    expect(found!.endsWith('/git')).toBe(true)
    expect(path.isAbsolute(found!)).toBe(true)
  })

  it('devuelve null para un binario inexistente', () => {
    expect(findExecutable('binario-que-no-existe-xyz')).toBeNull()
  })

  it('respeta el envPath provisto', () => {
    const found = findExecutable('git', '/usr/bin')
    expect(found).toBe('/usr/bin/git')
  })

  it('devuelve null si el envPath no contiene el binario', () => {
    expect(findExecutable('git', '/nonexistent/dir')).toBeNull()
  })
})
