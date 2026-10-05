import { edge } from '../lib/edge'
import { loadRecents } from '../lib/emoji/prefs'
import type { AppState, StoreSet } from './types'

export const createEmojiSlice = (set: StoreSet) => ({
  emojiOpen: false,
  emojiCategory: 'smileys',
  setEmojiCategory: (emojiCategory) => set({ emojiCategory }),
  setEmojiOpen: (emojiOpen) => {
    if (emojiOpen) {
      // Every open lands on the first page: recents when any exist,
      // otherwise smileys. Scroll/budget reset happens in the picker.
      let landing: import('../lib/emoji/catalog').EmojiCategoryId = 'smileys'
      try {
        if (loadRecents().length > 0) landing = 'recents'
      } catch { /* ignore */ }
      set({
        emojiOpen: true,
        emojiCategory: landing,
        settingsOpen: false,
        previewItemId: null,
        previewItemRect: null,
        previewFlyoutRect: null,
        styleFlyoutOpen: false,
        styleFlyoutAnchorRect: null,
        languageFlyoutOpen: false,
        languageFlyoutAnchorRect: null,
        expandedStackId: null
      })
      edge.setPreviewMode(false)
    } else {
      set({ emojiOpen: false })
    }
  }
}) satisfies Partial<AppState>
