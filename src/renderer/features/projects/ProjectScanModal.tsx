import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ScannedProject } from '../../../core/discovery'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import { api, normalizeError } from '../../state/api'
import { useActions } from '../../state/useActions'
import { validateName } from './names'

type SlotWrite = { slot: string; path: string; kind: 'file' | 'dir' }
type Category = 'ready' | 'activate' | 'synced'

interface Row {
  slug: string
  name: string
  include: boolean
  category: Category
  existsInConfig: boolean
  slots: SlotWrite[]
}

function toRow(p: ScannedProject): Row {
  const category: Category = p.alreadySyncedHere ? 'synced' : p.hasMemory ? 'ready' : 'activate'
  const slots: SlotWrite[] =
    category === 'activate'
      ? [{ slot: 'memory', path: p.memoryPath, kind: 'dir' }]
      : p.proposal.slots
          .filter((s) => s.include)
          .map((s) => ({ slot: s.slot, path: s.path, kind: s.kind }))
  return {
    slug: p.slug,
    // Synced rows show the canonical project name; the raw Claude slug stays in `slug`.
    name: p.syncedAs ?? p.suggestedName,
    include: category === 'ready',
    category,
    existsInConfig: p.existsInConfig,
    slots,
  }
}

/**
 * Flow C: bulk-scan ~/.claude/projects and create/adopt projects from a checklist.
 * Projects that already have memory are pre-checked ("ready"); those without get an
 * "activate" option that creates the memory/ folder on apply; ones already synced
 * here are shown disabled. Applies every checked project in one commit.
 */
export function ProjectScanModal(): JSX.Element {
  const { t } = useTranslation()
  const actions = useActions()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const scanned = await api.projectScan()
        if (alive) setRows(scanned.map(toRow))
      } catch (e) {
        if (alive) setError(normalizeError(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const setRow = (slug: string, patch: Partial<Row>): void =>
    setRows((rs) => (rs ? rs.map((r) => (r.slug === slug ? { ...r, ...patch } : r)) : rs))

  const goDiscover = (): void => {
    actions.closeModal()
    actions.openModal({ kind: 'project-discover' })
  }
  const goCreate = (): void => {
    actions.closeModal()
    actions.openModal({ kind: 'project-create' })
  }

  const submit = async (): Promise<void> => {
    if (!rows) return
    const chosen = rows.filter((r) => r.include && r.category !== 'synced')
    if (chosen.length === 0) {
      setError(t('projects.scan.selectOne'))
      return
    }
    const seen = new Set<string>()
    for (const r of chosen) {
      const name = r.name.trim()
      const nameErr = validateName('project', name, t)
      if (nameErr) {
        setError(nameErr)
        return
      }
      if (seen.has(name)) {
        setError(t('projects.scan.dupeName', { name }))
        return
      }
      seen.add(name)
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await api.projectApplyScan(
        chosen.map((r) => ({ projectName: r.name.trim(), slots: r.slots })),
      )
      await actions.refresh()
      actions.notify(t('projects.scan.created', { count: res.created }), 'ok')
      actions.closeModal()
    } catch (e) {
      setError(normalizeError(e))
      setSubmitting(false)
    }
  }

  const actionableCount = rows?.filter((r) => r.category !== 'synced').length ?? 0

  const renderRow = (r: Row): JSX.Element => (
    <li key={r.slug} className="row row-nowrap">
      <input
        type="checkbox"
        checked={r.include}
        disabled={r.category === 'synced'}
        aria-label={t('projects.scan.include')}
        onChange={(e) => setRow(r.slug, { include: e.target.checked })}
      />
      <Icon name="folder" size={16} />
      <input
        className="input input--mono folder-editor__slot"
        aria-label={t('projects.scan.nameLabel')}
        value={r.name}
        disabled={r.category === 'synced'}
        onChange={(e) => {
          setRow(r.slug, { name: e.target.value })
          setError(null)
        }}
      />
      <span className="mono muted grow ellipsis">{r.slug}</span>
      {r.category === 'synced' && <Badge muted>{t('projects.scan.alreadySynced')}</Badge>}
      {r.category === 'activate' && <Badge>{t('projects.scan.willActivate')}</Badge>}
      {r.existsInConfig && r.category !== 'synced' && (
        <Badge muted>{t('projects.scan.existsInConfig')}</Badge>
      )}
    </li>
  )

  const section = (cat: Category, label: string, hint?: string): JSX.Element | null => {
    const items = rows?.filter((r) => r.category === cat) ?? []
    if (items.length === 0) return null
    return (
      <div className="stack stack-1">
        <span className="label">{label}</span>
        {hint && <span className="muted">{hint}</span>}
        <ul className="folder-list">{items.map(renderRow)}</ul>
      </div>
    )
  }

  return (
    <Modal
      title={t('projects.scan.title')}
      onClose={actions.closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={actions.closeModal}>
            {t('common.cancel')}
          </Button>
          {actionableCount > 0 && (
            <Button variant="primary" icon="plus" disabled={submitting} onClick={submit}>
              {t('projects.scan.create')}
            </Button>
          )}
        </>
      }
    >
      {rows === null && !error && <p className="muted">{t('projects.scan.scanning')}</p>}

      {rows !== null && rows.length === 0 && (
        <div className="stack">
          <p className="muted">{t('projects.scan.none')}</p>
          <div className="row">
            <Button size="sm" icon="folder-open" onClick={goDiscover}>
              {t('projects.scan.pickInstead')}
            </Button>
            <Button size="sm" variant="ghost" icon="plus" onClick={goCreate}>
              {t('projects.scan.createEmptyInstead')}
            </Button>
          </div>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="stack">
          {section('ready', t('projects.scan.ready'))}
          {section('activate', t('projects.scan.activate'), t('projects.scan.activateHint'))}
          {section('synced', t('projects.scan.synced'))}
          {error && <div className="field__error">{error}</div>}
        </div>
      )}

      {error && rows === null && <div className="field__error">{error}</div>}
    </Modal>
  )
}
