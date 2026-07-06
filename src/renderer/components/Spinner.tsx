import { Icon } from './Icon'

export function Spinner({ size = 18 }: { size?: number }): JSX.Element {
  return <Icon name="spinner" size={size} className="spin" />
}
