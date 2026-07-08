import { useTranslation } from 'react-i18next'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { parseProperties } from './previewFormat'

/**
 * Links are shown but NOT navigable, and remote images are replaced by their alt
 * text: a preview must never let a file's content navigate the Electron window or
 * trip the `default-src 'self'` CSP with a remote fetch. No `rehype-raw` → raw
 * HTML in markdown is ignored, so this is XSS-safe.
 */
const MD_COMPONENTS: Components = {
  a: ({ children }) => <span className="preview-md__link">{children}</span>,
  img: ({ alt }) => <em className="preview-md__img">{alt || 'image'}</em>,
}

export function MarkdownView({ content }: { content: string }): JSX.Element {
  return (
    <div className="preview-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

export function JsonView({ content }: { content: string }): JSX.Element {
  const { t } = useTranslation()
  let pretty = content
  let invalid = false
  try {
    pretty = JSON.stringify(JSON.parse(content), null, 2)
  } catch {
    invalid = true
  }
  return (
    <>
      {invalid && <p className="preview-note muted">{t('preview.parseError')}</p>}
      <pre className="preview-code">{pretty}</pre>
    </>
  )
}

export function PropertiesView({ content }: { content: string }): JSX.Element {
  const lines = parseProperties(content)
  return (
    <div className="preview-props">
      {lines.map((l, i) => {
        if (l.type === 'blank') return <div key={i} className="preview-props__blank" />
        if (l.type === 'comment')
          return (
            <div key={i} className="preview-props__comment mono muted">
              {l.text}
            </div>
          )
        return (
          <div key={i} className="preview-props__row">
            <span className="preview-props__key mono">{l.key}</span>
            <span className="preview-props__val mono">{l.value}</span>
          </div>
        )
      })}
    </div>
  )
}

export function TextView({ content }: { content: string }): JSX.Element {
  return <pre className="preview-code">{content}</pre>
}
