export default { load: () => ({ func: () => () => null }) }

export interface PasteboardTypesState {
  bridgeBroken: boolean
  nativeTypes: string[] | null
  changeCount?: number | null
}

export function pasteboardTypesKoffi(state: PasteboardTypesState): { load: () => unknown } {
  const changeCount = () => ('changeCount' in state ? state.changeCount : 7)
  return {
    load: () => {
      if (state.bridgeBroken) throw new Error('no objc runtime')
      return {
        func: (decl: string, ret?: string, args?: string[]) => {
          if (decl.includes('objc_getClass')) return () => 'NSPasteboard'
          if (decl.includes('sel_registerName')) return (name: string) => name
          if (decl.includes('GetClipboardSequenceNumber')) return () => 0
          if (ret === 'long') return (_obj: unknown, sel: string) => (sel === 'count' ? (state.nativeTypes ?? []).length : changeCount())
          if (ret === 'str') return (item: { name: string }) => item.name
          if (args && args.length === 3) return (_arr: unknown, _sel: string, i: number) => ({ name: (state.nativeTypes ?? [])[i] })
          return (_obj: unknown, sel: string) => {
            if (sel === 'generalPasteboard') return changeCount() === null ? null : 'pb'
            if (sel === 'types') return state.nativeTypes ? 'types' : null
            return null
          }
        }
      }
    }
  }
}
