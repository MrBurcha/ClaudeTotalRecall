import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  MachineMappingProposal,
  RemapSlot,
  ScannedProject,
  SlotKind,
} from '../../../core/discovery'
import { scoreNameMatch } from '../../../core/nameMatch'
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
  claudeManaged: boolean
  /** A pending "redirected your pick to <leaf>/" suggestion, with the raw pick to undo to. */
  notice?: { leaf: string; original: string }
}

function toRows(slots: RemapSlot[]): Row[] {
  return slots.map((s) => ({
    slot: s.slot,
    kind: s.kind,
    // Claude names its per-machine dirs unpredictably, so the remapped path is a
    // phantom: leave it empty and unchecked, and let the user pick the local dir.
    path: s.claudeManaged ? '' : (s.proposedPath ?? ''),
    include:
      !s.alreadyConfigured && !s.claudeManaged && (s.status === 'ok' || s.status === 'missing'),
    status: s.status,
    exists: s.exists,
    alreadyConfigured: s.alreadyConfigured,
    claudeManaged: s.claudeManaged,
  }))
}

interface Candidate {
  path: string
  label: string
  score: number
}

/** Ranked local ~/.claude/projects dirs that expose a slot named `slotName`. */
function candidatesForSlot(
  scanned: ScannedProject[],
  projectName: string,
  slotName: string,
): Candidate[] {
  const out: Candidate[] = []
  for (const p of scanned) {
    const slot = p.proposal.slots.find((s) => s.slot === slotName)
    if (!slot) continue
    // Score against both the decoded name and the raw slug (which embeds the cwd),
    // taking the best — the slug usually contains the real project name.
    const score = Math.max(
      scoreNameMatch(projectName, p.suggestedName),
      scoreNameMatch(projectName, p.slug),
    )
    out.push({ path: slot.path, label: p.slug, score })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3)
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
  const [scanned, setScanned] = useState<ScannedProject[]>([])
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
    // Local Claude dirs, for ranked candidate suggestions on claudeManaged slots.
    void api
      .projectScan()
      .then((s) => alive && setScanned(s))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [name])

  const setRow = (slot: string, patch: Partial<Row>): void =>
    setRows((rs) => (rs ? rs.map((r) => (r.slot === slot ? { ...r, ...patch } : r)) : rs))

  const pickFor = async (slot: string, kind: SlotKind): Promise<void> => {
    const chosen = kind === 'file' ? await api.pickFile() : await api.projectPickFolder()
    if (!chosen) return
    setError(null)
    if (kind === 'file') {
      setRow(slot, { path: chosen, include: true, notice: undefined })
      return
    }
    // Redirect a picked project root to its <slot> child so it maps flat, not nested.
    try {
      const c = await api.projectSuggestFolderCorrection(name, slot, chosen, kind)
      setRow(slot, {
        path: c.path,
        include: true,
        notice: c.redirected ? { leaf: c.expectedLeaf, original: chosen } : undefined,
      })
    } catch {
      setRow(slot, { path: chosen, include: true, notice: undefined })
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
      // Adopting means the project is already on another machine; if any adopted
      // source carries a MEMORY.md, the index may need reconciling — offer the pass.
      const showMemoryHelp = (
        await Promise.all(
          chosen.map((r) =>
            api.projectFolderHasMemoryIndex(r.path.trim(), r.kind).catch(() => false),
          ),
        )
      ).some(Boolean)
      await actions.refresh()
      actions.notify(t('projects.adopt.done', { count: res.slots }), 'ok')
      actions.closeModal()
      if (showMemoryHelp) actions.openModal({ kind: 'memory-maintenance' })
    } catch (e) {
      setError(normalizeError(e))
      setSubmitting(false)
    }
  }

  const statusBadge = (r: Row): JSX.Element | null => {
    if (r.alreadyConfigured) return <Badge muted>{t('projects.adopt.already')}</Badge>
    if (r.claudeManaged) return <Badge muted>{t('projects.adopt.pickLocal')}</Badge>
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
            {rows.map((r) => {
              const candidates = r.claudeManaged ? candidatesForSlot(scanned, name, r.slot) : []
              const nt = r.notice
              return (
                <li key={r.slot} className="stack stack-1">
                  <div className="row row-nowrap">
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
                        setRow(r.slot, { path: e.target.value, notice: undefined })
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
                  </div>
                  {nt && (
                    <div className="folder-editor__notice field__hint field__hint--accent">
                      <span>{t('projects.folderRedirect.adjusted', { leaf: nt.leaf })}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={submitting}
                        onClick={() => setRow(r.slot, { path: nt.original, notice: undefined })}
                      >
                        {t('projects.folderRedirect.revert')}
                      </Button>
                    </div>
                  )}
                  {r.claudeManaged && candidates.length > 0 && (
                    <div className="stack stack-1">
                      <span className="muted">{t('projects.adopt.candidates')}</span>
                      {candidates.map((c) => (
                        <Button
                          key={c.path}
                          size="sm"
                          variant="ghost"
                          icon="folder"
                          disabled={submitting}
                          onClick={() => {
                            setRow(r.slot, { path: c.path, include: true, notice: undefined })
                            setError(null)
                          }}
                        >
                          <span className="mono ellipsis">{c.label}</span>
                        </Button>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {error && <div className="field__error">{error}</div>}
        </div>
      )}

      {error && rows === null && <div className="field__error">{error}</div>}
    </Modal>
  )
}
