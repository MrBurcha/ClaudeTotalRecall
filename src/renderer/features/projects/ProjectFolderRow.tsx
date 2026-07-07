import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const { busy } = useAppState()
  const actions = useActions()
  const current = machineId ? byMachine[machineId] : undefined
  const others = Object.keys(byMachine).filter((m) => m !== machineId)

  const edit = (): void => actions.openModal({ kind: 'folder-form', project, slot, path: current })

  const remove = async (): Promise<void> => {
    const ok = await actions.confirm({
      title: t('projects.removeFolder.title'),
      body: t('projects.removeFolder.body', { slot }),
      confirmLabel: t('common.remove'),
      danger: true,
    })
    if (!ok) return
    void actions.run(async () => {
      await api.projectRemoveFolder(project, slot)
      return t('projects.folderRemoved', { project, slot })
    })
  }

  return (
    <li className="folder-row">
      <div className="folder-row__main">
        <span className="folder-slot mono">{slot}</span>
        {current ? (
          <span className="mono grow truncate">{current}</span>
        ) : (
          <span className="muted grow">{t('projects.noPathOnMachine')}</span>
        )}
        <IconButton icon="pencil" label={t('projects.editFolder')} disabled={busy} onClick={edit} />
        {current && (
          <IconButton
            icon="trash"
            label={t('projects.removeFromMachine')}
            disabled={busy}
            onClick={remove}
          />
        )}
      </div>
      {others.length > 0 && (
        <div className="muted mono folder-row__others">
          {t('projects.alsoOn', { machines: others.join(', ') })}
        </div>
      )}
    </li>
  )
}
