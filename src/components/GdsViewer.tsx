import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Download,
  ExternalLink,
  Layers,
  Loader2,
  Maximize,
  Minus,
  Plus,
  Printer,
} from 'lucide-react'
import { messages } from '../i18n'
import {
  Camera,
  TileCache,
  fetchLayoutView,
  imageUrl,
  layerMask,
  niceStep,
  tileUrl,
  type LayoutViewInfo,
} from '../lib/layoutView'

const COMBINED_GDS_URL = `${import.meta.env.BASE_URL}generated/combined.gds`
const COMBINED_FORFAB_GDS_URL = `${import.meta.env.BASE_URL}generated/combined_forfab.gds`

type DownloadKind = 'preview' | 'fab'

/** Sync Layout より控えめなセカンダリツールバーボタン */
const TOOLBAR_BTN =
  'flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-[12px] font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40'

/** キャンバス上に重ねる小さなボタン */
const CANVAS_BTN =
  'flex h-8 w-8 items-center justify-center rounded-md border border-on-navy/15 bg-ax-navy/85 text-on-navy/80 transition-colors hover:bg-ax-navy hover:text-on-navy'

/** 拡大の上限: 1 CSS ピクセルあたり 0.005 µm */
const MIN_SCALE_UM = 0.005
/** 印刷・別タブ用の画像の最大辺（サーバ側の上限と同じ） */
const MAX_IMAGE_PX = 4096

type GdsViewerProps = {
  /** レイアウト更新のたびに変わる番号（変わったら表示を読み直す） */
  revision?: number
}

export function GdsViewer({ revision = 0 }: GdsViewerProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const camRef = useRef(new Camera())
  const fittedRef = useRef(false)
  const infoRef = useRef<LayoutViewInfo | null>(null)
  const prevRevisionRef = useRef<number | null>(null)
  const hiddenRef = useRef<Set<number>>(new Set())
  const frameRef = useRef(0)
  const drawRef = useRef<() => void>(() => {})
  const cacheRef = useRef<TileCache | null>(null)

  const [info, setInfo] = useState<LayoutViewInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hidden, setHidden] = useState<Set<number>>(new Set())
  const [showLayers, setShowLayers] = useState(false)
  const [cursor, setCursor] = useState<[number, number] | null>(null)
  const [scaleBar, setScaleBar] = useState<{ px: number; label: string } | null>(null)
  const [downloading, setDownloading] = useState<DownloadKind | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const requestDraw = useCallback(() => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      drawRef.current()
    })
  }, [])

  // タイルキャッシュは表示している間だけ持つ（読み込みが終わるたびに描き直す）
  useEffect(() => {
    const cache = new TileCache(requestDraw)
    cacheRef.current = cache
    requestDraw()
    return () => {
      cache.clear()
      cacheRef.current = null
    }
  }, [requestDraw])

  // ---------------------------------------------------------------- 描画

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const cam = camRef.current
    const cur = infoRef.current
    const cache = cacheRef.current
    if (!canvas || !cache) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = cur?.background ?? '#0b0f14'
    ctx.fillRect(0, 0, cam.w, cam.h)
    if (!cur) return

    const { dbu, tile_px: tilePx, bbox } = cur
    const mask = layerMask(cur.layers.length, hiddenRef.current)
    // 必要な解像度より細かい（または同じ）レベルを選ぶ
    const dbuPerDevicePx = cam.s / dbu / dpr
    const level = Math.max(0, Math.min(30, Math.floor(Math.log2(Math.max(1, dbuPerDevicePx)))))
    const tileDbu = tilePx * 2 ** level
    const [vx0, vy0, vx1, vy1] = cam.view()
    // チップの外側のタイルは要求しない
    const x0 = Math.max(vx0 / dbu, bbox[0])
    const y0 = Math.max(vy0 / dbu, bbox[1])
    const x1 = Math.min(vx1 / dbu, bbox[2])
    const y1 = Math.min(vy1 / dbu, bbox[3])
    const wanted = new Set<string>()
    ctx.imageSmoothingEnabled = true

    const drawTile = (
      img: HTMLImageElement,
      lvl: number,
      tx: number,
      ty: number,
      clip: [number, number, number, number],
    ) => {
      // clip: 描きたい範囲（dbu）。親（粗い）タイルから部分だけ切り出して描くときに使う
      const w = tilePx * 2 ** lvl
      const [cx0, cy0, cx1, cy1] = clip
      const sx = ((cx0 - tx * w) / w) * img.naturalWidth
      const sy = ((ty * w + w - cy1) / w) * img.naturalHeight
      const sw = ((cx1 - cx0) / w) * img.naturalWidth
      const sh = ((cy1 - cy0) / w) * img.naturalHeight
      const [dx0, dy0] = cam.toScreen(cx0 * dbu, cy1 * dbu)
      const [dx1, dy1] = cam.toScreen(cx1 * dbu, cy0 * dbu)
      ctx.drawImage(img, sx, sy, sw, sh, dx0, dy0, dx1 - dx0, dy1 - dy0)
    }

    if (x1 > x0 && y1 > y0) {
      const ix0 = Math.floor(x0 / tileDbu)
      const ix1 = Math.floor((x1 - 1e-9) / tileDbu)
      const iy0 = Math.floor(y0 / tileDbu)
      const iy1 = Math.floor((y1 - 1e-9) / tileDbu)
      for (let iy = iy0; iy <= iy1; iy++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const url = tileUrl(level, ix, iy, cur.revision, mask)
          wanted.add(url)
          const img = cache.get(url, true)
          const box: [number, number, number, number] = [
            ix * tileDbu,
            iy * tileDbu,
            (ix + 1) * tileDbu,
            (iy + 1) * tileDbu,
          ]
          if (img) {
            drawTile(img, level, ix, iy, box)
            continue
          }
          // 読み込み中: 前のリビジョンの同じタイル、なければ粗いレベルのタイルで仮に埋める
          const prev = prevRevisionRef.current
          const old = prev !== null ? cache.get(tileUrl(level, ix, iy, prev, mask), false) : null
          if (old) {
            drawTile(old, level, ix, iy, box)
            continue
          }
          for (let up = 1; up <= 6; up++) {
            const pl = level + up
            const pw = tilePx * 2 ** pl
            const px = Math.floor(box[0] / pw)
            const py = Math.floor(box[1] / pw)
            const parent = cache.get(tileUrl(pl, px, py, cur.revision, mask), false)
            if (parent) {
              drawTile(parent, pl, px, py, box)
              break
            }
          }
        }
      }
    }
    cache.pump(wanted)

    // スケールバー
    const step = niceStep(cam.s * 80)
    setScaleBar((prev) => {
      const px = step / cam.s
      const label = step >= 1000 ? `${step / 1000} mm` : step >= 1 ? `${step} µm` : `${step * 1000} nm`
      return prev && prev.label === label && Math.abs(prev.px - px) < 0.5 ? prev : { px, label }
    })
  }, [])

  useEffect(() => {
    drawRef.current = draw
  }, [draw])

  const chipBoxUm = useCallback((): [number, number, number, number] | null => {
    const cur = infoRef.current
    if (!cur) return null
    const [l, b, r, t] = cur.bbox
    return [l * cur.dbu, b * cur.dbu, r * cur.dbu, t * cur.dbu]
  }, [])

  const fit = useCallback(() => {
    const box = chipBoxUm()
    if (!box) return
    camRef.current.fit(box)
    requestDraw()
  }, [chipBoxUm, requestDraw])

  // ---------------------------------------------------------------- 読み込み

  useEffect(() => {
    let cancelled = false
    fetchLayoutView()
      .then((next) => {
        if (cancelled) return
        const before = infoRef.current
        if (before && before.revision !== next.revision) prevRevisionRef.current = before.revision
        infoRef.current = next
        setInfo(next)
        setLoadError(null)
        // 同じチップを同期し直しただけなら、拡大位置はそのまま
        const sameChip =
          before !== null && before.bbox.every((v, i) => v === next.bbox[i])
        if (!fittedRef.current || !sameChip) {
          fittedRef.current = true
          const [l, b, r, t] = next.bbox
          camRef.current.fit([l * next.dbu, b * next.dbu, r * next.dbu, t * next.dbu])
        }
        requestDraw()
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [revision, requestDraw])

  // キャンバスの大きさを親に合わせる
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const resize = () => {
      const r = wrap.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const cam = camRef.current
      cam.w = Math.max(1, r.width)
      cam.h = Math.max(1, r.height)
      canvas.width = Math.round(cam.w * dpr)
      canvas.height = Math.round(cam.h * dpr)
      canvas.style.width = `${cam.w}px`
      canvas.style.height = `${cam.h}px`
      if (!fittedRef.current && infoRef.current) {
        fittedRef.current = true
        fit()
      }
      requestDraw()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    resize()
    return () => ro.disconnect()
  }, [fit, requestDraw])

  useEffect(
    () => () => {
      // 取り消した予約の印も消す（残ると以後の描画要求がすべて捨てられる）
      cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
    },
    [],
  )

  // ---------------------------------------------------------------- 操作

  const zoomBy = useCallback(
    (factor: number, sx?: number, sy?: number) => {
      const cam = camRef.current
      const box = chipBoxUm()
      const maxS = box ? (Math.max(box[2] - box[0], box[3] - box[1]) / Math.min(cam.w, cam.h)) * 4 : 1e6
      cam.zoomAt(sx ?? cam.w / 2, sy ?? cam.h / 2, factor, MIN_SCALE_UM, maxS)
      requestDraw()
    },
    [chipBoxUm, requestDraw],
  )

  // wheel は passive: false で登録しないとページがスクロールする
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = canvas.getBoundingClientRect()
      zoomBy(Math.exp(e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  const drag = useRef<{ x: number; y: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.button !== 1) return
    drag.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const [wx, wy] = camRef.current.toWorld(e.clientX - r.left, e.clientY - r.top)
    setCursor([wx, wy])
    if (!drag.current) return
    camRef.current.pan(e.clientX - drag.current.x, e.clientY - drag.current.y)
    drag.current = { x: e.clientX, y: e.clientY }
    requestDraw()
  }

  const onPointerUp = () => {
    drag.current = null
  }

  const toggleLayer = (id: number) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      hiddenRef.current = next
      return next
    })
    requestDraw()
  }

  // ---------------------------------------------------------------- 画像・ダウンロード

  /** 今見えている範囲を、画面の 2 倍の解像度で描いた画像の URL */
  const currentViewImageUrl = (): string | null => {
    const cur = infoRef.current
    const cam = camRef.current
    if (!cur) return null
    const scale = Math.min(2, MAX_IMAGE_PX / Math.max(cam.w, cam.h))
    return imageUrl(
      cam.view(),
      cam.w * scale,
      cam.h * scale,
      cur.revision,
      layerMask(cur.layers.length, hiddenRef.current),
    )
  }

  const downloadGdsFile = async (
    kind: DownloadKind,
    url: string,
    filename: string,
    missingMessage: string,
  ) => {
    setDownloading(kind)
    setActionError(null)
    try {
      const res = await fetch(`${url}?v=${revision}`)
      if (!res.ok) {
        throw new Error(missingMessage)
      }
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(objectUrl)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setDownloading(null)
    }
  }

  const handlePrint = () => {
    setActionError(null)
    const src = currentViewImageUrl()
    if (!src) {
      setActionError(messages.gds.imageFailed)
      return
    }
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      setActionError(messages.gds.popupBlocked)
      return
    }
    const stamp = new Date().toLocaleString(messages.htmlLang)
    const absolute = new URL(src, window.location.href).href
    printWindow.document.write(`<!DOCTYPE html>
<html lang="${messages.htmlLang}">
<head>
<meta charset="utf-8" />
<title>${messages.gds.printDocumentTitle}</title>
<style>
  @page { margin: 10mm; }
  body { margin: 0; font-family: system-ui, sans-serif; }
  header { display: flex; justify-content: space-between; align-items: baseline;
           padding-bottom: 4mm; border-bottom: 1px solid #ccc; margin-bottom: 4mm; }
  h1 { font-size: 14px; margin: 0; }
  .meta { font-size: 10px; color: #666; }
  img { width: 100%; height: auto; display: block; }
</style>
</head>
<body>
<header>
  <h1>${messages.gds.printHeading}</h1>
  <span class="meta">${stamp}</span>
</header>
<img src="${absolute}" alt="Layout" onload="window.focus(); window.print();" />
</body>
</html>`)
    printWindow.document.close()
  }

  const handleOpenInNewTab = () => {
    setActionError(null)
    const src = currentViewImageUrl()
    if (!src) return
    if (!window.open(src, '_blank', 'noopener')) setActionError(messages.gds.popupBlocked)
  }

  // ---------------------------------------------------------------- 表示

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-surface-muted">
      <div className="flex h-10 shrink-0 items-center justify-end gap-2 border-b border-hairline bg-surface px-2">
        {actionError && (
          <span className="mr-auto max-w-[280px] truncate text-[11px] text-danger" title={actionError}>
            {actionError}
          </span>
        )}
        <button
          type="button"
          disabled={downloading !== null}
          onClick={() =>
            void downloadGdsFile(
              'preview',
              COMBINED_GDS_URL,
              'layout.gds',
              messages.gds.missingCombined,
            )
          }
          className={TOOLBAR_BTN}
          title={messages.gds.downloadTitle}
        >
          {downloading === 'preview' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          {messages.gds.downloadGds}
        </button>
        <button
          type="button"
          disabled={downloading !== null}
          onClick={() =>
            void downloadGdsFile(
              'fab',
              COMBINED_FORFAB_GDS_URL,
              'layout_forfab.gds',
              messages.gds.missingCombinedForFab,
            )
          }
          className={TOOLBAR_BTN}
          title={messages.gds.downloadFabTitle}
        >
          {downloading === 'fab' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          {messages.gds.downloadFab}
        </button>
        <button
          type="button"
          onClick={handlePrint}
          disabled={!info}
          className={TOOLBAR_BTN}
          title={messages.gds.printTitle}
        >
          <Printer className="h-3.5 w-3.5" />
          {messages.gds.print}
        </button>
        <button
          type="button"
          onClick={handleOpenInNewTab}
          disabled={!info}
          className={TOOLBAR_BTN}
          title={messages.gds.openInNewTabTitle}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {messages.gds.openInNewTab}
        </button>
      </div>

      <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 touch-none cursor-grab active:cursor-grabbing"
          aria-label={messages.gds.canvasLabel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => setCursor(null)}
          onDoubleClick={fit}
        />

        {!info && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-on-navy/75">
            {loadError ? (
              <span className="max-w-[80%] text-center text-danger">
                {messages.gds.viewFailed(loadError)}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {messages.gds.viewLoading}
              </span>
            )}
          </div>
        )}

        <div className="absolute right-2 top-2 flex flex-col gap-1">
          <button type="button" className={CANVAS_BTN} title={messages.gds.zoomIn} onClick={() => zoomBy(1 / 1.6)}>
            <Plus className="h-4 w-4" />
          </button>
          <button type="button" className={CANVAS_BTN} title={messages.gds.zoomOut} onClick={() => zoomBy(1.6)}>
            <Minus className="h-4 w-4" />
          </button>
          <button type="button" className={CANVAS_BTN} title={messages.gds.fit} onClick={fit}>
            <Maximize className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={`${CANVAS_BTN} ${showLayers ? '!bg-accent !text-on-navy' : ''}`}
            title={messages.gds.layers}
            aria-pressed={showLayers}
            onClick={() => setShowLayers((v) => !v)}
          >
            <Layers className="h-4 w-4" />
          </button>
        </div>

        {showLayers && info && (
          <div className="absolute right-11 top-2 max-h-[calc(100%-1rem)] w-60 overflow-auto rounded-md border border-on-navy/15 bg-ax-navy/95 p-2 text-[12px] text-on-navy/90">
            <div className="mb-1 px-1 text-[11px] font-semibold text-on-navy/60">
              {messages.gds.layers}
            </div>
            {info.layers.map((layer) => (
              <label
                key={layer.id}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-on-navy/10"
              >
                <input
                  type="checkbox"
                  checked={!hidden.has(layer.id)}
                  onChange={() => toggleLayer(layer.id)}
                />
                <img
                  src={`data:image/png;base64,${layer.icon}`}
                  alt=""
                  className="h-4 w-7 shrink-0 rounded-sm"
                />
                <span className="min-w-0 flex-1 truncate">{layer.name}</span>
                <span className="font-mono text-[11px] text-on-navy/50">{layer.source}</span>
              </label>
            ))}
          </div>
        )}

        <div className="pointer-events-none absolute bottom-2 left-2 flex items-end gap-3 font-mono text-[11px] text-on-navy/85">
          {scaleBar && (
            <div className="flex flex-col items-start">
              <span>{scaleBar.label}</span>
              <span
                className="mt-0.5 block h-1.5 border-x border-b border-on-navy/80"
                style={{ width: `${scaleBar.px}px` }}
              />
            </div>
          )}
          {cursor && (
            <span>
              x {cursor[0].toFixed(1)} µm · y {cursor[1].toFixed(1)} µm
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
