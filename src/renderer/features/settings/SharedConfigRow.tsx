import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SharedConfigInfo } from '../../../core/service'
import { Button } from '../../components/Button'
import { api } from '../../state/api'
import { useAppState } from '../../state/store'
import { useActions } from '../../state/useActions'

/**
 * The shared config file of the memories repo, and — while it still has its
 * pre-rename name — the explicit, once-per-fleet rename to engram.json (#123). This
 * is the one action of the rename that can break OTHER machines (older versions only
 * read claudetr.json), so the confirmation names every machine that must be updated.
 */
export function SharedConfigRow(): JSX.Element | null {
  const { t } = useTranslation()
  const { config, busy } = useAppState()
  const actions = useActions()
  const [info, setInfo] = useState<SharedConfigInfo | null>(null)

  useEffect(() => {
    if (!config) return
    let alive = true
    api
      .sharedConfigInfo()
      .then((i) => alive && setInfo(i))
      .catch(() => alive && setInfo(null))
    return () => {
      alive = false
    }
  }, [config])

  if (!config || !info) return null

  const migrate = async (): Promise<void> => {
    const ok = await actions.confirm({
      title: t('settings.sharedConfig.confirmTitle'),
      body: t('settings.sharedConfig.confirmBody', { machines: info.machines.join(', ') }),
      confirmLabel: t('settings.sharedConfig.confirm'),
      danger: true,
    })
    if (!ok) return
    await actions.run(async () => {
      const r = await api.migrateSharedConfig()
      setInfo(await api.sharedConfigInfo())
      return r.migrated ? t('settings.sharedConfig.done') : t('settings.sharedConfig.already')
    })
  }

  return (
    <div className="stack stack-1">
      <div className="row between">
        <span className="muted">
          {t('settings.sharedConfig.label')} <span className="mono">{info.file}</span>
        </span>
        {info.file === 'claudetr.json' && (
          <Button size="sm" icon="git-branch" disabled={busy} onClick={() => void migrate()}>
            {t('settings.sharedConfig.migrate')}
          </Button>
        )}
      </div>
      {info.file === 'claudetr.json' && (
        <p className="muted small">{t('settings.sharedConfig.legacyHint')}</p>
      )}
    </div>
  )
}
