import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '../../components/Icon'
import { Kbd } from '../../components/Kbd'
import { Overlay } from '../../components/Overlay'
import { useAppState } from '../../state/store'
import { useActions } from '../../state/useActions'
import { buildCommands, type Command } from './commands'
import { filterCommands } from './filter'

export function CommandPalette(): JSX.Element | null {
  const { t, i18n } = useTranslation()
  const state = useAppState()
  const actions = useActions()
  const { open, query, index } = state.palette
  const inputRef = useRef<HTMLInputElement>(null)

  // i18n.language in the deps so titles/groups re-translate when the language changes.
  const results: Command[] = useMemo(
    () => filterCommands(query, buildCommands(state, actions, t)),
    [query, state, actions, t, i18n.language],
  )

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  if (!open) return null

  const clamped = Math.min(index, Math.max(results.length - 1, 0))
  const move = (delta: number): void => {
    if (results.length === 0) return
    actions.setPaletteIndex((clamped + delta + results.length) % results.length)
  }
  const exec = (cmd?: Command): void => {
    if (!cmd || cmd.disabled) return
    actions.closePalette()
    cmd.run()
  }
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      exec(results[clamped])
    }
  }

  let lastGroup = ''
  return (
    <Overlay variant="palette" onClose={actions.closePalette}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={t('palette.ariaLabel')}>
        <div className="palette__search">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            className="palette__input"
            placeholder={t('palette.searchPlaceholder')}
            value={query}
            onChange={(e) => actions.setPaletteQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="palette__list">
          {results.length === 0 && <div className="palette__group muted">{t('palette.noResults')}</div>}
          {results.map((cmd, i) => {
            const header = cmd.group !== lastGroup ? cmd.group : null
            lastGroup = cmd.group
            return (
              <div key={cmd.id}>
                {header && <div className="palette__group label">{header}</div>}
                <button
                  type="button"
                  className="palette__item"
                  aria-selected={i === clamped}
                  disabled={cmd.disabled}
                  onMouseEnter={() => actions.setPaletteIndex(i)}
                  onClick={() => exec(cmd)}
                >
                  <Icon name={cmd.icon} size={17} />
                  <span className="grow">{cmd.title}</span>
                  {cmd.subtitle && <span className="palette__item-sub mono">{cmd.subtitle}</span>}
                </button>
              </div>
            )
          })}
        </div>
        <div className="palette__foot">
          <span className="cluster">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> {t('palette.navigate')}
          </span>
          <span className="cluster">
            <Kbd>⏎</Kbd> {t('palette.execute')}
          </span>
        </div>
      </div>
    </Overlay>
  )
}
