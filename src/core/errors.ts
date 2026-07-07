// ─────────────────────────────────────────────────────────────────────────────
// Domain errors carrying a stable machine-readable code plus an English default
// message. Pure module (no Electron / renderer imports) so both the CLI and the
// core can throw it freely.
//
// The CLI prints `message` verbatim (English-only, headless). The Electron
// renderer maps `code` (+ `params`) to a localized string, falling back to
// `message`. Since ipcMain.handle only serializes `Error.message` across the IPC
// boundary, main re-throws AppError as a plain Error whose message embeds the
// structured payload behind a sentinel (encodeAppError); the renderer decodes it
// in normalizeError (decodeAppError).
// ─────────────────────────────────────────────────────────────────────────────

export type ErrorParams = Record<string, string | number>

export class AppError extends Error {
  readonly code: string
  readonly params: ErrorParams

  constructor(code: string, message: string, params: ErrorParams = {}) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.params = params
  }
}

/** Prefix that marks an IPC error message as an encoded AppError payload. */
export const IPC_ERROR_SENTINEL = 'CLAUDE_TOTAL_RECALL_ERR::'

export interface DecodedAppError {
  code: string
  params: ErrorParams
  message: string
}

/** main side: turn an AppError into a plain-Error message that survives IPC. */
export function encodeAppError(e: AppError): string {
  const payload: DecodedAppError = { code: e.code, params: e.params, message: e.message }
  return IPC_ERROR_SENTINEL + JSON.stringify(payload)
}

/** renderer side: recover the payload, or null if this isn't an encoded AppError. */
export function decodeAppError(message: string): DecodedAppError | null {
  if (!message.startsWith(IPC_ERROR_SENTINEL)) return null
  try {
    return JSON.parse(message.slice(IPC_ERROR_SENTINEL.length)) as DecodedAppError
  } catch {
    return null
  }
}
