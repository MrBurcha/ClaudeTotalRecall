import type { Config } from './types'

/**
 * Deterministic name-similarity in [0, 1] between a canonical project name and a
 * folder/slug name, used ONLY to rank association suggestions (never to alter an
 * identity or a slug). Signals, both lowercased/trimmed: exact match → 1;
 * containment (one inside the other) → strong, scaled by length ratio; otherwise
 * the Sørensen–Dice coefficient over character bigrams. Pure — same inputs always
 * yield the same score.
 */
export function scoreNameMatch(canonicalName: string, folderName: string): number {
  const a = canonicalName.toLowerCase().trim()
  const b = folderName.toLowerCase().trim()
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) {
    const short = Math.min(a.length, b.length)
    const long = Math.max(a.length, b.length)
    return 0.6 + 0.4 * (short / long)
  }
  return diceCoefficient(a, b)
}

/** Sørensen–Dice similarity over character bigrams (0..1). */
function diceCoefficient(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return 0
  const bigramsA = bigramCounts(a)
  let overlap = 0
  for (const [gram, countB] of bigramCounts(b)) {
    const countA = bigramsA.get(gram)
    if (countA) overlap += Math.min(countA, countB)
  }
  return (2 * overlap) / (a.length - 1 + (b.length - 1))
}

function bigramCounts(s: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const gram = s.slice(i, i + 2)
    counts.set(gram, (counts.get(gram) ?? 0) + 1)
  }
  return counts
}

/**
 * Project names that are configured on some machine but NOT associated on
 * `machineId` (no slot has a path here). These are the candidates to adopt/reconcile
 * on this machine instead of creating a duplicate. Projects with no folders at all
 * are excluded (nothing to associate yet).
 */
export function unassociatedProjects(config: Config, machineId: string): string[] {
  const out: string[] = []
  for (const [name, project] of Object.entries(config.projects)) {
    const slots = Object.values(project.folders)
    const mappedSomewhere = slots.some((byMachine) => Object.keys(byMachine).length > 0)
    const mappedHere = slots.some((byMachine) => byMachine[machineId] != null)
    if (mappedSomewhere && !mappedHere) out.push(name)
  }
  return out
}
