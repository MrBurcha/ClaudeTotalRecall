import { IconButton } from '../../components/IconButton'
import { api } from '../../state/api'
import { useAppState } from '../../state/store'
import { useActions } from '../../state/useActions'

export function ProjectFolderRow({
  project,
  slot,
  byMachine,
  machineId,
}: {
  project: string
  slot: string
  byMachine: Record<string, string>
  machineId: string | null
}): JSX.Element {
  const { busy } = useAppState()
  const actions = useActions()
  const current = machineId ? byMachine[machineId] : undefined
  const others = Object.keys(byMachine).filter((m) => m !== machineId)

  const edit = (): void => actions.openModal({ kind: 'folder-form', project, slot, path: current })

  const remove = async (): Promise<void> => {
    const ok = await actions.confirm({
      title: 'Quitar carpeta',
      body: `¿Quitar la ranura "${slot}" de esta máquina? No borra la carpeta, solo deja de sincronizarla acá.`,
      confirmLabel: 'Quitar',
      danger: true,
    })
    if (!ok) return
    void actions.run(async () => {
      await api.projectRemoveFolder(project, slot)
      return `Quitado ${project}/${slot} de esta máquina.`
    })
  }

  return (
    <li className="folder-row">
      <div className="folder-row__main">
        <span className="folder-slot mono">{slot}</span>
        {current ? (
          <span className="mono grow truncate">{current}</span>
        ) : (
          <span className="muted grow">sin path en esta máquina</span>
        )}
        <IconButton icon="pencil" label="Editar carpeta" disabled={busy} onClick={edit} />
        {current && (
          <IconButton icon="trash" label="Quitar de esta máquina" disabled={busy} onClick={remove} />
        )}
      </div>
      {others.length > 0 && (
        <div className="muted mono folder-row__others">también en: {others.join(', ')}</div>
      )}
    </li>
  )
}
