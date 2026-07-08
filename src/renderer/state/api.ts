import { decodeAppError } from '../../core/errors'
import i18n from '../i18n'

/**
 * The typed renderer ↔ main bridge (the single point of contact with the backend).
 * Guarded so this module can also be imported under Node (tests): in the renderer
 * `window` always exists; under Node it resolves to undefined and only the pure
 * helpers below (normalizeError) are exercised.
 */
export const api = (
  typeof window !== 'undefined' ? window.claudeTotalRecall : undefined
) as Window['claudeTotalRecall']

/**
 * Electron prefixes exceptions that cross ipcMain.handle
 * ("Error invoking remote method '…': Error: …"). We strip that, then decode an
 * AppError smuggled through the sentinel (see core/errors) and localize it by code,
 * falling back to its English default message. Anything else is returned verbatim.
 */
export function normalizeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  const stripped = raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  const decoded = decodeAppError(stripped)
  if (decoded) {
    return i18n.t(`errors.${decoded.code}`, { ...decoded.params, defaultValue: decoded.message })
  }
  return stripped
}
