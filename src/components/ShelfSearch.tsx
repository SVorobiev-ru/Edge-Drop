/**
 * ShelfSearch — the clipboard search box.
 *
 * Typing needs OS keyboard focus, which the shelf normally never takes. So
 * engaging this input temporarily makes the window focusable (and pauses the
 * global toggle hotkey so typing can't yank the shelf), and every exit hands
 * everything back. The main process captured the user's app at open time and
 * again at engage time, so a click on an item still pastes into that app.
 *
 * Engagement starts on pointer-down, NOT on focus: a NOACTIVATE window may
 * never produce a focus event from a plain click, so waiting for onFocus
 * would make the box look dead.
 */
import { useRef } from 'react'
import { useStore } from '../store/appStore'
import { useInputEngagement } from '../hooks/useInputEngagement'
import { useTranslation } from '../i18n'
import { SearchIcon } from './icons'

export function ShelfSearch() {
  const { t } = useTranslation()
  const query = useStore((s) => s.query)
  const setQuery = useStore((s) => s.setQuery)
  const inputRef = useRef<HTMLInputElement>(null)
  const { engage, disengage } = useInputEngagement(inputRef)

  return (
    <div className="search">
      <SearchIcon className="search-icon" width={14} height={14} />
      <input
        ref={inputRef}
        type="text"
        placeholder={t('header.searchPlaceholder')}
        aria-label={t('header.searchPlaceholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onPointerDown={() => {
          engage()
        }}
        onFocus={() => {
          engage()
        }}
        onBlur={() => {
          disengage()
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return
          if (e.key === 'Escape') {
            // Staged Escape: clear first, blur second — never close the
            // panel while typing (the window handler skips inputs as well).
            e.stopPropagation()
            if (query) {
              setQuery('')
            } else {
              inputRef.current?.blur()
            }
          }
        }}
        spellCheck={false}
      />
    </div>
  )
}
