import { Position } from '@xyflow/react'
import type { CircuitEdge, CircuitNode } from './types'
import { GRID, symbolGeom, type PinGeom, type Rect } from './symbols'

/**
 * 回路図の直交配線（xschem / Undine 風）。
 *
 * - 各ワイヤはピンの向きに 1 グリッド引き出してから水平・垂直の折れ線で結ぶ
 * - 候補経路を採点して選ぶ: 長さ・折れ数・部品本体の横断・他ネットとの
 *   重なり／接触を減点、同一ネットの既存ワイヤとの共有は加点（木状にまとまる）
 * - 接続点（ジャンクション）は同一ネット内で 3 方向以上の線が集まる点。
 *   異なるネットの交差には丸を付けないので、丸の有無で接続／交差を区別できる
 */

export type Pt = [number, number]

export type WireRoute = {
  points: Pt[]
  /** このワイヤが描画を受け持つ接続点 */
  junctions: Pt[]
}

type Terminal = { x: number; y: number; dir: Position }

type Seg = {
  x1: number
  y1: number
  x2: number
  y2: number
  net: string
}

const STUB = GRID
const MAX_CHANNELS = 8

const STEP: Record<Position, Pt> = {
  [Position.Left]: [-1, 0],
  [Position.Right]: [1, 0],
  [Position.Top]: [0, -1],
  [Position.Bottom]: [0, 1],
}

const COST_BEND = 12
const COST_BODY = 2000
const COST_OVERLAP = 600
const COST_TOUCH = 300
const COST_CROSS = 6
const SHARE_BONUS = 0.9

function pinKey(nodeId: string, handle: string): string {
  return `${nodeId}:${handle}`
}

function terminalOf(node: CircuitNode, handle: string | null | undefined): Terminal | null {
  if (!handle) return null
  const pin: PinGeom | undefined = symbolGeom(node.data).pins[handle]
  if (!pin) return null
  return { x: node.position.x + pin.x, y: node.position.y + pin.y, dir: pin.dir }
}

/** 辺の両端ピンを union-find で束ね、描画上のネット（連結成分）を求める。 */
function edgeNets(edges: CircuitEdge[]) {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!
    parent.set(x, r)
    return r
  }
  for (const e of edges) {
    if (!e.sourceHandle || !e.targetHandle) continue
    const a = find(pinKey(e.source, e.sourceHandle))
    const b = find(pinKey(e.target, e.targetHandle))
    if (a !== b) parent.set(b, a)
  }
  const byEdge = new Map<string, string>()
  for (const e of edges) {
    if (e.sourceHandle) byEdge.set(e.id, find(pinKey(e.source, e.sourceHandle)))
  }
  return { byEdge, ofPin: find }
}

type PinPoint = { x: number; y: number; net: string }

const midChannel = (p: number, q: number) => Math.round((p + q) / 2 / GRID) * GRID

function channels(p: number, q: number): number[] {
  const lo = Math.floor((Math.min(p, q) - 4 * GRID) / GRID)
  const hi = Math.ceil((Math.max(p, q) + 4 * GRID) / GRID)
  const step = Math.max(1, Math.ceil((hi - lo + 1) / MAX_CHANNELS))
  const out: number[] = []
  for (let i = lo; i <= hi; i += step) out.push(i * GRID)
  return out
}

/**
 * 連続する重複点・同一直線上の中間点を除く。
 * 直線上で折り返す（来た線を戻る）経路は不正として null。
 */
function simplify(points: Pt[]): Pt[] | null {
  const out: Pt[] = []
  for (const p of points) {
    const n = out.length
    const b = out[n - 1]
    if (b && b[0] === p[0] && b[1] === p[1]) continue
    const a = out[n - 2]
    if (a && ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1]))) {
      if ((b[0] - a[0]) * (p[0] - b[0]) + (b[1] - a[1]) * (p[1] - b[1]) < 0) return null
      out[n - 1] = p
    } else {
      out.push(p)
    }
  }
  return out
}

/**
 * 候補経路。sweep=false は直結・L 字・中央で折る Z 字だけ（大半はこれで足りる）、
 * sweep=true は折り位置を広く振って障害物・他ネットを避ける。
 */
function candidates(
  a: Terminal,
  b: Terminal,
  sweep: boolean,
  around: { xs: number[]; ys: number[] } = { xs: [], ys: [] },
): Pt[][] {
  const [adx, ady] = STEP[a.dir]
  const [bdx, bdy] = STEP[b.dir]
  const a0: Pt = [a.x, a.y]
  const b0: Pt = [b.x, b.y]
  const a1: Pt = [a.x + adx * STUB, a.y + ady * STUB]
  const b1: Pt = [b.x + bdx * STUB, b.y + bdy * STUB]
  const mids: Pt[][] = []
  if (sweep) {
    for (const m of [...channels(a1[0], b1[0]), ...around.xs]) mids.push([[m, a1[1]], [m, b1[1]]])
    for (const m of [...channels(a1[1], b1[1]), ...around.ys]) mids.push([[a1[0], m], [b1[0], m]])
  } else {
    const mx = midChannel(a1[0], b1[0])
    const my = midChannel(a1[1], b1[1])
    mids.push([[b1[0], a1[1]]], [[a1[0], b1[1]]], [[mx, a1[1]], [mx, b1[1]]], [[a1[0], my], [b1[0], my]])
  }

  const out: Pt[][] = []
  // 向かい合うピンが一直線上にあれば引き出しなしで直結
  const direct = simplify([a0, b0])
  if (
    direct &&
    (a.x === b.x || a.y === b.y) &&
    (b.x - a.x) * adx + (b.y - a.y) * ady > 0 &&
    (a.x - b.x) * bdx + (a.y - b.y) * bdy > 0
  ) {
    out.push(direct)
  }
  for (const mid of mids) {
    const path = simplify([a0, a1, ...mid, b1, b0])
    if (path) out.push(path)
  }
  return out
}

function toSegs(points: Pt[], net: string): Seg[] {
  const segs: Seg[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[i + 1]
    segs.push({ x1, y1, x2, y2, net })
  }
  return segs
}

const isH = (s: Seg) => s.y1 === s.y2

function onSeg(x: number, y: number, s: Seg): boolean {
  return (
    x >= Math.min(s.x1, s.x2) &&
    x <= Math.max(s.x1, s.x2) &&
    y >= Math.min(s.y1, s.y2) &&
    y <= Math.max(s.y1, s.y2) &&
    (isH(s) ? y === s.y1 : x === s.x1)
  )
}

function overlapLen(a: Seg, b: Seg): number {
  if (isH(a) !== isH(b)) return 0
  if (isH(a)) {
    if (a.y1 !== b.y1) return 0
    const lo = Math.max(Math.min(a.x1, a.x2), Math.min(b.x1, b.x2))
    const hi = Math.min(Math.max(a.x1, a.x2), Math.max(b.x1, b.x2))
    return Math.max(0, hi - lo)
  }
  if (a.x1 !== b.x1) return 0
  const lo = Math.max(Math.min(a.y1, a.y2), Math.min(b.y1, b.y2))
  const hi = Math.min(Math.max(a.y1, a.y2), Math.max(b.y1, b.y2))
  return Math.max(0, hi - lo)
}

/** 直交する 2 線分が互いの内部で交わる（端点を含まない） */
function crossesInterior(a: Seg, b: Seg): boolean {
  if (isH(a) === isH(b)) return false
  const h = isH(a) ? a : b
  const v = isH(a) ? b : a
  return (
    v.x1 > Math.min(h.x1, h.x2) &&
    v.x1 < Math.max(h.x1, h.x2) &&
    h.y1 > Math.min(v.y1, v.y2) &&
    h.y1 < Math.max(v.y1, v.y2)
  )
}

function hitsRect(s: Seg, r: Rect): boolean {
  const x0 = r.x + 1
  const x1 = r.x + r.w - 1
  const y0 = r.y + 1
  const y1 = r.y + r.h - 1
  if (isH(s)) {
    return s.y1 > y0 && s.y1 < y1 && Math.max(s.x1, s.x2) > x0 && Math.min(s.x1, s.x2) < x1
  }
  return s.x1 > x0 && s.x1 < x1 && Math.max(s.y1, s.y2) > y0 && Math.min(s.y1, s.y2) < y1
}

type Box = { x0: number; y0: number; x1: number; y1: number }

function boxOf(points: Pt[], margin: number): Box {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  return {
    x0: Math.min(...xs) - margin,
    y0: Math.min(...ys) - margin,
    x1: Math.max(...xs) + margin,
    y1: Math.max(...ys) + margin,
  }
}

function segInBox(s: Seg, b: Box): boolean {
  return (
    Math.max(s.x1, s.x2) >= b.x0 &&
    Math.min(s.x1, s.x2) <= b.x1 &&
    Math.max(s.y1, s.y2) >= b.y0 &&
    Math.min(s.y1, s.y2) <= b.y1
  )
}

function rectInBox(r: Rect, b: Box): boolean {
  return r.x + r.w >= b.x0 && r.x <= b.x1 && r.y + r.h >= b.y0 && r.y <= b.y1
}

function score(
  path: Pt[],
  net: string,
  bodies: Rect[],
  pins: PinPoint[],
  routed: Seg[],
): number {
  const segs = toSegs(path, net)
  let cost = (path.length - 2) * COST_BEND
  for (const s of segs) {
    cost += Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1)
    for (const r of bodies) if (hitsRect(s, r)) cost += COST_BODY
    // 他ネットのピンを通過すると、そのピンにつながって見える
    for (const p of pins) if (p.net !== net && onSeg(p.x, p.y, s)) cost += COST_TOUCH
    for (const o of routed) {
      const ov = overlapLen(s, o)
      if (o.net === net) {
        cost -= ov * SHARE_BONUS
        continue
      }
      if (ov > 0) {
        cost += COST_OVERLAP + ov * 10
      } else if (crossesInterior(s, o)) {
        cost += COST_CROSS
      } else if (
        onSeg(s.x1, s.y1, o) ||
        onSeg(s.x2, s.y2, o) ||
        onSeg(o.x1, o.y1, s) ||
        onSeg(o.x2, o.y2, s)
      ) {
        // 角や端点が他ネットの線に乗ると接続と見分けにくい
        cost += COST_TOUCH
      }
    }
  }
  return cost
}

function rayKey(dx: number, dy: number): string {
  return `${Math.sign(dx)},${Math.sign(dy)}`
}

function findJunctions(segs: Seg[], pins: Terminal[]): Pt[] {
  const points = new Map<string, Pt>()
  for (const s of segs) {
    points.set(`${s.x1},${s.y1}`, [s.x1, s.y1])
    points.set(`${s.x2},${s.y2}`, [s.x2, s.y2])
  }
  const out: Pt[] = []
  for (const [x, y] of points.values()) {
    const rays = new Set<string>()
    for (const s of segs) {
      if (!onSeg(x, y, s)) continue
      if (s.x1 !== x || s.y1 !== y) rays.add(rayKey(s.x1 - x, s.y1 - y))
      if (s.x2 !== x || s.y2 !== y) rays.add(rayKey(s.x2 - x, s.y2 - y))
    }
    // ピン位置ではシンボル側への引き出し線も 1 方向として数える
    for (const p of pins) {
      if (p.x === x && p.y === y) {
        const [dx, dy] = STEP[p.dir]
        rays.add(rayKey(-dx, -dy))
      }
    }
    if (rays.size >= 3) out.push([x, y])
  }
  return out
}

/** 配線計算の共通データ（部品外形・ピン位置・描画上のネット） */
type Scene = {
  byId: Map<string, CircuitNode>
  nets: ReturnType<typeof edgeNets>
  bodies: Rect[]
  pinPoints: PinPoint[]
}

function buildScene(nodes: CircuitNode[], edges: CircuitEdge[]): Scene {
  const nets = edgeNets(edges)
  const bodies: Rect[] = []
  const pinPoints: PinPoint[] = []
  for (const n of nodes) {
    const g = symbolGeom(n.data)
    bodies.push({ x: n.position.x, y: n.position.y, w: g.width, h: g.height })
    for (const [handle, pin] of Object.entries(g.pins)) {
      const net = nets.ofPin(pinKey(n.id, handle))
      const x = n.position.x + pin.x
      const y = n.position.y + pin.y
      const [dx, dy] = STEP[pin.dir]
      // ピンと引き出し線の先端。そのピンのワイヤは必ずここを通るので他ネットは避ける
      pinPoints.push({ x, y, net }, { x: x + dx * STUB, y: y + dy * STUB, net })
    }
  }
  return { byId: new Map(nodes.map((n) => [n.id, n])), nets, bodies, pinPoints }
}

/** 1 本のワイヤの最良経路（まず単純な形、ぶつかる場合だけ折り位置を広く探す） */
function bestRoute(
  scene: Scene,
  routed: Seg[],
  a: Terminal,
  b: Terminal,
  net: string,
): { path: Pt[]; cost: number } | null {
  // 近くの部品を回り込む折り位置（外形の 2 グリッド外側。1 グリッド外側はピンの引き出し先）
  const around = () => {
    const m = 8 * GRID
    const box = {
      x0: Math.min(a.x, b.x) - m,
      y0: Math.min(a.y, b.y) - m,
      x1: Math.max(a.x, b.x) + m,
      y1: Math.max(a.y, b.y) + m,
    }
    const xs: number[] = []
    const ys: number[] = []
    for (const r of scene.bodies) {
      if (!rectInBox(r, box)) continue
      xs.push(r.x - 2 * GRID, r.x + r.w + 2 * GRID)
      ys.push(r.y - 2 * GRID, r.y + r.h + 2 * GRID)
    }
    return { xs: [...new Set(xs)], ys: [...new Set(ys)] }
  }
  const pick = (sweep: boolean) => {
    const cands = candidates(a, b, sweep, sweep ? around() : undefined)
    if (cands.length === 0) return null
    const box = boxOf(cands.flat(), GRID)
    const nearBodies = scene.bodies.filter((r) => rectInBox(r, box))
    const nearPins = scene.pinPoints.filter(
      (p) => p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1,
    )
    const nearSegs = routed.filter((s) => segInBox(s, box))
    let best = { path: cands[0], cost: Infinity }
    for (const path of cands) {
      const cost = score(path, net, nearBodies, nearPins, nearSegs)
      if (cost < best.cost) best = { path, cost }
    }
    return best
  }
  const dist = Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
  let best = pick(false)
  if (!best || best.cost - dist >= COST_TOUCH) {
    const swept = pick(true)
    if (swept && (!best || swept.cost < best.cost)) best = swept
  }
  return best
}

export function routeWires(
  nodes: CircuitNode[],
  edges: CircuitEdge[],
): Map<string, WireRoute> {
  const scene = buildScene(nodes, edges)
  const { byId, nets } = scene

  type Job = { edge: CircuitEdge; a: Terminal; b: Terminal; net: string; dist: number }
  const jobs: Job[] = []
  for (const edge of edges) {
    const sn = byId.get(edge.source)
    const tn = byId.get(edge.target)
    const a = sn && terminalOf(sn, edge.sourceHandle)
    const b = tn && terminalOf(tn, edge.targetHandle)
    if (!a || !b) continue
    jobs.push({
      edge,
      a,
      b,
      net: nets.byEdge.get(edge.id) ?? edge.id,
      dist: Math.abs(a.x - b.x) + Math.abs(a.y - b.y),
    })
  }
  // 短いワイヤから確定させると、近接ピン同士が素直な直線になりやすい
  jobs.sort((p, q) => p.dist - q.dist)

  const routed: Seg[] = []
  const paths = new Map<string, { points: Pt[]; net: string }>()
  for (const job of jobs) {
    const best = bestRoute(scene, routed, job.a, job.b, job.net)
    if (!best) continue
    paths.set(job.edge.id, { points: best.path, net: job.net })
    routed.push(...toSegs(best.path, job.net))
  }

  // ネットごとに接続点を求め、その点を通る最初のワイヤに描画させる
  type NetWires = { segs: Seg[]; owners: { id: string; segs: Seg[] }[]; pins: Map<string, Terminal> }
  const byNet = new Map<string, NetWires>()
  const result = new Map<string, WireRoute>()
  for (const job of jobs) {
    const path = paths.get(job.edge.id)
    if (!path) continue
    result.set(job.edge.id, { points: path.points, junctions: [] })
    let w = byNet.get(job.net)
    if (!w) {
      w = { segs: [], owners: [], pins: new Map() }
      byNet.set(job.net, w)
    }
    const segs = toSegs(path.points, job.net)
    w.segs.push(...segs)
    w.owners.push({ id: job.edge.id, segs })
    w.pins.set(`${job.a.x},${job.a.y}`, job.a)
    w.pins.set(`${job.b.x},${job.b.y}`, job.b)
  }
  for (const w of byNet.values()) {
    if (w.owners.length < 2 && w.pins.size < 3) continue
    for (const [x, y] of findJunctions(w.segs, [...w.pins.values()])) {
      const owner = w.owners.find((o) => o.segs.some((s) => onSeg(x, y, s)))
      if (owner) result.get(owner.id)!.junctions.push([x, y])
    }
  }
  return result
}

/** どのワイヤにもつながっていないピン（`nodeId:handle`）。 */
export function danglingPins(nodes: CircuitNode[], edges: CircuitEdge[]): string[] {
  const connected = new Set<string>()
  for (const e of edges) {
    if (e.sourceHandle) connected.add(pinKey(e.source, e.sourceHandle))
    if (e.targetHandle) connected.add(pinKey(e.target, e.targetHandle))
  }
  const out: string[] = []
  for (const n of nodes) {
    for (const handle of Object.keys(symbolGeom(n.data).pins)) {
      const key = pinKey(n.id, handle)
      if (!connected.has(key)) out.push(key)
    }
  }
  return out
}

export type PinRef = { nodeId: string; handle: string }

/** 配線ツールでカーソルが指している接続先（ピン優先、次にワイヤ） */
export type WireTarget =
  | { kind: 'pin'; pin: PinRef; point: Pt }
  | { kind: 'wire'; edgeId: string; pin: PinRef; point: Pt }

/**
 * 点 (x, y) から tolerance 以内のピン、なければワイヤを探す。
 * ワイヤを指したときは、そのワイヤ両端のピンのうち近い方を接続先にする（同じネット）。
 */
export function wireTargetAt(
  nodes: CircuitNode[],
  edges: CircuitEdge[],
  routes: Map<string, WireRoute>,
  x: number,
  y: number,
  tolerance: number,
): WireTarget | null {
  let best: WireTarget | null = null
  let bestD = tolerance
  for (const n of nodes) {
    for (const [handle, pin] of Object.entries(symbolGeom(n.data).pins)) {
      const px = n.position.x + pin.x
      const py = n.position.y + pin.y
      const d = Math.hypot(px - x, py - y)
      if (d <= bestD) {
        bestD = d
        best = { kind: 'pin', pin: { nodeId: n.id, handle }, point: [px, py] }
      }
    }
  }
  if (best) return best

  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const e of edges) {
    const pts = routes.get(e.id)?.points
    if (!pts || !e.sourceHandle || !e.targetHandle) continue
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x1, y1] = pts[i]
      const [x2, y2] = pts[i + 1]
      const px = Math.max(Math.min(x1, x2), Math.min(Math.max(x1, x2), x))
      const py = Math.max(Math.min(y1, y2), Math.min(Math.max(y1, y2), y))
      const d = Math.hypot(px - x, py - y)
      if (d > bestD) continue
      const snapped: Pt = x1 === x2 ? [x1, Math.round(py / GRID) * GRID] : [Math.round(px / GRID) * GRID, y1]
      const s = byId.get(e.source)
      const t = byId.get(e.target)
      const sa = s && terminalOf(s, e.sourceHandle)
      const ta = t && terminalOf(t, e.targetHandle)
      if (!sa || !ta) continue
      const nearSource =
        Math.hypot(sa.x - snapped[0], sa.y - snapped[1]) <= Math.hypot(ta.x - snapped[0], ta.y - snapped[1])
      bestD = d
      best = {
        kind: 'wire',
        edgeId: e.id,
        pin: nearSource
          ? { nodeId: e.source, handle: e.sourceHandle }
          : { nodeId: e.target, handle: e.targetHandle },
        point: snapped,
      }
    }
  }
  return best
}

/** 配線中のプレビュー経路。接続先が未定ならカーソル位置（グリッド）まで引く。 */
export function previewWire(
  nodes: CircuitNode[],
  edges: CircuitEdge[],
  routes: Map<string, WireRoute>,
  from: PinRef,
  to: PinRef | Pt,
): Pt[] | null {
  const scene = buildScene(nodes, edges)
  const fromNode = scene.byId.get(from.nodeId)
  const a = fromNode && terminalOf(fromNode, from.handle)
  if (!a) return null
  const net = scene.nets.ofPin(pinKey(from.nodeId, from.handle))
  const routed: Seg[] = []
  for (const e of edges) {
    const pts = routes.get(e.id)?.points
    if (pts) routed.push(...toSegs(pts, scene.nets.byEdge.get(e.id) ?? e.id))
  }

  if (!Array.isArray(to)) {
    const toNode = scene.byId.get(to.nodeId)
    const b = toNode && terminalOf(toNode, to.handle)
    return b ? (bestRoute(scene, routed, a, b, net)?.path ?? null) : null
  }
  // 自由端: 4 方向から近づく経路を試し、いちばん素直なものを選ぶ
  const [x, y] = to
  if (x === a.x && y === a.y) return [[a.x, a.y]]
  let best: { path: Pt[]; cost: number } | null = null
  for (const dir of [Position.Left, Position.Right, Position.Top, Position.Bottom]) {
    const r = bestRoute(scene, routed, a, { x, y, dir }, net)
    if (r && (!best || r.cost < best.cost)) best = r
  }
  return best?.path ?? null
}
