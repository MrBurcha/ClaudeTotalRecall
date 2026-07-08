import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import { StatusDot } from '../../components/Badge'
import { Icon } from '../../components/Icon'
import { Kbd } from '../../components/Kbd'
import { canSync } from '../../state/selectors'
import { useAppState } from '../../state/store'
import { useActions } from '../../state/useActions'
import { ConflictResolver } from '../conflicts/ConflictResolver'

/** Console key to force a direction by hand (with a Plan preview). */
function SyncKey({
  verb,
  hint,
  shortcut,
  disabled,
  onClick,
}: {
  verb: 'outgoing' | 'incoming'
  hint: string
  shortcut: string
  disabled: boolean
  onClick: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const outgoing = verb === 'outgoing'
  return (
    <button className="sync-key" disabled={disabled} onClick={onClick}>
      <span className="sync-key__icon">
        <Icon name={outgoing ? 'arrow-up' : 'arrow-down'} size={22} />
      </span>
      <span className="sync-key__text">
        <span className="sync-key__title">
          {outgoing ? t('sync.outgoing') : t('sync.incoming')}
        </span>
        <span className="sync-key__sub">{hint}</span>
      </span>
      <Kbd>{shortcut}</Kbd>
    </button>
  )
}

/**
 * Collapsible "Advanced" panel inside Sync: what used to be the whole view
 * (outgoing/incoming with Plan review + conflict resolution). It auto-expands on a
 * conflict; the red CTA scrolls here.
 */
export const AdvancedSync = forwardRef<
  HTMLElement,
  { open: boolean; onToggle: () => void; files: string[] }
>(function AdvancedSync({ open, onToggle, files }, ref) {
  const { t } = useTranslation()
  const state = useAppState()
  const actions = useActions()
  const { status, busy } = state
  const blocked = !canSync(state) || busy || files.length > 0

  return (
    <section className="advanced" ref={ref}>
      <button className="advanced__head" aria-expanded={open} onClick={onToggle}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} />
        <span className="grow">
          <span className="advanced__title">{t('sync.advanced')}</span>
          <span className="muted"> — {t('sync.advancedSub')}</span>
        </span>
      </button>

      {open && (
        <div className="advanced__body stack">
          {files.length > 0 && <ConflictResolver files={files} />}

          <div className="telemetry">
            <div className="telem">
              <span className="telem__label">{t('sync.branch')}</span>
              <span className="telem__value">
                <Icon name="git-branch" size={14} />
                {status?.branch ?? '—'}
              </span>
            </div>
            <div className="telem">
              <span className="telem__label">{t('sync.toPush')}</span>
              <span className="telem__value nums">
                <Icon name="arrow-up" size={14} />
                {status?.ahead ?? 0}
              </span>
            </div>
            <div className="telem">
              <span className="telem__label">{t('sync.toPull')}</span>
              <span className="telem__value nums">
                <Icon name="arrow-down" size={14} />
                {status?.behind ?? 0}
              </span>
            </div>
            <div className="telem">
              <span className="telem__label">{t('sync.state')}</span>
              <span className="telem__value">
                <StatusDot tone={status ? (status.dirty ? 'warn' : 'ok') : 'muted'} />
                {status ? (status.dirty ? t('sync.dirty') : t('sync.clean')) : '—'}
              </span>
            </div>
            <div className="telem">
              <span className="telem__label">{t('sync.secrets')}</span>
              <span className="telem__value">
                <Icon name="lock" size={14} />
                {t('sync.excluded')}
              </span>
            </div>
          </div>

          <div className="sync-keys">
            <SyncKey
              verb="outgoing"
              shortcut="⌘G"
              hint={
                status && status.ahead > 0
                  ? t('sync.hintOutgoingCount', { count: status.ahead })
                  : t('sync.hintOutgoing')
              }
              disabled={blocked}
              onClick={() => void actions.openPlan('outgoing')}
            />
            <SyncKey
              verb="incoming"
              shortcut="⌘S"
              hint={
                status && status.behind > 0
                  ? t('sync.hintIncomingCount', { count: status.behind })
                  : t('sync.hintIncoming')
              }
              disabled={blocked}
              onClick={() => void actions.openPlan('incoming')}
            />
          </div>
        </div>
      )}
    </section>
  )
})
