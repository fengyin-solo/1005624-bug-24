import type { EntryRow } from './types'

// 水力平衡调节的业务口径集中在这里：开度格式、无效值挡回、重复底稿合并，
// 列表与详情、导出与状态机都从这一份读，避免两处各说各话。

/** 开度的既有调节口径：0~100 的百分数，展示统一带百分号。 */
export function normalizeOpening(raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const text = String(raw ?? '').trim()
  if (text === '') {
    return { ok: false, message: '阀门开度为必填项，请按 0~100 的百分数填写' }
  }
  const numericText = text.endsWith('%') ? text.slice(0, -1).trim() : text
  if (!/^\d+(\.\d+)?$/.test(numericText)) {
    return { ok: false, message: `阀门开度「${text}」无效：只能填 0~100 的数值（可带 %），不能填文字或符号` }
  }
  const value = Number(numericText)
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return { ok: false, message: `阀门开度「${text}」无效：开度必须在 0~100 之间` }
  }
  return { ok: true, value: `${numericText}%` }
}

/** 统一展示口径：存的是什么、列表/详情看到的就是什么，缺值给占位。 */
export function formatOpening(raw: unknown): string {
  const text = String(raw ?? '').trim()
  if (!text) {
    return '—'
  }
  return text.endsWith('%') ? text : `${text}%`
}

/** 同一换热站 + 同一回路视为同一条调节记录，空格差异不算两条。 */
export function loopKey(row: { [field: string]: unknown }): string {
  return `${String(row.换热站 ?? '').trim()}@@${String(row.调节回路 ?? '').trim()}`
}

/**
 * 合并同一条回路上的重复底稿：
 * - 保留走得最远的那条记录（状态、编号、id），流程不再倒退；
 * - 开度取最晚一份有效开度，读数取最晚一份非空读数，解决两份底稿打架。
 */
export function reconcileHydraulic(rows: EntryRow[], statuses: string[]): EntryRow[] {
  const groups = new Map<string, EntryRow[]>()
  for (const row of rows) {
    const key = loopKey(row)
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }

  const merged: EntryRow[] = []
  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0])
      continue
    }
    const ordered = [...group].sort((a, b) => {
      const byDate = String(a.调节日期 ?? '').localeCompare(String(b.调节日期 ?? ''))
      if (byDate !== 0) {
        return byDate
      }
      return Number(a.id) - Number(b.id)
    })
    const furthest = ordered.reduce((best, row) =>
      statuses.indexOf(String(row.status)) > statuses.indexOf(String(best.status)) ? row : best,
    )
    const latest = ordered[ordered.length - 1]
    const survivor: EntryRow = { ...furthest }
    // 开度只认真值：几份底稿里取最晚一份 0~100 的有效开度；都不合法就清空，挡回历史脏值。
    let openingFound = false
    for (const row of ordered) {
      const opening = normalizeOpening(String(row.阀门开度 ?? ''))
      if (opening.ok) {
        survivor.阀门开度 = opening.value
        openingFound = true
      }
      if (String(row.流量读数 ?? '').trim() !== '') {
        survivor.流量读数 = String(row.流量读数).trim()
      }
      const fields: (keyof EntryRow)[] = ['换热站', '调节回路', '调节人', '调节日期']
      for (const field of fields) {
        if (String(row[field] ?? '').trim() !== '') {
          survivor[field] = row[field]
        }
      }
    }
    if (!openingFound) {
      survivor.阀门开度 = ''
    }
    survivor.轮次 = Number(survivor.轮次 ?? 1)
    // 最新底稿优先覆盖，但开度/读数已经按各自口径取过最晚有效值。
    if (String(latest.调节编号 ?? '').trim() !== '') {
      survivor.调节编号 = latest.调节编号
    }
    merged.push(survivor)
  }
  return merged.sort((a, b) => Number(a.id) - Number(b.id))
}
