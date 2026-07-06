/** El bridge tipado renderer ↔ main (único punto de contacto con el backend). */
export const api = window.claudetr

/**
 * Electron prefija las excepciones que cruzan ipcMain.handle
 * ("Error invoking remote method '…': Error: …"). Lo sacamos para mostrar el
 * mensaje humano del core tal cual. (Antes vivía inline en App.tsx.)
 */
export function normalizeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  return raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}
