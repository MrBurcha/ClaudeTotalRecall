import type { TFunction } from 'i18next'

// Mirrors service.ts validation (assertSafeName): names are path keys in the repo,
// so traversal is avoided. We validate on the client for instant feedback; the
// core revalidates anyway.
const SAFE_NAME = /^[A-Za-z0-9._-]+$/

export function validateName(
  kind: 'project' | 'slot',
  value: string,
  t: TFunction,
): string | null {
  const v = value.trim()
  if (!v) return t('projects.' + kind + '.nameEmpty')
  if (!SAFE_NAME.test(v) || /^\.+$/.test(v)) {
    return t('projects.' + kind + '.nameInvalid')
  }
  return null
}
