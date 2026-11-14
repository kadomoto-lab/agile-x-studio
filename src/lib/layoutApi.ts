import { messages } from '../i18n'

export type LayoutSyncResult = {
  status: string
  revision: number
  overlay_gds: string
  combined_gds: string
  combined_forfab_gds: string
  path: string
}

export async function syncLayout(netlist: string): Promise<LayoutSyncResult> {
  let res: Response
  try {
    res = await fetch('/api/layout/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ netlist }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(messages.layoutApi.connectFailed(msg), { cause: err })
  }

  if (!res.ok) {
    const text = await res.text()
    throw new Error(messages.layoutApi.syncFailed(res.status, text))
  }

  return (await res.json()) as LayoutSyncResult
}
