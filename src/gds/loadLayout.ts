import type { GdsLayout } from './types'
import { messages } from '../i18n'

function isGzipBytes(buf: ArrayBuffer): boolean {
  const b = new Uint8Array(buf)
  return b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b
}

async function bytesToText(buf: ArrayBuffer): Promise<string> {
  if (!isGzipBytes(buf)) {
    return new TextDecoder().decode(buf)
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error(messages.loadLayout.gzipUnsupported)
  }
  const stream = new Blob([buf])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
  return await new Response(stream).text()
}

export async function loadGdsLayout(url: string): Promise<GdsLayout> {
  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    const hint = err instanceof Error ? err.message : String(err)
    throw new Error(messages.loadLayout.fetchFailed(hint, url), { cause: err })
  }

  if (!res.ok) {
    throw new Error(messages.loadLayout.notFound(res.status, url))
  }

  const buf = await res.arrayBuffer()
  const json = await bytesToText(buf)
  return JSON.parse(json) as GdsLayout
}
