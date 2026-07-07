import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StatusDot } from '../components/Badge'
import { Button } from '../components/Button'
import { SegmentedControl } from '../components/SegmentedControl'
import { MachinesCard } from '../features/machines/MachinesCard'
import { AutoToggle } from '../features/sync/AutoToggle'
import type { Locale } from '../i18n'
import { api } from '../state/api'
import { useAppState } from '../state/store'
import { useActions } from '../state/useActions'
import { ViewHeader } from './ViewHeader'

export function Settings(): JSX.Element {
  const { t, i18n } = useTranslation()
  const { config, preflight, busy, version, syncEngine } = useAppState()
  const actions = useActions()
  const intervalValue = String(syncEngine?.intervalMs ?? 120_000)
  const [remote, setRemote] = useState('')

  const connect = (): Promise<void> =>
    actions.run(async () => {
      const r = await api.repoConnect(remote.trim())
      return r.initialized ? t('settings.repoConnectedCreated') : t('settings.repoConnected')
    })

  return (
    <div className="view">
      <ViewHeader eyebrow={t('settings.eyebrow')} title={t('settings.title')} sub={t('settings.sub')} />

      <div className="card">
        <div className="card__head">
          <span className="card__title">{t('settings.language')}</span>
        </div>
        <div className="row">
          <SegmentedControl<Locale>
            ariaLabel={t('settings.languageAria')}
            value={(i18n.resolvedLanguage as Locale) ?? 'en'}
            onChange={(lng) => void i18n.changeLanguage(lng)}
            options={[
              { value: 'en', label: 'English' },
              { value: 'es', label: 'Español' },
            ]}
          />
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <span className="card__title">{t('settings.requirements')}</span>
        </div>
        <p className="muted">{t('settings.requirementsSub')}</p>
        <ul className="check-list">
          {(preflight?.checks ?? []).map((c) => (
            <li key={c.name} className="check-row">
              <StatusDot tone={c.ok ? 'ok' : 'danger'} />
              <div className="grow">
                <div className="cluster">
                  <b className="mono">{c.name}</b>
                  {c.detail && (
                    <span className="muted">
                      {c.detailKey ? t(`preflight.${c.detailKey}`, { ...c.params, defaultValue: c.detail }) : c.detail}
                    </span>
                  )}
                </div>
                {!c.ok && c.fix && (
                  <div className="muted mono check-fix">
                    → {c.fixKey ? t(`preflight.${c.fixKey}`, { ...c.params, defaultValue: c.fix }) : c.fix}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="row">
          <Button icon="sync" disabled={busy} onClick={() => void actions.refresh()}>
            {t('settings.recheck')}
          </Button>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <span className="card__title">{t('settings.repo')}</span>
        </div>
        <p className="muted">{t('settings.repoSub')}</p>
        {config ? (
          <p className="mono muted truncate">{config.repo.remote}</p>
        ) : (
          <div className="row row-nowrap">
            <input
              className="input input--mono grow"
              placeholder={t('settings.remotePlaceholder')}
              value={remote}
              onChange={(e) => setRemote(e.target.value)}
            />
            <Button variant="primary" icon="git-branch" disabled={busy || !remote.trim()} onClick={connect}>
              {t('common.connect')}
            </Button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card__head">
          <span className="card__title">{t('settings.autoSync')}</span>
        </div>
        <p className="muted">{t('settings.autoSyncSub')}</p>
        <div className="row between">
          <AutoToggle />
          <div className="stack stack-1">
            <span className="label">{t('settings.remoteCheck')}</span>
            <SegmentedControl<string>
              ariaLabel={t('settings.remoteCheckFreq')}
              value={intervalValue}
              onChange={(ms) => void actions.setSyncInterval(Number(ms))}
              options={[
                { value: '30000', label: t('interval.30s') },
                { value: '60000', label: t('interval.1m') },
                { value: '120000', label: t('interval.2m') },
                { value: '300000', label: t('interval.5m') },
              ]}
            />
          </div>
        </div>
      </div>

      <MachinesCard />

      <div className="card">
        <div className="card__head">
          <span className="card__title">{t('settings.about')}</span>
        </div>
        <p className="muted">{t('settings.aboutText', { version: version ?? '—' })}</p>
      </div>
    </div>
  )
}
