import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DiscoveredSlot, DiscoveryProposal, SlotKind } from '../../../core/discovery'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import { api, normalizeError } from '../../state/api'
import { useActions } from '../../state/useActions'
import { validateName } from './names'

interface Row {
  item: string
  slot: string
  path: string
  kind: SlotKind
  include: boolean
  collision?: { with: string; where: string }
}

type Phase = 'scanning' | 'review' | 'empty'

function toRows(slots: DiscoveredSlot[]): Row[] {
  return slots.map((s) => ({
    item: s.item,
    slot: s.slot,
    path: s.path,
    kind: s.kind,
    include: s.include,
    collision: s.collision,
  }))
}

/**
 * Flow A: pick a folder, auto-discover its Claude-memory sources, review the
 * proposal (rename project/slots, toggle include), and create the project in one
 * commit. Opens the native folder picker on mount; cancelling closes the modal.
 */
export function ProjectDiscoverModal(): JSX.Element {
  const { t } = useTranslation()
  const actions = useActions()
  const started = useRef(false)
  const [phase, setPhase] = useState<Phase>('scanning')
  const [projectName, setProjectName] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const pick = async (): Promise<void> => {
    const dir = await api.projectPickFolder()
    if (!dir) {
      actions.closeModal()
      return
    }
    setPhase('scanning')
    setError(null)
    try {
      const proposal: DiscoveryProposal = await api.projectDiscover(dir)
      setProjectName(proposal.projectName)
      setRows(toRows(proposal.slots))
      setPhase(proposal.slots.length === 0 ? 'empty' : 'review')
    } catch (e) {
      setError(normalizeError(e))
      setPhase('empty')
    }
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    void pick()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setRow = (item: string, patch: Partial<Row>): void =>
    setRows((rs) => rs.map((r) => (r.item === item ? { ...r, ...patch } : r)))

  const createEmpty = (): void => {
    actions.closeModal()
    actions.openModal({ kind: 'project-create' })
  }

  const submit = async (): Promise<void> => {
    const name = projectName.trim()
    const nameErr = validateName('project', name, t)
    if (nameErr) {
      setError(nameErr)
      return
    }
    const chosen = rows.filter((r) => r.include)
    if (chosen.length === 0) {
      setError(t('projects.discover.selectOne'))
      return
    }
    for (const r of chosen) {
      const slotErr = validateName('slot', r.slot.trim(), t)
      if (slotErr) {
        setError(slotErr)
        return
      }
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await api.projectApplyDiscovery({
        projectName: name,
        slots: chosen.map((r) => ({ slot: r.slot.trim(), path: r.path, kind: r.kind })),
      })
      await actions.refresh()
      actions.notify(t('projects.discover.done', { name, count: res.slots }), 'ok')
      actions.closeModal()
    } catch (e) {
      setError(normalizeError(e))
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={t('projects.discover.title')}
      onClose={actions.closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={actions.closeModal}>
            {t('common.cancel')}
          </Button>
          {phase === 'review' && (
            <Button
              variant="primary"
              icon="plus"
              disabled={submitting || !projectName.trim()}
              onClick={submit}
            >
              {t('projects.discover.confirm')}
            </Button>
          )}
        </>
      }
    >
      {phase === 'scanning' && <p className="muted">{t('projects.discover.scanning')}</p>}

      {phase === 'empty' && (
        <div className="stack">
          <p className="muted">{error ?? t('projects.discover.nothingFound')}</p>
          <div className="row">
            <Button size="sm" icon="folder-open" onClick={pick}>
              {t('projects.discover.rechoose')}
            </Button>
            <Button size="sm" variant="ghost" onClick={createEmpty}>
              {t('projects.discover.createEmpty')}
            </Button>
          </div>
        </div>
      )}

      {phase === 'review' && (
        <div className="stack">
          <div className="stack stack-1">
            <span className="label">{t('projects.discover.projectName')}</span>
            <input
              className="input input--mono"
              autoFocus
              value={projectName}
              onChange={(e) => {
                setProjectName(e.target.value)
                setError(null)
              }}
            />
          </div>

          <div className="stack stack-1">
            <span className="label">{t('projects.discover.sourcesFound')}</span>
            <ul className="folder-list">
              {rows.map((r) => (
                <li key={r.item} className="row row-nowrap">
                  <input
                    type="checkbox"
                    checked={r.include}
                    disabled={!!r.collision}
                    aria-label={t('projects.discover.include')}
                    onChange={(e) => setRow(r.item, { include: e.target.checked })}
                  />
                  <Icon name={r.kind === 'file' ? 'file-diff' : 'folder'} size={16} />
                  <input
                    className="input input--mono folder-editor__slot"
                    aria-label={t('projects.slotLabel')}
                    value={r.slot}
                    onChange={(e) => {
                      setRow(r.item, { slot: e.target.value })
                      setError(null)
                    }}
                  />
                  <span className="mono muted grow ellipsis">{r.path}</span>
                  {r.collision && (
                    <Badge>{t('projects.discover.collides', { where: r.collision.where })}</Badge>
                  )}
                </li>
              ))}
            </ul>
            <Button size="sm" variant="ghost" icon="folder-open" onClick={pick}>
              {t('projects.discover.rechoose')}
            </Button>
          </div>

          {error && <div className="field__error">{error}</div>}
        </div>
      )}
    </Modal>
  )
}
