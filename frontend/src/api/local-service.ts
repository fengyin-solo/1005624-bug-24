import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  listRows,
  listTracking,
  resetRows,
  saveRows,
  saveTracking,
} from '@/data/local-store'
import {
  formatOpening,
  loopKey,
  normalizeOpening,
  reconcileHydraulic,
} from '@/data/hydraulic'
import type {
  ActionResult,
  EntryRow,
  HydraulicDraft,
  ModuleMeta,
  OverviewResult,
  PageResult,
  TrackingItem,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const HYDRAULIC_KEY = 'hydraulic'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

function closedStatuses(meta: ModuleMeta): Set<string> {
  const statuses = meta.closedStatuses ?? [meta.statuses[meta.statuses.length - 1]]
  return new Set(statuses)
}

function isClosed(meta: ModuleMeta, status: string): boolean {
  return closedStatuses(meta).has(status)
}

// 水力平衡的历史数据里可能已经挂着重复底稿，任何一次读取都先按回路收成一条。
function ensureConsistent(key: string): EntryRow[] {
  const rows = listRows(key)
  if (key === HYDRAULIC_KEY) {
    const meta = moduleMeta(key)
    const reconciled = reconcileHydraulic(rows, meta.statuses).map((row) => ({
      ...row,
      pending: !isClosed(meta, String(row.status)),
    }))
    if (JSON.stringify(reconciled) !== JSON.stringify(rows)) {
      saveRows(key, reconciled)
    }
    return reconciled
  }
  return rows
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(ensureConsistent(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/**
 * 当前状态下可执行的动作：状态只能顺着登记的顺序往前走，
 * 目标状态必须在当前状态允许的流转边里，回退、跳步一律不给。
 */
function reachableStatuses(meta: ModuleMeta, status: string): string[] {
  if (meta.transitions) {
    return meta.transitions[status] ?? []
  }
  const currentIndex = meta.statuses.indexOf(status)
  if (currentIndex < 0 || currentIndex >= meta.statuses.length - 1) {
    return []
  }
  return [meta.statuses[currentIndex + 1]]
}

export function availableActions(meta: ModuleMeta, status: string): string[] {
  const reachable = reachableStatuses(meta, status)
  return meta.actions.filter((action) => reachable.includes(meta.actionTargets[action]))
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = ensureConsistent(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }

  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const allowed = availableActions(meta, current)
  if (!allowed.includes(action)) {
    return {
      ok: false,
      message: `流程不能从「${current}」${action}：状态变更只能按 ${meta.statuses.join(' → ')} 的顺序前进，回退与跳步一律打回`,
    }
  }

  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: !isClosed(meta, target),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)

  if (key === HYDRAULIC_KEY && target === '已平衡') {
    closeTrackingFor(updated)
  }

  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

function nextRowId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function nextRecordNo(rows: EntryRow[]): string {
  const max = rows.reduce((max, row) => {
    const match = /^HYDR-(\d+)$/.exec(String(row.调节编号 ?? ''))
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return `HYDR-${String(max + 1).padStart(4, '0')}`
}

/**
 * 平衡调节重交：一条回路只落一条底稿。
 * 开度与读数在同一张单子里提交，开度按既有口径校验；同一回路重复提交只更新原记录。
 * 已平衡的回路不允许借重交回到调节中；重交结果回写停暖通知待跟踪清单。
 */
export function submitHydraulicDraft(draft: HydraulicDraft): ActionResult {
  const meta = moduleMeta(HYDRAULIC_KEY)
  const station = draft.换热站.trim()
  const loop = draft.调节回路.trim()
  if (!station) {
    return { ok: false, message: '换热站为必填项' }
  }
  if (!loop) {
    return { ok: false, message: '调节回路为必填项：一条回路只认一份底稿' }
  }
  const opening = normalizeOpening(draft.阀门开度)
  if (!opening.ok) {
    return opening
  }
  const reading = draft.流量读数.trim()
  if (!reading) {
    return { ok: false, message: '流量读数为必填项：开度底稿与读数底稿必须同单提交' }
  }
  const operator = draft.调节人.trim() || '值班管理员'
  const date = draft.调节日期.trim() || new Date().toISOString().slice(0, 10)

  const rows = ensureConsistent(HYDRAULIC_KEY)
  const key = `${station}@@${loop}`
  const index = rows.findIndex((row) => loopKey(row) === key)

  if (index >= 0) {
    const existing = rows[index]
    const existingStatus = String(existing.status)
    if (existingStatus === '已平衡') {
      return {
        ok: false,
        message: `回路「${loop}」已判定平衡，重交不能把流程倒回调节中；如需处理请先由复核环节「要求复调」`,
      }
    }
    // 需复调后的重交是流程规定的唯一重启边：进入新一轮调节中，轮次 +1；
    // 调节中的重复提交只更新底稿，轮次不变、状态不动。
    const restarting = existingStatus === '需复调'
    const round = Number(existing.轮次 ?? 1) + (restarting ? 1 : 0)
    const nextStatus = existingStatus === '待调节' || restarting ? '调节中' : existingStatus
    const updated: EntryRow = {
      ...existing,
      换热站: station,
      调节回路: loop,
      阀门开度: opening.value,
      流量读数: reading,
      调节人: operator,
      调节日期: date,
      轮次: round,
      status: nextStatus,
      pending: !isClosed(meta, nextStatus),
      abnormal: false,
    }
    const nextRows = [...rows]
    nextRows[index] = updated
    saveRows(HYDRAULIC_KEY, nextRows)
    upsertTracking(updated, round)
    return {
      ok: true,
      message: restarting
        ? `回路「${loop}」第 ${round} 轮调节已开始（${existing.调节编号}），同一回路只有这一条底稿`
        : `回路「${loop}」已存在，重交只更新原底稿（${existing.调节编号}），不新增记录`,
    }
  }

  const row: EntryRow = {
    id: nextRowId(rows),
    status: '调节中',
    pending: !isClosed(meta, '调节中'),
    abnormal: false,
    调节编号: nextRecordNo(rows),
    换热站: station,
    调节回路: loop,
    阀门开度: opening.value,
    流量读数: reading,
    调节人: operator,
    调节日期: date,
    轮次: 1,
  }
  saveRows(HYDRAULIC_KEY, [...rows, row])
  upsertTracking(row, 1)
  return { ok: true, message: `回路「${loop}」已登记，调节编号 ${row.调节编号}` }
}

function upsertTracking(row: EntryRow, round: number): void {
  const items = listTracking()
  const key = loopKey(row)
  const index = items.findIndex((item) => `${item.换热站}@@${item.调节回路}` === key)
  const payload: TrackingItem = {
    id: index >= 0 ? items[index].id : items.reduce((max, item) => Math.max(max, item.id), 0) + 1,
    调节编号: String(row.调节编号 ?? ''),
    换热站: String(row.换热站 ?? ''),
    调节回路: String(row.调节回路 ?? ''),
    阀门开度: formatOpening(row.阀门开度),
    流量读数: String(row.流量读数 ?? ''),
    调节人: String(row.调节人 ?? ''),
    调节日期: String(row.调节日期 ?? ''),
    轮次: round,
    open: true,
    createdAt: index >= 0 ? items[index].createdAt : new Date().toISOString(),
  }
  const next = index >= 0 ? items.map((item, i) => (i === index ? payload : item)) : [...items, payload]
  saveTracking(next)
}

function closeTrackingFor(row: EntryRow): void {
  const key = loopKey(row)
  const items = listTracking()
  const next = items.map((item) =>
    `${item.换热站}@@${item.调节回路}` === key ? { ...item, open: false } : item,
  )
  saveTracking(next)
}

export function trackingEntries(): TrackingItem[] {
  return [...listTracking()].sort((a, b) => Number(b.open) - Number(a.open) || b.createdAt.localeCompare(a.createdAt))
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of ensureConsistent(key)) {
    const values = meta.fields.map((field) => {
      if (field === '阀门开度') {
        return formatOpening(row[field])
      }
      return row[field] ?? ''
    })
    lines.push([row.id, ...values, row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  // 汇总前先把水力平衡的重复底稿收干净，看板数与列表数一致。
  for (const key of Object.keys(allRows())) {
    ensureConsistent(key)
  }
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
