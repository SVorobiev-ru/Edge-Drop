import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs'

export function writeFileAtomicSync(file: string, data: string | Buffer): void {
  const tmp = `${file}.tmp`
  const fd = openSync(tmp, 'w')
  try {
    writeFileSync(fd, data)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  try {
    renameSync(tmp, file)
  } catch {
    try {
      writeFileSync(file, data)
    } finally {
      rmSync(tmp, { force: true })
    }
  }
}
