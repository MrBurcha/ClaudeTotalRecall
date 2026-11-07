/**
 * @vitest-environment happy-dom
 */
import { useRef, useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { NotebookSearchResult } from '../../../core/types'

const api = vi.hoisted(() => ({ notebookSearch: vi.fn() }))
vi.mock('../../state/api', () => ({ api, normalizeError: (e: unknown) => String(e) }))

import i18n from '../../i18n'
import { NotebookSearchBox, NotebookSearchResults, useNotebookSearch } from './NotebookSearch'

const RESULT: NotebookSearchResult = {
  truncated: false,
  hits: [
    {
      path: 'general/prompts/deploy.md',
      name: 'deploy.md',
      nameRanges: [[0, 6]],
      nameMatch: true,
      contentMatches: 0,
      snippet: { text: '# Checklist', ranges: [] },
    },
    {
      path: 'projects/Alpha/notes.md',
      name: 'notes.md',
      nameRanges: [],
      nameMatch: false,
      contentMatches: 1,
      snippet: { text: 'how we deploy it', ranges: [[7, 13]] },
    },
  ],
}

/** The search box + results wired the way the Notebook screen wires them. */
function Harness({ onOpen }: { onOpen: (p: string) => void }): JSX.Element {
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const search = useNotebookSearch(query, 0)
  return (
    <>
      <NotebookSearchBox
        value={query}
        inputRef={ref}
        onChange={setQuery}
        onSubmit={() => {
          const first = search.result?.hits[0]
          if (first) onOpen(first.path)
        }}
      />
      {query.trim() ? (
        <NotebookSearchResults
          query={query}
          state={search}
          selected={null}
          onOpen={onOpen}
          onClear={() => setQuery('')}
        />
      ) : (
        <p>tree</p>
      )}
    </>
  )
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Notebook search', () => {
  it('searches once typing settles and highlights the matches', async () => {
    api.notebookSearch.mockResolvedValue(RESULT)
    render(<Harness onOpen={vi.fn()} />)
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search the Notebook' }), 'deploy')

    expect(await screen.findByText('2 results')).toBeInTheDocument()
    // Debounced: one request for the settled query, not one per keystroke.
    expect(api.notebookSearch).toHaveBeenCalledTimes(1)
    expect(api.notebookSearch).toHaveBeenCalledWith('deploy')

    const marks = Array.from(document.querySelectorAll('mark')).map((m) => m.textContent)
    expect(marks).toEqual(['deploy', 'deploy'])
    expect(screen.getByText('General / prompts')).toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('opens a result on click and the first one on Enter', async () => {
    api.notebookSearch.mockResolvedValue(RESULT)
    const onOpen = vi.fn()
    render(<Harness onOpen={onOpen} />)
    const box = screen.getByRole('searchbox', { name: 'Search the Notebook' })
    await userEvent.type(box, 'deploy')
    await screen.findByText('2 results')

    await userEvent.click(screen.getByText('notes.md'))
    expect(onOpen).toHaveBeenLastCalledWith('projects/Alpha/notes.md')

    await userEvent.type(box, '{Enter}')
    expect(onOpen).toHaveBeenLastCalledWith('general/prompts/deploy.md')
  })

  it('Esc clears the query and brings the tree back', async () => {
    api.notebookSearch.mockResolvedValue(RESULT)
    render(<Harness onOpen={vi.fn()} />)
    const box = screen.getByRole('searchbox', { name: 'Search the Notebook' })
    await userEvent.type(box, 'deploy')
    await screen.findByText('2 results')
    await userEvent.type(box, '{Escape}')
    expect(box).toHaveValue('')
    expect(screen.getByText('tree')).toBeInTheDocument()
  })

  it('says so when nothing matches', async () => {
    api.notebookSearch.mockResolvedValue({ hits: [], truncated: false })
    render(<Harness onOpen={vi.fn()} />)
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search the Notebook' }), 'zzz')
    await waitFor(() => expect(screen.getByText('No notes match "zzz".')).toBeInTheDocument())
  })
})
