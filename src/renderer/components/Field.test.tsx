import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TextField } from './Field'

describe('TextField', () => {
  it('renders its label and calls onChange as the user types', async () => {
    const onChange = vi.fn()
    render(<TextField label="Repo URL" onChange={onChange} />)
    expect(screen.getByText('Repo URL')).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox'), 'abc')
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('shows the hint, and the error takes precedence over the hint', () => {
    const { rerender } = render(<TextField label="Name" hint="lowercase only" />)
    expect(screen.getByText('lowercase only')).toBeInTheDocument()

    rerender(<TextField label="Name" hint="lowercase only" error="already taken" />)
    expect(screen.getByText('already taken')).toBeInTheDocument()
    expect(screen.queryByText('lowercase only')).not.toBeInTheDocument()
  })
})
