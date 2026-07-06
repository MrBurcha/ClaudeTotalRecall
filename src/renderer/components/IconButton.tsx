import type { ButtonHTMLAttributes } from 'react'
import { Icon, type IconName } from './Icon'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName
  /** Requerido: nombre accesible (aria-label + title). */
  label: string
  size?: number
}

export function IconButton({
  icon,
  label,
  size = 18,
  className,
  type = 'button',
  ...rest
}: IconButtonProps): JSX.Element {
  return (
    <button
      className={className ? `icon-btn ${className}` : 'icon-btn'}
      aria-label={label}
      title={label}
      type={type}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  )
}
