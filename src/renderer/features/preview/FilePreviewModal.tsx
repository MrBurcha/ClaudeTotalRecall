import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FilePreview } from '../../../core/types'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { SegmentedControl } from '../../components/SegmentedControl'
import { Skeleton } from '../../components/Skeleton'
import { api, normalizeError } from '../../state/api'
import type { ModalDescriptor } from '../../state/types'
import { useActions } from '../../state/useActions'
import { detectPreviewKind, type PreviewKind } from './previewFormat'
import { JsonView, MarkdownView, PropertiesView, TextView } from './renderers'

type PreviewDescriptor = Extract<ModalDescriptor, { kind: 'file-preview' }>

function renderBody(kind: PreviewKind, content: string): JSX.Element {
  switch (kind) {
    case 'markdown':
      return <MarkdownView content={content} />
    case 'json':
      return <JsonView content={content} />
    case 'properties':
      return <PropertiesView content={content} />
    case 'text':
      return <TextView content={content} />
  }
}

/**
 * Preview a memories file opened from Recent activity (#43): fetch its content
 * from the working copy, render it by detected format (with a manual switcher),
 * and offer to reveal its real source on this machine in the OS file manager.
 */
export function FilePreviewModal({ modal }: { modal: PreviewDescriptor }): JSX.Element {
  const { t } = useTranslation()
  const actions = useActions()
  const [data, setData] = useState<FilePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<PreviewKind>(() => detectPreviewKind(modal.name))

  useEffect(() => {
    let alive = true
    api
      .filePreview(modal.path)
      .then((d) => {
        if (alive) setData(d)
      })
      .catch((e) => {
        if (alive) setError(normalizeError(e))
      })
    return () => {
      alive = false
    }
  }, [modal.path])

  const options = useMemo(
    () => [
      { value: 'markdown' as const, label: t('preview.kind.markdown') },
      { value: 'json' as const, label: t('preview.kind.json') },
      { value: 'properties' as const, label: t('preview.kind.properties') },
      { value: 'text' as const, label: t('preview.kind.text') },
    ],
    [t],
  )

  const reveal = async (): Promise<void> => {
    try {
      await api.revealSource(modal.path)
    } catch (e) {
      actions.notify(normalizeError(e), 'err')
    }
  }

  function body(): JSX.Element {
    if (error) return <p className="preview-note muted">{error}</p>
    if (!data) return <Skeleton h={220} radius={10} />
    if (!data.exists) return <p className="preview-note muted">{t('preview.removed')}</p>
    if (data.binary) return <p className="preview-note muted">{t('preview.binary')}</p>
    if (data.content === '') return <p className="preview-note muted">{t('preview.empty')}</p>
    return (
      <>
        {data.truncated && <p className="preview-note muted">{t('preview.truncated')}</p>}
        {renderBody(kind, data.content)}
      </>
    )
  }

  return (
    <Modal title={modal.name} size="lg" onClose={actions.closeModal}>
      <div className="preview-toolbar">
        <SegmentedControl<PreviewKind>
          ariaLabel={t('preview.rendererAria')}
          value={kind}
          onChange={setKind}
          options={options}
        />
        <Button
          variant="ghost"
          size="sm"
          icon="folder-open"
          disabled={!data?.sourcePath}
          onClick={reveal}
        >
          {t('preview.openLocation')}
        </Button>
      </div>
      {body()}
    </Modal>
  )
}
