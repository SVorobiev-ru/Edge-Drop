import { IS_DARWIN } from './edge'

export const REPO_URL = IS_DARWIN ? 'https://github.com/SVorobiev-ru/Edge-Drop' : 'https://github.com/Deepender25/Edge-Drop'
export const CHANGELOG_URL = IS_DARWIN ? `${REPO_URL}/releases` : 'https://www.edgedrop.app/changelog'
export const SUPPORT_URL = IS_DARWIN ? REPO_URL : 'https://www.edgedrop.app/supportedgedrop'
