const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent || '')

export const REPO_URL = IS_MAC ? 'https://github.com/SVorobiev-ru/Edge-Drop' : 'https://github.com/Deepender25/Edge-Drop'
export const CHANGELOG_URL = IS_MAC ? `${REPO_URL}/releases` : 'https://www.edgedrop.app/changelog'
