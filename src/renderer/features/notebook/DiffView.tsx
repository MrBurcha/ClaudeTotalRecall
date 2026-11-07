import { useTranslation } from 'react-i18next'
import type { DiffLine, NotebookDiff } from '../../../core/types'

const SIGN: Record<DiffLine['kind'], string> = { add: '+', del: '−', ctx: '', note: '' }

/**
 * A unified diff (past version → current note) as git computed it: one row per
 * line with old/new line numbers, removed lines in red and added lines in green.
 */
export function DiffView({ diff }: { diff: NotebookDiff }): JSX.Element {
  const { t } = useTranslation()
  if (diff.binary) {
    return <p className="muted note-detail__note">{t('notebook.history.diffBinary')}</p>
  }
  if (diff.identical) {
    return <p className="muted note-detail__note">{t('notebook.history.identical')}</p>
  }
  return (
    <div className="nb-diff">
      <div className="nb-diff__legend">
        <span className="nb-diff__key nb-diff__key--del">− {t('notebook.history.legendOld')}</span>
        <span className="nb-diff__key nb-diff__key--add">+ {t('notebook.history.legendNew')}</span>
      </div>
      <div className="nb-diff__body mono">
        {diff.hunks.map((h, i) => (
          <div key={i} className="nb-diff__hunk">
            <div className="nb-diff__header">{h.header}</div>
            {h.lines.map((l, j) => (
              <div key={j} className={`nb-diff__line nb-diff__line--${l.kind}`}>
                <span className="nb-diff__no" aria-hidden="true">
                  {l.oldNo ?? ''}
                </span>
                <span className="nb-diff__no" aria-hidden="true">
                  {l.newNo ?? ''}
                </span>
                <span className="nb-diff__sign" aria-hidden="true">
                  {SIGN[l.kind]}
                </span>
                <span className="nb-diff__text">{l.text}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {diff.truncated && (
        <p className="muted note-detail__note">{t('notebook.history.diffTruncated')}</p>
      )}
    </div>
  )
}
