import { useState } from 'react'
import { Button } from '../../components/Button'
import { Icon } from '../../components/Icon'
import { SegmentedControl } from '../../components/SegmentedControl'
import { api } from '../../state/api'
import { useAppState } from '../../state/store'
import { useActions } from '../../state/useActions'

type Side = 'local' | 'remote'

/**
 * Reemplaza el banner rojo. Junta la elección local/remoto por archivo y recién
 * al finalizar aplica todo y cierra el merge (así la lista no desaparece a medida
 * que se resuelve). Local = lo de esta máquina; Remoto = lo del repo.
 */
export function ConflictResolver({ files }: { files: string[] }): JSX.Element {
  const { busy } = useAppState()
  const actions = useActions()
  const [choices, setChoices] = useState<Record<string, Side>>({})
  const allChosen = files.every((f) => choices[f])

  const finalize = (): Promise<void> =>
    actions.run(async () => {
      for (const f of files) await api.conflictResolve(f, choices[f])
      const r = await api.conflictComplete()
      return r.pushed ? 'Conflictos resueltos y pusheados.' : 'Conflictos resueltos.'
    })

  return (
    <div className="card card--danger">
      <div className="card__head">
        <span className="card__title cluster">
          <Icon name="alert" size={18} />
          Resolvé {files.length} conflicto(s)
        </span>
      </div>
      <p className="muted">
        Por cada archivo, elegí con qué versión quedarte. <b>Local</b> = lo de esta máquina;{' '}
        <b>Remoto</b> = lo del repo.
      </p>
      <ul className="conflict-list">
        {files.map((f) => (
          <li key={f} className="conflict-row">
            <span className="mono grow truncate">{f}</span>
            <SegmentedControl<Side>
              ariaLabel={`Resolución de ${f}`}
              value={choices[f] ?? null}
              onChange={(side) => setChoices((c) => ({ ...c, [f]: side }))}
              options={[
                { value: 'local', label: 'Local' },
                { value: 'remote', label: 'Remoto' },
              ]}
            />
          </li>
        ))}
      </ul>
      <div className="row between">
        <span className="muted">
          {allChosen ? 'Listo para finalizar.' : 'Elegí una versión para cada archivo.'}
        </span>
        <Button variant="primary" icon="check" disabled={busy || !allChosen} onClick={finalize}>
          Finalizar merge
        </Button>
      </div>
    </div>
  )
}
