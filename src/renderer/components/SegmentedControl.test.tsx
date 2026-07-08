import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SegmentedControl } from './SegmentedControl'

const options = [
  { value: 'dir', label: 'Folder' },
  { value: 'file', label: 'File' },
]

describe('SegmentedControl', () => {
  it('marks the selected option with aria-pressed', () => {
    render(<SegmentedControl options={options} value="file" onChange={() => {}} ariaLabel="Kind" />)
    expect(screen.getByRole('button', { name: 'File' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Folder' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls onChange with the clicked option value', async () => {
    const onChange = vi.fn()
    render(<SegmentedControl options={options} value="dir" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'File' }))
    expect(onChange).toHaveBeenCalledWith('file')
  })
})
