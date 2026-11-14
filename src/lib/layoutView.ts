/**
 * サーバ側で描いたレイアウトのタイルを表示するための API とキャッシュ。
 *
 * レイアウトは API サーバが KLayout で PNG に描き（/api/layout/tile）、ブラウザは
 * 画像を並べるだけ（Undine と同じ方式）。ブラウザに GPL のコードを配らない。
 *
 * タイル (level, ix, iy) は [ix*W, (ix+1)*W] × [iy*W, (iy+1)*W] dbu を tile_px 四方で描いたもの。
 * W = tile_px * 2^level。
 */

export type LayoutLayer = {
  id: number
  name: string
  source: string
  fill: string
  /** レイヤの見本画像（PNG の base64） */
  icon: string
}

export type LayoutViewInfo = {
  revision: number
  file: string
  dbu: number
  /** [left, bottom, right, top]（dbu） */
  bbox: [number, number, number, number]
  tile_px: number
  background: string
  layers: LayoutLayer[]
}

const API = '/api/layout'

export async function fetchLayoutView(): Promise<LayoutViewInfo> {
  const res = await fetch(`${API}/view`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as LayoutViewInfo
}

/** 表示するレイヤのマスク（16 進、4 レイヤで 1 桁）。全部表示なら undefined。 */
export function layerMask(count: number, hidden: ReadonlySet<number>): string | undefined {
  if (hidden.size === 0) return undefined
  let out = ''
  for (let k = 0; k < Math.ceil(count / 4); k++) {
    let digit = 0
    for (let b = 0; b < 4; b++) {
      const i = k * 4 + b
      if (i < count && !hidden.has(i)) digit |= 1 << b
    }
    out += digit.toString(16)
  }
  return out
}

export function tileUrl(
  level: number,
  ix: number,
  iy: number,
  revision: number,
  mask: string | undefined,
): string {
  const q = new URLSearchParams({ v: String(revision) })
  if (mask) q.set('m', mask)
  return `${API}/tile/${level}/${ix}/${iy}.png?${q}`
}

/** 範囲（µm）を 1 枚の PNG に描いた画像の URL（印刷・別タブ表示用）。 */
export function imageUrl(
  box: [number, number, number, number],
  width: number,
  height: number,
  revision: number,
  mask: string | undefined,
): string {
  const [x0, y0, x1, y1] = box
  const q = new URLSearchParams({
    w: String(Math.round(width)),
    h: String(Math.round(height)),
    x0: x0.toFixed(3),
    y0: y0.toFixed(3),
    x1: x1.toFixed(3),
    y1: y1.toFixed(3),
    v: String(revision),
  })
  if (mask) q.set('m', mask)
  return `${API}/image.png?${q}`
}

// ------------------------------------------------------------------ カメラ

/** 2D カメラ。ワールド座標は µm（y 上向き）。s は 1 CSS ピクセルあたりの µm。 */
export class Camera {
  cx = 0
  cy = 0
  s = 1
  w = 1
  h = 1

  toScreen(x: number, y: number): [number, number] {
    return [(x - this.cx) / this.s + this.w / 2, this.h / 2 - (y - this.cy) / this.s]
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.w / 2) * this.s + this.cx, (this.h / 2 - sy) * this.s + this.cy]
  }

  zoomAt(sx: number, sy: number, factor: number, minS: number, maxS: number): void {
    const [wx, wy] = this.toWorld(sx, sy)
    this.s = Math.min(maxS, Math.max(minS, this.s * factor))
    const [nx, ny] = this.toWorld(sx, sy)
    this.cx += wx - nx
    this.cy += wy - ny
  }

  pan(dx: number, dy: number): void {
    this.cx -= dx * this.s
    this.cy += dy * this.s
  }

  fit(b: [number, number, number, number], margin = 0.03): void {
    const bw = Math.max(1e-9, b[2] - b[0])
    const bh = Math.max(1e-9, b[3] - b[1])
    this.cx = (b[0] + b[2]) / 2
    this.cy = (b[1] + b[3]) / 2
    this.s = Math.max(bw / (this.w * (1 - 2 * margin)), bh / (this.h * (1 - 2 * margin)))
  }

  /** 見えている範囲 [x0, y0, x1, y1]（µm） */
  view(): [number, number, number, number] {
    const [ax, ay] = this.toWorld(0, 0)
    const [bx, by] = this.toWorld(this.w, this.h)
    return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]
  }
}

/** 1, 2, 5 × 10^n のうち min 以上で最小のもの（スケールバー用） */
export function niceStep(min: number): number {
  const e = Math.pow(10, Math.floor(Math.log10(min)))
  for (const m of [1, 2, 5, 10]) if (m * e >= min) return m * e
  return 10 * e
}

// ------------------------------------------------------------------ タイルキャッシュ

type Entry = { img: HTMLImageElement; loaded: boolean; used: number }

const MAX_TILES = 400
const MAX_INFLIGHT = 6

/** 画像タイルのキャッシュ。読み込みが終わるたびに onLoad を呼ぶ（再描画の合図）。 */
export class TileCache {
  private tiles = new Map<string, Entry>()
  private queue: string[] = []
  private inflight = 0
  private clock = 0
  private onLoad: () => void

  constructor(onLoad: () => void) {
    this.onLoad = onLoad
  }

  /** 読み込み済みならその画像、まだなら null（必要なら読み込みを始める） */
  get(url: string, request: boolean): HTMLImageElement | null {
    const e = this.tiles.get(url)
    if (e) {
      e.used = ++this.clock
      return e.loaded ? e.img : null
    }
    if (request && !this.queue.includes(url)) this.queue.push(url)
    return null
  }

  /** 今回の描画で要求したタイルの読み込みを進める（古い要求は捨てる） */
  pump(wanted: Set<string>): void {
    this.queue = this.queue.filter((u) => wanted.has(u))
    while (this.inflight < MAX_INFLIGHT && this.queue.length > 0) {
      const url = this.queue.shift()!
      if (this.tiles.has(url)) continue
      const img = new Image()
      const entry: Entry = { img, loaded: false, used: ++this.clock }
      this.tiles.set(url, entry)
      this.inflight++
      img.onload = () => {
        entry.loaded = true
        this.done()
      }
      img.onerror = () => {
        // 失敗したタイルは捨てて、次の描画で読み直す
        this.tiles.delete(url)
        this.done()
      }
      img.src = url
    }
  }

  private done(): void {
    this.inflight--
    this.evict()
    this.onLoad()
  }

  private evict(): void {
    if (this.tiles.size <= MAX_TILES) return
    const entries = [...this.tiles.entries()].filter(([, e]) => e.loaded)
    entries.sort((a, b) => a[1].used - b[1].used)
    for (const [k] of entries.slice(0, this.tiles.size - MAX_TILES)) this.tiles.delete(k)
  }

  clear(): void {
    this.tiles.clear()
    this.queue = []
  }
}
