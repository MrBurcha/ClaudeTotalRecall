import { describe, expect, it, beforeEach } from 'vitest'
import { normalizeError } from './api'
import { AppError, encodeAppError } from '../../core/errors'
import i18n from '../i18n'

// Electron wraps rejections crossing ipcMain.handle with this prefix.
const wrap = (msg: string): string => `Error invoking remote method 'x:y': Error: ${msg}`

describe('normalizeError', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('localizes a sentinel-encoded AppError by code (en/es)', async () => {
    const encoded = encodeAppError(new AppError('path.empty', 'The path cannot be empty.'))
    expect(normalizeError(new Error(wrap(encoded)))).toBe('The path cannot be empty.')
    await i18n.changeLanguage('es')
    expect(normalizeError(new Error(wrap(encoded)))).toBe('La ruta no puede estar vacía.')
  })

  it('interpolates params into the localized message', () => {
    const encoded = encodeAppError(
      new AppError('project.invalidName', 'Invalid project name: "{{value}}".', { value: 'a b' }),
    )
    expect(normalizeError(new Error(wrap(encoded)))).toContain('a b')
  })

  it('falls back to the English default when the code is unknown', () => {
    const encoded = encodeAppError(new AppError('does.notExist', 'English default text'))
    expect(normalizeError(new Error(wrap(encoded)))).toBe('English default text')
  })

  it('strips the Electron prefix and returns plain messages verbatim (legacy)', () => {
    expect(normalizeError(new Error(wrap('raw human message')))).toBe('raw human message')
    expect(normalizeError(new Error('bare message'))).toBe('bare message')
  })
})
