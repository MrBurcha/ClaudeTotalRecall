import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, Pill } from '../../components/Badge'
import { EmptyState } from '../../components/EmptyState'
import { Icon } from '../../components/Icon'
import { IconButton } from '../../components/IconButton'
import { useAppState } from '../../state/store'
import { useActions } from '../../state/useActions'
import {
  buildOverview,
  filterOverview,
  overviewStats,
  type OverviewEntry,
  type OverviewSection,
} from './overview'

function EntryRow({
  section,
  entry,
  onOpenProject,
}: {
  section: OverviewSection
  entry: OverviewEntry
  onOpenProject: (name: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const { machineId } = useAppState()
  const actions = useActions()

  return (
    <li className="folder-row">
      <div className="folder-row__main">
        <Icon name={entry.kind === 'file' ? 'file-text' : 'folder'} size={14} />
        <span className="folder-slot mono">{entry.name}</span>
        <Badge muted>{entry.kind === 'file' ? t('projects.file') : t('projects.folder')}</Badge>
        <span className="mono muted grow truncate" title={entry.key}>
          {entry.key}
        </span>
        {entry.missing > 0 && (
          <Badge>
            <Icon name="alert" size={12} />
            {t('projects.overview.missingOn', { count: entry.missing })}
          </Badge>
        )}
        {entry.differs && (
          <span title={t('projects.overview.differsHint')}>
            <Badge muted>{t('projects.overview.differs')}</Badge>
          </span>
        )}
        {section.kind === 'pinned' && (
          <IconButton
            icon="arrow-right"
            label={t('projects.overview.editPinned')}
            onClick={() => actions.navigate('pinned', entry.key)}
          />
        )}
        {section.kind === 'project' && section.project && (
          <IconButton
            icon="arrow-right"
            label={t('projects.overview.editProject')}
            onClick={() => onOpenProject(section.project ?? '')}
          />
        )}
      </div>
      <div className="overview-paths">
        {entry.sharedPath ? (
          <div className="overview-path">
            <span className="overview-path__machine">{t('projects.overview.allMachines')}</span>
            <span className="overview-path__value mono truncate">{entry.sharedPath}</span>
          </div>
        ) : (
          entry.cells.map((c) => (
            <div key={c.machineId} className={`overview-path overview-path--${c.status}`}>
              <span className="overview-path__machine mono">
                {c.machineId}
                {c.machineId === machineId && <Badge>{t('machines.thisMachine')}</Badge>}
              </span>
              {c.path ? (
                <span className="overview-path__value mono truncate" title={c.path}>
                  {c.path}
                </span>
              ) : (
                <span className="overview-path__value folder-row__missing">
                  <Icon name="alert" size={13} />
                  {t('projects.overview.notMapped')}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </li>
  )
}

function SectionCard({
  section,
  onOpenProject,
}: {
  section: OverviewSection
  onOpenProject: (name: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const actions = useActions()
  const { kind, project } = section

  return (
    <div className="card">
      <div className="card__head">
        <span className="card__title cluster">
          <Icon
            name={kind === 'user' ? 'monitor' : kind === 'pinned' ? 'pin' : 'folder'}
            size={16}
          />
          {kind === 'user'
            ? t('projects.overview.userLevel')
            : kind === 'pinned'
              ? t('projects.overview.pinned')
              : project}
        </span>
        {kind === 'pinned' && (
          <button type="button" className="link-accent" onClick={() => actions.navigate('pinned')}>
            {t('projects.overview.openPinned')}
          </button>
        )}
        {kind === 'project' && project && (
          <button type="button" className="link-accent" onClick={() => onOpenProject(project)}>
            {t('projects.overview.editProject')}
          </button>
        )}
      </div>
      {kind === 'user' && <p className="muted">{t('projects.overview.userLevelHint')}</p>}
      {section.entries.length === 0 ? (
        <p className="muted">
          {kind === 'pinned' ? t('projects.overview.noPinned') : t('projects.overview.noSources')}
        </p>
      ) : (
        <ul className="folder-list">
          {section.entries.map((e) => (
            <EntryRow key={e.key} section={section} entry={e} onOpenProject={onOpenProject} />
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Projects → "All paths" (#114): a read-only, consolidated view of what is
 * CONFIGURED to sync — user-level items, General pinned files and every project's
 * slots — with each machine's path, gaps and per-machine differences highlighted.
 * Rows link to where they're edited (the project in "By project", or Pinned files).
 */
export function ProjectsOverview({
  onOpenProject,
}: {
  onOpenProject: (name: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const { config, machineId } = useAppState()
  const [query, setQuery] = useState('')
  const all = useMemo(() => (config ? buildOverview(config, machineId) : []), [config, machineId])
  const sections = useMemo(() => filterOverview(all, query), [all, query])
  const stats = overviewStats(sections)

  return (
    <div className="stack stack-4">
      <div className="row">
        <label className="overview-filter grow">
          <Icon name="search" size={15} />
          <input
            className="input"
            type="search"
            aria-label={t('projects.overview.filterAria')}
            placeholder={t('projects.overview.filterPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
        </label>
        <div className="cluster">
          <Pill>{t('projects.overview.entries', { count: stats.entries })}</Pill>
          {stats.withGaps > 0 && (
            <Pill>
              <Icon name="alert" size={13} />
              {t('projects.overview.withGaps', { count: stats.withGaps })}
            </Pill>
          )}
          {stats.withDiffs > 0 && (
            <Pill>{t('projects.overview.withDiffs', { count: stats.withDiffs })}</Pill>
          )}
        </div>
      </div>

      {sections.length === 0 ? (
        <div className="card">
          <EmptyState icon="search" title={t('projects.overview.noMatches', { query })}>
            {t('projects.overview.noMatchesHint')}
          </EmptyState>
        </div>
      ) : (
        sections.map((s) => <SectionCard key={s.id} section={s} onOpenProject={onOpenProject} />)
      )}
    </div>
  )
}
