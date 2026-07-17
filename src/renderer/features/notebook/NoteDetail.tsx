import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { TextArea } from '../../components/Field'
import { Icon } from '../../components/Icon'
import type { NotebookFile } from '../../../core/types'
import { detectPreviewKind } from '../preview/previewFormat'
import { JsonView, MarkdownView, PropertiesView, TextView } from '../preview/renderers'

/** Picks the read-only renderer for a note by its file name (same rules as #43). */
function NoteView({ name, content }: { name: string; content: string }): JSX.Element {
  switch (detectPreviewKind(name)) {
    case 'markdown':
      return <MarkdownView content={content} />
    case 'json':
      return <JsonView content={content} />
    case 'properties':
      return <PropertiesView content={content} />
    default:
      return <TextView content={content} />
  }
}

export interface NoteDetailProps {
  path: string
  name: string
  file: NotebookFile
  editing: boolean
  draft: string
  busy: boolean
  onDraft: (v: string) => void
  onEdit: () => void
  onCancelEdit: () => void
  onSave: () => void
  onCopy: () => void
}

export function NoteDetail(props: NoteDetailProps): JSX.Element {
  const { t } = useTranslation()
  const { file, editing } = props
  // Editing a truncated or binary file would save a partial/garbled copy — block it.
  const editable = file.exists && !file.binary && !file.truncated

  return (
    <div className="note-detail">
      <div className="note-detail__head">
        <div className="note-detail__crumb mono truncate" title={props.path}>
          {props.path}
        </div>
        <div className="cluster">
          {!editing && (
            <Button
              size="sm"
              variant="ghost"
              icon="copy"
              onClick={props.onCopy}
              disabled={props.busy}
            >
              {t('notebook.copy')}
            </Button>
          )}
          {!editing && editable && (
            <Button size="sm" icon="pencil" onClick={props.onEdit} disabled={props.busy}>
              {t('common.edit')}
            </Button>
          )}
          {editing && (
            <>
              <Button size="sm" variant="ghost" onClick={props.onCancelEdit} disabled={props.busy}>
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon="check"
                onClick={props.onSave}
                disabled={props.busy}
              >
                {t('common.save')}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="note-detail__body">
        {editing ? (
          <TextArea
            className="note-detail__editor"
            value={props.draft}
            onChange={(e) => props.onDraft(e.target.value)}
            spellCheck={false}
            autoFocus
          />
        ) : !file.exists ? (
          <p className="muted note-detail__note">{t('notebook.missing')}</p>
        ) : file.binary ? (
          <p className="muted note-detail__note">
            <Icon name="lock" size={15} /> {t('preview.binary')}
          </p>
        ) : file.content === '' ? (
          <p className="muted note-detail__note">{t('preview.empty')}</p>
        ) : (
          <>
            {file.truncated && <p className="muted note-detail__note">{t('preview.truncated')}</p>}
            <NoteView name={props.name} content={file.content} />
          </>
        )}
      </div>
    </div>
  )
}
