import type { SettingsObject } from './types'

/**
 * outgoing (máquina → repo): del objeto real saca las top-level keys declaradas
 * como locales (las claves de `localOverrides`); el resto es lo compartido que
 * viaja al repo. Merge SHALLOW por top-level key. No muta las entradas.
 */
export function splitForOutgoing(
  real: SettingsObject,
  localOverrides: SettingsObject,
): SettingsObject {
  const shared: SettingsObject = {}
  for (const key of Object.keys(real)) {
    if (Object.prototype.hasOwnProperty.call(localOverrides, key)) continue
    shared[key] = real[key]
  }
  return shared
}

/**
 * incoming (repo → máquina): al objeto compartido le encima los overrides
 * locales (lo local gana). Reconstrucción completa (no patch): el resultado es
 * exactamente shared + localOverrides. Merge SHALLOW por top-level key. No muta
 * las entradas.
 */
export function mergeForIncoming(
  shared: SettingsObject,
  localOverrides: SettingsObject,
): SettingsObject {
  return { ...shared, ...localOverrides }
}
