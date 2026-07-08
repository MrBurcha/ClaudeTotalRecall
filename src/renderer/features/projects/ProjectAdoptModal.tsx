import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MachineMappingProposal, RemapSlot, SlotKind } from '../../../core/discovery'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import { api, normalizeError } from '../../state/api'
import { useActions } from '../../state/useActions'

interface Row {
  slot: string
  kind: SlotKind
  path: string
  include: boolean
  status: RemapSlot['status']
  exists: boolean
  alreadyConfigured: boolean
}

function toRows(slots: RemapSlot[]): Row[] {
  return slots.map((s) => ({
    slot: s.slot,
    kind: s.kind,
    path: s.proposedPath ?? '',
    include: !s.alreadyConfigured && (s.status === 'ok' || s.status === 'missing'),
    status: s.status,
    exists: s.exists,
    alreadyConfigured: s.alreadyConfigured,
  }))
}

/**
 * Flow B: adopt on THIS machine a project already configured elsewhere. Auto-remaps
 * each slot's path from a reference machine (swapping the stored home prefix), checks
 * whether it exists on disk, and lets the user confirm or hand-pick the ones that
 * couldn't be mapped. Applies every path in one commit.
 */
export function ProjectAdoptModal({ name }: { name: string }): JSX.Element {
  const { t } = useTranslation()
  const actions = useActions()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const proposal: MachineMappingProposal = await api.projectProposeAdoption(name)
        if (alive) setRows(toRows(proposal.slots))
      } catch (e) {
        if (alive) setError(normalizeError(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [name])

  const setRow = (slot: string, patch: Partial<Row>): void =>
    setRows((rs) => (rs ? rs.map((r) => (r.slot === slot ? { ...r, ...patch } : r)) : rs))

  const pickFor = async (slot: string, kind: SlotKind): Promise<void> => {
    const chosen = kind === 'file' ? await api.pickFile() : await api.projectPickFolder()
    if (chosen) {
      setRow(slot, { path: chosen, include: true })
      setError(null)
    }
  }

  const actionable = rows?.some((r) => !r.alreadyConfigured) ?? false

  const submit = async (): Promise<void> => {
    if (!rows) return
    const chosen = rows.filter((r) => r.include && !r.alreadyConfigured && r.path.trim())
    if (chosen.length === 0) {
      setError(t('projects.adopt.selectOne'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await api.projectApplyMapping({
        projectName: name,
        slots: chosen.map((r) => ({ slot: r.slot, path: r.path.trim(), kind: r.kind })),
      })
      await actions.refresh()
      actions.notify(t('projects.adopt.done', { count: res.slots }), 'ok')
      actions.closeModal()
    } catch (e) {
      setError(normalizeError(e))
      setSubmitting(false)
    }
  }

  const statusBadge = (r: Row): JSX.Element | null => {
    if (r.alreadyConfigured) return <Badge muted>{t('projects.adopt.already')}</Badge>
    if (r.status === 'ok') return <Badge>{t('projects.adopt.exists')}</Badge>
    if (r.status === 'missing') return <Badge muted>{t('projects.adopt.missing')}</Badge>
    if (r.status === 'notUnderHome')
      return <span className="muted">{t('projects.adopt.manual')}</span>
    return <span className="muted">{t('projects.adopt.noReference')}</span>
  }

  return (
    <Modal
      title={t('projects.adopt.title', { name })}
      onClose={actions.closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={actions.closeModal}>
            {t('common.close')}
          </Button>
          {actionable && (
            <Button variant="primary" icon="monitor" disabled={submitting} onClick={submit}>
              {t('projects.adopt.confirm')}
            </Button>
          )}
        </>
      }
    >
      {rows === null && !error && <p className="muted">{t('projects.discover.scanning')}</p>}

      {rows !== null && !actionable && <p className="muted">{t('projects.adopt.empty')}</p>}

      {rows !== null && actionable && (
        <div className="stack">
          <ul className="folder-list">
            {rows.map((r) => (
              <li key={r.slot} className="row row-nowrap">
                <input
                  type="checkbox"
                  checked={r.include}
                  disabled={r.alreadyConfigured}
                  aria-label={t('projects.discover.include')}
                  onChange={(e) => setRow(r.slot, { include: e.target.checked })}
                />
                <Icon name={r.kind === 'file' ? 'file-diff' : 'folder'} size={16} />
                <span className="mono folder-slot">{r.slot}</span>
                <input
                  className="input input--mono grow"
                  disabled={r.alreadyConfigured}
                  placeholder={t(
                    r.kind === 'file'
                      ? 'projects.filePathPlaceholder'
                      : 'projects.folderPathPlaceholder',
                  )}
                  value={r.path}
                  onChange={(e) => {
                    setRow(r.slot, { path: e.target.value })
                    setError(null)
                  }}
                />
                {!r.alreadyConfigured && (
                  <Button
                    size="sm"
                    icon={r.kind === 'file' ? 'file-plus' : 'folder-open'}
                    disabled={submitting}
                    onClick={() => pickFor(r.slot, r.kind)}
                  >
                    {t(r.kind === 'file' ? 'projects.chooseFile' : 'projects.chooseFolder')}
                  </Button>
                )}
                {statusBadge(r)}
              </li>
            ))}
          </ul>
          {error && <div className="field__error">{error}</div>}
        </div>
      )}

      {error && rows === null && <div className="field__error">{error}</div>}
    </Modal>
  )
}
