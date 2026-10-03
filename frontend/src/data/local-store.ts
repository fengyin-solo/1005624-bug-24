import { SEED_ROWS } from './seed'
import type { DraftSnapshot, EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'district-heating:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 水力平衡归一化：投诉里「一条回路两份底稿、列表和详情对不上」就是落库了重复行。
 * 同一「调节回路」只保留最后提交的一条，历史底稿并到「底稿留痕」里按版本排好；
 * 顺手把「阀门开度」统一成数值口径，存量的非法文本开度清零，显示层再统一加百分号。
 */
function normalizeHydraulicRows(rows: EntryRow[]): EntryRow[] {
  const latest = new Map<string, EntryRow>()
  for (const row of rows) {
    const loop = String(row['调节回路'] ?? row.id)
    const kept = latest.get(loop)
    if (!kept) {
      latest.set(loop, row)
      continue
    }
    const nextVersion = Number(row['底稿版本'] ?? 0)
    const keptVersion = Number(kept['底稿版本'] ?? 0)
    const nextTime = String(row['最近提交时间'] ?? '')
    const keptTime = String(kept['最近提交时间'] ?? '')
    const rowIsNewer = nextVersion !== keptVersion ? nextVersion > keptVersion : nextTime >= keptTime
    const [winner, loser] = rowIsNewer ? [row, kept] : [kept, row]
    const historyMap = new Map<number, DraftSnapshot>()
    for (const item of [kept, row]) {
      const drafts = item['底稿留痕']
      if (Array.isArray(drafts)) {
        for (const draft of drafts as DraftSnapshot[]) {
          if (draft && typeof draft === 'object') {
            historyMap.set(Number(draft['版本']), draft)
          }
        }
      }
    }
    const mergedHistory = [...historyMap.values()].sort(
      (a, b) => Number(a['版本']) - Number(b['版本']),
    )
    winner['底稿留痕'] = mergedHistory
    if (loser.abnormal && !winner.abnormal) {
      winner.abnormal = true
    }
    latest.set(loop, winner)
  }
  return [...latest.values()].map((row) => {
    const copy = { ...row }
    let opening = Number(copy['阀门开度'])
    if (!Number.isFinite(opening) || opening < 0 || opening > 100) {
      // 行内存量开度是非法值（如老数据写成文本）：回退到最新底稿里的开度，仍非法才清零。
      const drafts = copy['底稿留痕']
      if (Array.isArray(drafts) && drafts.length) {
        const fromDraft = Number((drafts as DraftSnapshot[]).slice(-1)[0]['阀门开度'])
        if (Number.isFinite(fromDraft) && fromDraft >= 0 && fromDraft <= 100) {
          opening = fromDraft
        }
      }
      if (!Number.isFinite(opening) || opening < 0 || opening > 100) {
        opening = 0
      }
    }
    copy['阀门开度'] = opening
    return copy
  })
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const merged = { ...fallback, ...parsed }
    if (Array.isArray(merged.hydraulic)) {
      merged.hydraulic = normalizeHydraulicRows(merged.hydraulic)
    }
    return merged
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
