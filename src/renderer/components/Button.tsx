import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

type Variant = 'default' | 'primary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: IconName
  block?: boolean
  children?: ReactNode
}

const VARIANT: Record<Variant, string> = {
  default: '',
  primary: 'btn--primary',
  ghost: 'btn--ghost',
  danger: 'btn--danger',
}
const SIZE: Record<Size, string> = { sm: 'btn--sm', md: '', lg: 'btn--lg' }
const ICON_SIZE: Record<Size, number> = { sm: 15, md: 17, lg: 19 }

export function Button({
  variant = 'default',
  size = 'md',
  icon,
  block,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps): JSX.Element {
  const cls = ['btn', VARIANT[variant], SIZE[size], block ? 'btn--block' : '', className ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <button className={cls} type={type} {...rest}>
      {icon && <Icon name={icon} size={ICON_SIZE[size]} />}
      {children}
    </button>
  )
}
