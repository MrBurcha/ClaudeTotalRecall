// Espeja la validación de service.ts (assertSafeName): los nombres son claves de
// path en el repo, así que se evita traversal. Validamos en el cliente para dar
// feedback inmediato; el core igual revalida.
const SAFE_NAME = /^[A-Za-z0-9._-]+$/

export function validateName(kind: 'proyecto' | 'ranura', value: string): string | null {
  const v = value.trim()
  if (!v) return `El nombre de ${kind} no puede estar vacío.`
  if (!SAFE_NAME.test(v) || /^\.+$/.test(v)) {
    return `Nombre de ${kind} inválido. Usá solo letras, números, punto, guion y guion bajo.`
  }
  return null
}
