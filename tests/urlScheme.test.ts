import { describe, expect, it } from 'vitest'
import { parseEdgeDropUrl } from '../electron/main/urlScheme'

describe('edgedrop:// URL parsing', () => {
  it.each([
    ['edgedrop://toggle', { action: 'toggle' }],
    ['edgedrop://open', { action: 'open' }],
    ['edgedrop://open/', { action: 'open' }],
    ['EDGEDROP://Open', { action: 'open' }],
    ['edgedrop://search?q=invoice', { action: 'search', query: 'invoice' }],
    ['edgedrop://search?q=%D1%81%D1%87%D0%B5%D1%82%20%E2%84%962', { action: 'search', query: 'счет №2' }],
    ['edgedrop://search?q=a+b', { action: 'search', query: 'a b' }]
  ])('accepts %s', (url, expected) => {
    expect(parseEdgeDropUrl(url)).toEqual(expected)
  })

  it.each([
    'https://toggle',
    'edgedrop:toggle',
    'edgedrop://quit',
    'edgedrop://toggle?x=1',
    'edgedrop://open#frag',
    'edgedrop://open/extra',
    'edgedrop://user@open',
    'edgedrop://open:8080',
    'edgedrop://search',
    'edgedrop://search?q=',
    'edgedrop://search?q=%20%20',
    'edgedrop://search?q=a&q=b',
    'edgedrop://search?q=a&x=1',
    'edgedrop://search?q=a%00b',
    'edgedrop://search?q=line%0Abreak',
    `edgedrop://search?q=${'x'.repeat(501)}`,
    'edgedrop://paste',
    'edgedrop://paste?index=1',
    'edgedrop://paste?index=2000',
    'edgedrop://paste?index=0',
    'edgedrop://paste?index=-1',
    'edgedrop://paste?index=01',
    'edgedrop://paste?index=1.5',
    'edgedrop://paste?index=2001',
    'edgedrop://paste?index=1e3',
    'edgedrop://paste?index=1&index=2',
    'edgedrop://paste?id=abc',
    `edgedrop://search?q=${'x'.repeat(2100)}`,
    '',
    'not a url'
  ])('ignores %s', (url) => {
    expect(parseEdgeDropUrl(url)).toBeNull()
  })

  it('ignores non-strings', () => {
    expect(parseEdgeDropUrl(undefined)).toBeNull()
    expect(parseEdgeDropUrl(42)).toBeNull()
  })
})
