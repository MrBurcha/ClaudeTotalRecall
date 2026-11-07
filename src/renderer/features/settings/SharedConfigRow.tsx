import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SharedConfigInfo } from '../../../core/service'
import { Button } from '../../components/Button'
import { api } from '../../state/api'
import { useAppState } from '../../state/store'
import { useActions } from '../../state/useActions'

/**
 * Status of the automatic shared-config rename (#123). Nothing to do here in the
 * normal case: every machine running Engram marks itself and the last one renames
 * claudetr.json → engram.json on its own. This row only says who it's still waiting
 * for — and offers a forced rename for the rare case where waiting isn't an option.
 * Once renamed, it's not shown at all.
 */
export function SharedConfigRow(): JSX.Element | null {
  const { t } = useTranslation()
  const { config, busy, syncEngine } = useAppState()
  const actions = useActions()
  const [info, setInfo] = useState<SharedConfigInfo | null>(null)
  const lastSyncedAt = syncEngine?.lastSyncedAt

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
    // Re-read after every sync: that's when this machine marks itself / the rename lands.
  }, [config, lastSyncedAt])

  if (!config || !info || info.file !== 'claudetr.json') return null

  const forceNow = async (): Promise<void> => {
    const ok = await actions.confirm({
      title: t('settings.sharedConfig.forceTitle'),
      body: t('settings.sharedConfig.forceBody', { machines: info.waiting.join(', ') }),
      confirmLabel: t('settings.sharedConfig.forceConfirm'),
      danger: true,
    })
    if (!ok) return
    await actions.run(async () => {
      await api.migrateSharedConfig()
      setInfo(await api.sharedConfigInfo())
      return t('settings.sharedConfig.done')
    })
  }

  return (
    <div className="stack stack-1">
      <span className="muted">{t('settings.sharedConfig.switching')}</span>
      {info.waiting.length > 0 && (
        <>
          <span className="muted small">
            {t('settings.sharedConfig.waitingFor', { machines: info.waiting.join(', ') })}
          </span>
          <span className="muted small">{t('settings.sharedConfig.goneHint')}</span>
          <div className="row">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void forceNow()}>
              {t('settings.sharedConfig.forceButton')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
