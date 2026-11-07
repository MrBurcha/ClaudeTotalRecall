/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '../../i18n'
import { PinnedTree, type PinnedTreeProps } from './PinnedTree'
import type { PinnedGroup } from './pinnedGroups'

const groups: PinnedGroup[] = [
  {
    id: 'general',
    scope: 'general',
    entries: [
      { key: 'memories/pinned/a.md', scope: 'general', name: 'a.md', byMachine: { m1: '/a.md' } },
      { key: 'memories/pinned/b.md', scope: 'general', name: 'b.md', byMachine: { m2: '/b.md' } },
    ],
  },
  { id: 'project:demo', scope: 'project', project: 'demo', entries: [] },
]

function setup(patch: Partial<PinnedTreeProps> = {}) {
  void i18n.changeLanguage('en')
  const props: PinnedTreeProps = {
    groups,
    selected: null,
    machineId: 'm1',
    canAdd: true,
    isOpen: () => true,
    onToggle: vi.fn(),
    onSelect: vi.fn(),
    onAdd: vi.fn(),
    ...patch,
  }
  render(<PinnedTree {...props} />)
  return props
}

describe('PinnedTree', () => {
  it('shows General and each project, with an empty hint for a group without files', () => {
    setup()
    expect(screen.getByText('General')).toBeInTheDocument()
    expect(screen.getByText('demo')).toBeInTheDocument()
    expect(screen.getByText('No files yet.')).toBeInTheDocument()
  })

  it('flags a file with no path on this machine', () => {
    setup()
    expect(screen.getAllByTitle('no path on this machine')).toHaveLength(1)
  })

  it('selects a file on click', async () => {
    const props = setup()
    await userEvent.click(screen.getByText('b.md'))
    expect(props.onSelect).toHaveBeenCalledWith('memories/pinned/b.md')
  })

  it('"+" starts a new file in that group without toggling it', async () => {
    const props = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Add a file to this project' }))
    expect(props.onAdd).toHaveBeenCalledWith({ scope: 'project', project: 'demo' })
    expect(props.onToggle).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Pin a file to General' }))
    expect(props.onAdd).toHaveBeenCalledWith({ scope: 'general' })
  })

  it('hides "+" when nothing can be added, and collapsed groups hide their files', () => {
    setup({ canAdd: false, isOpen: (id) => id !== 'general' })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText('a.md')).not.toBeInTheDocument()
  })
})
