/** 回路図で自動採番する信号ネットは n10 から（n1–n9 は手動ラベル用に残す）。 */
export const AUTO_NET_START = 10

export function parseNetIndex(name: string): number | null {
  const m = name.match(/^n(\d+)$/)
  return m ? parseInt(m[1], 10) : null
}

export function maxNumericNetIndex(names: Iterable<string>): number {
  let max = 0
  for (const name of names) {
    const idx = parseNetIndex(name)
    if (idx !== null) max = Math.max(max, idx)
  }
  return max
}

/** used に無い n10, n11, … を返す。 */
export function nextAutoNetName(
  used: Set<string>,
  cursor: { value: number },
): string {
  while (used.has(`n${cursor.value}`)) cursor.value += 1
  const name = `n${cursor.value++}`
  used.add(name)
  return name
}

/** 既存ラベルから次に使う n 番号（新規 net_label 用）。 */
export function nextManualNetName(existing: Iterable<string>): string {
  return `n${Math.max(AUTO_NET_START, maxNumericNetIndex(existing) + 1)}`
}
