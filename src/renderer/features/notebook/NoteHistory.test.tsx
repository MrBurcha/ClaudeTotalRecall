/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { NotebookDiff, NotebookHistory, NotebookVersion } from '../../../core/types'

// The bridge is resolved at import time from window; stub the module instead.
const api = vi.hoisted(() => ({
  notebookHistory: vi.fn(),
  notebookReadVersion: vi.fn(),
  notebookDiffVersion: vi.fn(),
}))
vi.mock('../../state/api', () => ({ api, normalizeError: (e: unknown) => String(e) }))

import i18n from '../../i18n'
import { NoteHistory } from './NoteHistory'

const version = (p: Partial<NotebookVersion>): NotebookVersion => ({
  hash: 'a'.repeat(40),
  shortHash: 'aaaaaaa',
  at: '2026-11-01T10:00:00Z',
  author: 't',
  subject: 'notebook: update general/n.md',
  kind: 'update',
  path: 'general/n.md',
  available: true,
  current: false,
  ...p,
})

const HISTORY: NotebookHistory = {
  truncated: false,
  versions: [
    version({ hash: '1'.repeat(40), shortHash: '1111111', current: true }),
    version({ hash: '2'.repeat(40), shortHash: '2222222', path: 'general/old.md' }),
    version({ hash: '3'.repeat(40), shortHash: '3333333', kind: 'create', path: 'general/old.md' }),
  ],
}

const DIFF: NotebookDiff = {
  identical: false,
  binary: false,
  truncated: false,
  hunks: [
    {
      header: '@@ -1,2 +1,2 @@',
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 2,
      lines: [
        { kind: 'ctx', text: 'same', oldNo: 1, newNo: 1 },
        { kind: 'del', text: 'old line', oldNo: 2 },
        { kind: 'add', text: 'new line', newNo: 2 },
      ],
    },
  ],
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderHistory(onRestore = vi.fn()) {
  api.notebookHistory.mockResolvedValue(HISTORY)
  api.notebookReadVersion.mockResolvedValue({
    content: 'old body',
    size: 8,
    truncated: false,
    binary: false,
    exists: true,
  })
  api.notebookDiffVersion.mockResolvedValue(DIFF)
  render(
    <NoteHistory
      path="general/n.md"
      name="n.md"
      busy={false}
      onBack={vi.fn()}
      onRestore={onRestore}
    />,
  )
  return onRestore
}

describe('NoteHistory', () => {
  it('lists the versions and opens the newest one that differs from the note', async () => {
    renderHistory()
    const list = await screen.findByRole('list', { name: 'Versions of this note' })
    const items = within(list).getAllByRole('button')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('Edited')
    expect(items[0]).toHaveTextContent('Current')
    expect(items[2]).toHaveTextContent('Created')
    expect(items[1]).toHaveAttribute('aria-current', 'true')

    // Read with the path the note had AT that commit (it was renamed since).
    await waitFor(() =>
      expect(api.notebookReadVersion).toHaveBeenCalledWith('2'.repeat(40), 'general/old.md'),
    )
    expect(await screen.findByText('old body')).toBeInTheDocument()
    expect(screen.getByText('Then named general/old.md')).toBeInTheDocument()
  })

  it('compares the selected version with the current note', async () => {
    renderHistory()
    await screen.findByText('old body')
    await userEvent.click(screen.getByRole('button', { name: 'Compare with current' }))
    await waitFor(() =>
      expect(api.notebookDiffVersion).toHaveBeenCalledWith(
        'general/n.md',
        '2'.repeat(40),
        'general/old.md',
      ),
    )
    const removed = await screen.findByText('old line')
    expect(removed.closest('.nb-diff__line')).toHaveClass('nb-diff__line--del')
    expect(screen.getByText('new line').closest('.nb-diff__line')).toHaveClass('nb-diff__line--add')
  })

  it('restores the selected version, but not the one that is already current', async () => {
    const onRestore = renderHistory()
    await screen.findByText('old body')
    const restore = screen.getByRole('button', { name: 'Restore this version' })
    await userEvent.click(restore)
    expect(onRestore).toHaveBeenCalledWith(HISTORY.versions[1])

    const list = screen.getByRole('list', { name: 'Versions of this note' })
    await userEvent.click(within(list).getAllByRole('button')[0])
    expect(screen.getByRole('button', { name: 'Restore this version' })).toBeDisabled()
  })
})
