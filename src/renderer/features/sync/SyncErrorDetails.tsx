import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { api } from '../../state/api'

/**
 * The raw text of the engine's last failure, one click away and copyable — so a
 * user can see (and paste into a bug report) what actually broke, without DevTools
 * (#132). Collapsed by default: the sync bar's summary line is the headline.
 */
export function SyncErrorDetails({ error }: { error: string }): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const copy = async (): Promise<void> => {
    try {
      await api.clipboardWrite(error)
      setCopied(true)
    } catch {
      /* clipboard denied — non-fatal, the text is still selectable */
    }
  }

  return (
    <div className="sync-error">
      <div className="row between">
        <Button
          variant="ghost"
          size="sm"
          icon={open ? 'chevron-down' : 'chevron-right'}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? t('home.errorDetails.hide') : t('home.errorDetails.show')}
        </Button>
        {open && (
          <Button variant="ghost" size="sm" icon="copy" onClick={() => void copy()}>
            {copied ? t('home.errorDetails.copied') : t('home.errorDetails.copy')}
          </Button>
        )}
      </div>
      {open && <pre className="sync-error__text mono">{error}</pre>}
    </div>
  )
}
