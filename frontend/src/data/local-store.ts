import { SEED_ROWS } from './seed'
import type { EntryRow, TrackingItem } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'district-heating:entries'
const TRACKING_KEY = 'district-heating:tracking'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
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
    return { ...fallback, ...parsed }
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

// 停暖通知的待跟踪清单：复调结果回写到这里，和业务记录分开存，刷新后仍然在。
let trackingCache: TrackingItem[] | null = null

function readTracking(): TrackingItem[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(TRACKING_KEY)
  if (!raw) {
    return []
  }
  try {
    return (JSON.parse(raw) as TrackingItem[]) ?? []
  } catch {
    return []
  }
}

export function listTracking(): TrackingItem[] {
  if (trackingCache === null) {
    trackingCache = readTracking()
  }
  return trackingCache
}

export function saveTracking(items: TrackingItem[]): void {
  trackingCache = items
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(TRACKING_KEY, JSON.stringify(items))
  }
}
