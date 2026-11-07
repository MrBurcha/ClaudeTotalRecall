import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { NotebookSearchResult, TextRange } from '../../../core/types'
import { Icon } from '../../components/Icon'
import { IconButton } from '../../components/IconButton'
import { api, normalizeError } from '../../state/api'
import { noteLocation, splitHighlights } from './notebookView'

/** Quiet time after the last keystroke before searching. */
export const SEARCH_DEBOUNCE_MS = 200

export interface SearchState {
  result: NotebookSearchResult | null
  pending: boolean
  error: string | null
}

const IDLE: SearchState = { result: null, pending: false, error: null }

/**
 * Debounced Notebook search (#108). Each new query (or `nonce` bump, e.g. after a
 * save) cancels the previous timer and ignores its late response, so a slow
 * search can never overwrite a newer one. The last results stay visible while
 * the next search runs.
 */
export function useNotebookSearch(query: string, nonce: number): SearchState {
  const [state, setState] = useState<SearchState>(IDLE)
  const q = query.trim()

  useEffect(() => {
    if (!q) {
      setState(IDLE)
      return
    }
    let alive = true
    setState((s) => ({ ...s, pending: true }))
    const timer = setTimeout(() => {
      api
        .notebookSearch(q)
        .then((result) => {
          if (alive) setState({ result, pending: false, error: null })
        })
        .catch((e) => {
          if (alive) setState({ result: null, pending: false, error: normalizeError(e) })
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [q, nonce])

  return state
}

function Highlighted({ text, ranges }: { text: string; ranges: TextRange[] }): JSX.Element {
  return (
    <>
      {splitHighlights(text, ranges).map((s, i) =>
        s.hit ? (
          <mark key={i} className="nb-search__mark">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  )
}

export function NotebookSearchBox({
  value,
  inputRef,
  onChange,
  onSubmit,
}: {
  value: string
  inputRef: RefObject<HTMLInputElement | null>
  onChange: (v: string) => void
  /** Enter: open the first result */
  onSubmit: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onSubmit()
    } else if (e.key === 'Escape' && value) {
      e.preventDefault()
      e.stopPropagation()
      onChange('')
    }
  }
  return (
    <div className="nb-search">
      <Icon name="search" size={15} className="nb-search__icon" />
      <input
        ref={inputRef}
        className="input nb-search__input"
        type="search"
        value={value}
        placeholder={t('notebook.search.placeholder')}
        aria-label={t('notebook.search.aria')}
        title={t('notebook.search.hint')}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        spellCheck={false}
      />
      {value && (
        <IconButton
          icon="x"
          size={14}
          label={t('notebook.search.clear')}
          className="nb-search__clear"
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}

export function NotebookSearchResults({
  query,
  state,
  selected,
  onOpen,
  onClear,
}: {
  query: string
  state: SearchState
  selected: string | null
  onOpen: (path: string) => void
  /** Esc from a result: clear the search and go back to the tree */
  onClear: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const { result, pending, error } = state

  if (error) return <p className="muted nb-search__msg">{error}</p>
  if (!result) return <p className="muted nb-search__msg">{t('notebook.search.searching')}</p>
  if (result.hits.length === 0) {
    return pending ? (
      <p className="muted nb-search__msg">{t('notebook.search.searching')}</p>
    ) : (
      <p className="muted nb-search__msg">
        {t('notebook.search.noResults', { query: query.trim() })}
      </p>
    )
  }

  return (
    <div
      className={pending ? 'nb-search__results nb-search__results--pending' : 'nb-search__results'}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClear()
        }
      }}
    >
      <ul className="nb-search__list">
        {result.hits.map((h) => (
          <li key={h.path}>
            <button
              type="button"
              className={['nb-search__hit', selected === h.path ? 'nb-search__hit--active' : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => onOpen(h.path)}
              title={h.path}
            >
              <span className="nb-search__name">
                <Icon name="file-text" size={14} />
                <span className="grow truncate">
                  <Highlighted text={h.name} ranges={h.nameRanges} />
                </span>
              </span>
              <span className="nb-search__loc truncate">
                {noteLocation(h.path, t('notebook.general'))}
              </span>
              {h.snippet && (
                <span className="nb-search__snippet">
                  <Highlighted text={h.snippet.text} ranges={h.snippet.ranges} />
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <p className="muted nb-search__count">
        {result.truncated
          ? t('notebook.search.truncated', { limit: result.hits.length })
          : t('notebook.search.count', { count: result.hits.length })}
      </p>
    </div>
  )
}
