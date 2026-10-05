import koffi from 'koffi'
import { isMainThread, parentPort, workerData } from 'node:worker_threads'

type Ptr = unknown

export const OCR_WORKER_ROLE = 'edge-drop-ocr'
const OCR_LANGUAGES: readonly string[] = ['ru-RU', 'en-US']
export const MAX_OCR_TEXT_CHARS = 20_000

const VN_RECOGNITION_LEVEL_ACCURATE = 0

export interface VisionObjc {
  withPool<T>(fn: () => T): T
  fileUrl(path: string): Ptr
  newHandler(url: Ptr): Ptr
  newTextRequest(): Ptr
  supportedLanguages(request: Ptr): string[]
  configure(request: Ptr, options: { level: number; languageCorrection: boolean; languages: readonly string[] }): void
  perform(handler: Ptr, request: Ptr): boolean
  results(request: Ptr): Ptr
  count(array: Ptr): number
  at(array: Ptr, index: number): Ptr
  topCandidate(observation: Ptr): Ptr
  candidateString(candidate: Ptr): string
  release(obj: Ptr): void
}

export interface OcrJob {
  id: number
  path: string
}

export type OcrReply = { id: number; ok: true; text: string; ms: number } | { id: number; ok: false; error: string }

export function pickLanguages(supported: readonly string[], wanted: readonly string[] = OCR_LANGUAGES): string[] {
  const set = new Set(supported)
  return wanted.filter((lang) => set.has(lang))
}

export function joinRecognizedLines(lines: readonly string[], max = MAX_OCR_TEXT_CHARS): string {
  const text = lines.map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
  return text.length > max ? text.slice(0, max) : text
}

export function recognizeText(objc: VisionObjc, path: string, wanted: readonly string[] = OCR_LANGUAGES): string | null {
  return objc.withPool(() => {
    const url = objc.fileUrl(path)
    if (!url) return null
    const handler = objc.newHandler(url)
    if (!handler) return null
    const request = objc.newTextRequest()
    if (!request) {
      objc.release(handler)
      return null
    }
    try {
      objc.configure(request, {
        level: VN_RECOGNITION_LEVEL_ACCURATE,
        languageCorrection: true,
        languages: pickLanguages(objc.supportedLanguages(request), wanted)
      })
      if (!objc.perform(handler, request)) return null
      const results = objc.results(request)
      if (!results) return ''
      const lines: string[] = []
      const total = objc.count(results)
      for (let i = 0; i < total; i++) {
        const observation = objc.at(results, i)
        const candidate = observation ? objc.topCandidate(observation) : null
        if (candidate) lines.push(objc.candidateString(candidate))
      }
      return joinRecognizedLines(lines)
    } finally {
      objc.release(request)
      objc.release(handler)
    }
  })
}

function createVisionObjc(): VisionObjc {
  koffi.load('/System/Library/Frameworks/Foundation.framework/Foundation')
  koffi.load('/System/Library/Frameworks/Vision.framework/Vision')
  const objc = koffi.load('/usr/lib/libobjc.A.dylib')
  const getClass = objc.func('void *objc_getClass(const char *name)') as (n: string) => Ptr
  const sel = objc.func('void *sel_registerName(const char *name)') as (n: string) => Ptr
  const msgPtr = objc.func('objc_msgSend', 'void *', ['void *', 'void *']) as unknown as (a: Ptr, b: Ptr) => Ptr
  const msgVoid = objc.func('objc_msgSend', 'void', ['void *', 'void *']) as unknown as (a: Ptr, b: Ptr) => void
  const msgULong = objc.func('objc_msgSend', 'ulong', ['void *', 'void *']) as unknown as (a: Ptr, b: Ptr) => number | bigint
  const msgStr = objc.func('objc_msgSend', 'str', ['void *', 'void *']) as unknown as (a: Ptr, b: Ptr) => string | null
  const msgObj = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'void *']) as unknown as (a: Ptr, b: Ptr, c: Ptr) => Ptr
  const msgObjObj = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'void *', 'void *']) as unknown as (a: Ptr, b: Ptr, c: Ptr, d: Ptr) => Ptr
  const msgAt = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'ulong']) as unknown as (a: Ptr, b: Ptr, c: number) => Ptr
  const msgFromUtf8 = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'str']) as unknown as (a: Ptr, b: Ptr, c: string) => Ptr
  const msgVoidLong = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'long']) as unknown as (a: Ptr, b: Ptr, c: number) => void
  const msgVoidBool = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'bool']) as unknown as (a: Ptr, b: Ptr, c: boolean) => void
  const msgVoidObj = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'void *']) as unknown as (a: Ptr, b: Ptr, c: Ptr) => void
  const msgBoolObjObj = objc.func('objc_msgSend', 'bool', ['void *', 'void *', 'void *', 'void *']) as unknown as (a: Ptr, b: Ptr, c: Ptr, d: Ptr) => boolean
  const msgBoolObj = objc.func('objc_msgSend', 'bool', ['void *', 'void *', 'void *']) as unknown as (a: Ptr, b: Ptr, c: Ptr) => boolean

  const classes = {
    NSAutoreleasePool: getClass('NSAutoreleasePool'),
    NSString: getClass('NSString'),
    NSURL: getClass('NSURL'),
    NSArray: getClass('NSArray'),
    NSMutableArray: getClass('NSMutableArray'),
    NSDictionary: getClass('NSDictionary'),
    VNImageRequestHandler: getClass('VNImageRequestHandler'),
    VNRecognizeTextRequest: getClass('VNRecognizeTextRequest')
  }
  for (const [name, cls] of Object.entries(classes)) {
    if (!cls) throw new Error(`ObjC class ${name} is unavailable`)
  }
  const sels: Record<string, Ptr> = {}
  for (const n of [
    'new', 'drain', 'alloc', 'init', 'release', 'stringWithUTF8String:', 'fileURLWithPath:', 'dictionary', 'array',
    'addObject:', 'arrayWithObject:', 'initWithURL:options:', 'setRecognitionLevel:', 'setUsesLanguageCorrection:',
    'setRecognitionLanguages:', 'supportedRecognitionLanguagesAndReturnError:', 'respondsToSelector:',
    'performRequests:error:', 'results', 'count', 'objectAtIndex:', 'topCandidates:', 'firstObject', 'string', 'UTF8String'
  ]) {
    sels[n] = sel(n)
  }

  const nsString = (value: string): Ptr => msgFromUtf8(classes.NSString, sels['stringWithUTF8String:'], value)
  const jsString = (ns: Ptr): string => {
    if (!ns) return ''
    const value = msgStr(ns, sels.UTF8String)
    return typeof value === 'string' ? value : ''
  }
  const count = (array: Ptr): number => Number(msgULong(array, sels.count))

  return {
    withPool<T>(fn: () => T): T {
      const pool = msgPtr(classes.NSAutoreleasePool, sels.new)
      try {
        return fn()
      } finally {
        if (pool) msgVoid(pool, sels.drain)
      }
    },
    fileUrl(path) {
      const nsPath = nsString(path)
      return nsPath ? msgObj(classes.NSURL, sels['fileURLWithPath:'], nsPath) : null
    },
    newHandler(url) {
      const options = msgPtr(classes.NSDictionary, sels.dictionary)
      const allocated = msgPtr(classes.VNImageRequestHandler, sels.alloc)
      return allocated ? msgObjObj(allocated, sels['initWithURL:options:'], url, options) : null
    },
    newTextRequest() {
      const allocated = msgPtr(classes.VNRecognizeTextRequest, sels.alloc)
      return allocated ? msgPtr(allocated, sels.init) : null
    },
    supportedLanguages(request) {
      if (!msgBoolObj(request, sels['respondsToSelector:'], sels['supportedRecognitionLanguagesAndReturnError:'])) return []
      const list = msgObj(request, sels['supportedRecognitionLanguagesAndReturnError:'], null)
      if (!list) return []
      const out: string[] = []
      const total = count(list)
      for (let i = 0; i < total; i++) out.push(jsString(msgAt(list, sels['objectAtIndex:'], i)))
      return out
    },
    configure(request, options) {
      msgVoidLong(request, sels['setRecognitionLevel:'], options.level)
      msgVoidBool(request, sels['setUsesLanguageCorrection:'], options.languageCorrection)
      if (options.languages.length === 0) return
      const list = msgPtr(classes.NSMutableArray, sels.array)
      for (const lang of options.languages) {
        const ns = nsString(lang)
        if (ns) msgVoidObj(list, sels['addObject:'], ns)
      }
      msgVoidObj(request, sels['setRecognitionLanguages:'], list)
    },
    perform(handler, request) {
      const requests = msgObj(classes.NSArray, sels['arrayWithObject:'], request)
      return !!requests && !!msgBoolObjObj(handler, sels['performRequests:error:'], requests, null)
    },
    results(request) {
      return msgPtr(request, sels.results)
    },
    count,
    at(array, index) {
      return msgAt(array, sels['objectAtIndex:'], index)
    },
    topCandidate(observation) {
      const candidates = msgAt(observation, sels['topCandidates:'], 1)
      return candidates && count(candidates) > 0 ? msgPtr(candidates, sels.firstObject) : null
    },
    candidateString(candidate) {
      return jsString(msgPtr(candidate, sels.string))
    },
    release(obj) {
      if (obj) msgVoid(obj, sels.release)
    }
  }
}

function runWorker(): void {
  const port = parentPort
  if (!port) return
  let objc: VisionObjc | null = null
  port.on('message', (job: OcrJob) => {
    const started = Date.now()
    try {
      objc ??= createVisionObjc()
      const text = recognizeText(objc, job.path)
      const reply: OcrReply = text === null
        ? { id: job.id, ok: false, error: 'recognition failed' }
        : { id: job.id, ok: true, text, ms: Date.now() - started }
      port.postMessage(reply)
    } catch (err) {
      port.postMessage({ id: job.id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies OcrReply)
    }
  })
}

if (!isMainThread && (workerData as { role?: string } | null)?.role === OCR_WORKER_ROLE) runWorker()
