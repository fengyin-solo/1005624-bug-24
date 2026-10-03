import type { FollowUp } from './types'

// 停暖通知「待跟踪清单」的独立持久化：复调重交的结果回写到这里，按调节回路只保留一条。
const STORAGE_KEY = 'district-heating:followups'

// 初始清单：HYDR-0004 上一轮复调（底稿第 2 版）回写后还没人跟踪，仍挂在已发布的 NOTC-0003 上。
const SEED_FOLLOWUPS: FollowUp[] = [
  {
    id: 1,
    调节编号: 'HYDR-0004',
    换热站: '阳光花园换热站',
    调节回路: '4号楼二次侧回水回路',
    关联通知编号: 'NOTC-0003',
    阀门开度: 48,
    流量读数: '10.6 m³/h',
    版本: 2,
    复调时间: '2026-10-01 16:20',
    状态: '待跟踪',
  },
]

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

let cache: FollowUp[] | null = null

function readStorage(): FollowUp[] {
  const fallback = clone(SEED_FOLLOWUPS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as FollowUp[]
    return Array.isArray(parsed) ? parsed : fallback
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

export function listFollowUps(): FollowUp[] {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveFollowUps(rows: FollowUp[]): void {
  cache = rows
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
  }
}

export function resetFollowUps(): FollowUp[] {
  const rows = clone(SEED_FOLLOWUPS)
  saveFollowUps(rows)
  return rows
}
