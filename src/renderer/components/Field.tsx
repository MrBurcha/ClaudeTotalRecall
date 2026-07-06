import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'

function Caption({ hint, error }: { hint?: string; error?: string }): JSX.Element | null {
  if (error) return <span className="field__error">{error}</span>
  if (hint) return <span className="field__hint">{hint}</span>
  return null
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
  mono?: boolean
}

export function TextField({
  label,
  hint,
  error,
  mono,
  className,
  ...rest
}: TextFieldProps): JSX.Element {
  const cls = ['input', mono ? 'input--mono' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <label className="field">
      {label && <span className="field__label">{label}</span>}
      <input className={cls} {...rest} />
      <Caption hint={hint} error={error} />
    </label>
  )
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  hint?: string
  error?: string
}

export function TextArea({
  label,
  hint,
  error,
  className,
  ...rest
}: TextAreaProps): JSX.Element {
  return (
    <label className="field">
      {label && <span className="field__label">{label}</span>}
      <textarea className={className ? `textarea ${className}` : 'textarea'} {...rest} />
      <Caption hint={hint} error={error} />
    </label>
  )
}
