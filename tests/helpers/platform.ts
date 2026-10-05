export const realPlatform = process.platform

export function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

export function restorePlatform(): void {
  setPlatform(realPlatform)
}

export function withPlatform<T>(platform: string, fn: () => T): T {
  const previous = process.platform
  setPlatform(platform)
  let result: T
  try {
    result = fn()
  } catch (error) {
    setPlatform(previous)
    throw error
  }
  if (result instanceof Promise) {
    return result.finally(() => setPlatform(previous)) as T
  }
  setPlatform(previous)
  return result
}
