import { MODULE_BY_KEY } from '@/data/modules'
import { listFollowUps, saveFollowUps } from '@/data/followup-store'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  DraftSnapshot,
  EntryRow,
  FollowUp,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const HYDRAULIC_KEY = 'hydraulic'
const HEATNOTICE_KEY = 'heatnotice'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

function terminalStatuses(meta: ModuleMeta): string[] {
  return meta.terminalStatuses ?? [meta.statuses[meta.statuses.length - 1]]
}

/** 动作在当前状态下能不能执行：登记了 actionFrom 的模块照白名单；否则只能沿状态表往前走。 */
function canTransit(meta: ModuleMeta, action: string, current: string, target: string): boolean {
  const whitelist = meta.actionFrom
  if (whitelist && whitelist[action]) {
    return whitelist[action].includes(current)
  }
  const fromIndex = meta.statuses.indexOf(current)
  const toIndex = meta.statuses.indexOf(target)
  if (fromIndex < 0 || toIndex < 0) {
    return current !== target
  }
  return toIndex > fromIndex
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

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function getEntry(key: string, id: number): EntryRow | null {
  return listRows(key).find((row) => Number(row.id) === id) ?? null
}

/** 列表与详情共用的开度口径：百分比、保留一位小数，两处读到的字符串完全一致。 */
export function formatOpening(value: unknown): string {
  const opening = Number(value)
  if (!Number.isFinite(opening)) {
    return '—'
  }
  return `${Math.round(opening * 10) / 10}%`
}

/** 开度表单校验：必须是 0~100 的数值，超界、空值、文本一律挡回。 */
function parseOpening(raw: string): { ok: true; value: number } | { ok: false; message: string } {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return { ok: false, message: '阀门开度不能为空，请按既有口径填写 0~100 的百分数' }
  }
  const value = Number(trimmed.replace(/%$/, ''))
  if (!Number.isFinite(value)) {
    return { ok: false, message: `阀门开度「${trimmed}」不是有效数值，请填写 0~100 的百分数` }
  }
  if (value < 0 || value > 100) {
    return { ok: false, message: `阀门开度 ${value} 超出 0~100 的允许范围，请重新填写` }
  }
  return { ok: true, value: Math.round(value * 10) / 10 }
}

function nowStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function draftHistory(row: EntryRow): DraftSnapshot[] {
  const drafts = row['底稿留痕']
  return Array.isArray(drafts) ? (drafts as DraftSnapshot[]) : []
}

function latestVersion(row: EntryRow): number {
  return draftHistory(row).reduce((max, draft) => Math.max(max, Number(draft['版本']) || 0), 0)
}

/** 把调节回路挂到对应停暖通知上：换热站名去掉「换热站」后按影响片区匹配，匹配不上先挂空。 */
function matchNoticeId(station: string): string {
  const areaHint = station.replace(/换热站$/, '')
  const notice = [...listRows(HEATNOTICE_KEY)]
    .reverse()
    .find((row) => String(row['影响片区'] ?? '').includes(areaHint))
  return notice ? String(notice['通知编号'] ?? '') : ''
}

/** 复调结果回写停暖通知待跟踪清单：同一调节回路只留一条，重交覆盖旧条目。 */
export function writeFollowUp(row: EntryRow, draft: DraftSnapshot): void {
  const rows = listFollowUps()
  const loop = String(row['调节回路'])
  const followUp: FollowUp = {
    id: rows.reduce((max, item) => Math.max(max, item.id), 0) + 1,
    调节编号: String(row['调节编号']),
    换热站: String(row['换热站']),
    调节回路: loop,
    关联通知编号: matchNoticeId(String(row['换热站'])),
    阀门开度: draft['阀门开度'],
    流量读数: draft['流量读数'],
    版本: draft['版本'],
    复调时间: draft['提交时间'],
    状态: '待跟踪',
  }
  const index = rows.findIndex((item) => item.调节回路 === loop)
  if (index >= 0) {
    followUp.id = rows[index].id
    rows[index] = followUp
  } else {
    rows.push(followUp)
  }
  saveFollowUps(rows)
}

export function listTrackingFollowUps(): FollowUp[] {
  return listFollowUps().filter((item) => item.状态 === '待跟踪')
}

export function resolveFollowUp(id: number): ActionResult {
  const rows = listFollowUps()
  const index = rows.findIndex((item) => item.id === id)
  if (index < 0) {
    return { ok: false, message: '待跟踪清单里没有这条记录' }
  }
  rows[index] = { ...rows[index], 状态: '已跟踪' }
  saveFollowUps(rows)
  return { ok: true, message: `回路「${rows[index].调节回路}」已跟踪办结` }
}

export type AdjustmentDraftInput = {
  换热站: string
  调节回路: string
  阀门开度: string
  流量读数: string
  调节人: string
}

function validateDraftInput(input: AdjustmentDraftInput): { ok: true; opening: number } | { ok: false; message: string } {
  if (!input.换热站.trim()) {
    return { ok: false, message: '换热站不能为空' }
  }
  if (!input.调节回路.trim()) {
    return { ok: false, message: '调节回路不能为空' }
  }
  if (!input.流量读数.trim()) {
    return { ok: false, message: '流量读数不能为空' }
  }
  if (!input.调节人.trim()) {
    return { ok: false, message: '调节人不能为空' }
  }
  const opening = parseOpening(input.阀门开度)
  if (!opening.ok) {
    return { ok: false, message: opening.message }
  }
  return { ok: true, opening: opening.value }
}

/** 登记新调节记录：同一条调节回路已经有底稿的，拒绝再落一条，从入口杜绝重复。 */
export function createAdjustment(input: AdjustmentDraftInput): ActionResult {
  const checked = validateDraftInput(input)
  if (!checked.ok) {
    return checked
  }
  const rows = listRows(HYDRAULIC_KEY)
  const loop = input.调节回路.trim()
  const duplicated = rows.find((row) => String(row['调节回路'] ?? '') === loop)
  if (duplicated) {
    return {
      ok: false,
      message: `调节回路「${loop}」已有底稿（${String(duplicated['调节编号'])}，当前状态「${duplicated.status}」），重复登记已拦截`,
    }
  }
  const stamp = nowStamp()
  const id = nextId(rows)
  const seq = String(id).padStart(4, '0')
  const draft: DraftSnapshot = {
    版本: 1,
    提交时间: stamp,
    阀门开度: checked.opening,
    流量读数: input.流量读数.trim(),
    调节人: input.调节人.trim(),
  }
  const row: EntryRow = {
    id,
    status: '待调节',
    pending: true,
    abnormal: false,
    调节编号: `HYDR-${seq}`,
    换热站: input.换热站.trim(),
    调节回路: loop,
    阀门开度: checked.opening,
    流量读数: input.流量读数.trim(),
    调节人: input.调节人.trim(),
    调节日期: stamp.slice(0, 10),
    调节状态: '待调节',
    最近提交时间: stamp,
    底稿留痕: [draft],
  }
  saveRows(HYDRAULIC_KEY, [...rows, row])
  return { ok: true, message: `调节记录 ${row['调节编号']} 已登记，回路「${loop}」唯一底稿已建立` }
}

/**
 * 复调重交：只允许「需复调」状态调用。同回路只更新这一条记录并追加底稿版本，
 * 绝不新增行；结果（开度/读数/版本/时间）同步回写停暖通知待跟踪清单。
 */
export function resubmitAdjustment(id: number, input: AdjustmentDraftInput): ActionResult {
  const checked = validateDraftInput(input)
  if (!checked.ok) {
    return checked
  }
  const meta = moduleMeta(HYDRAULIC_KEY)
  const rows = listRows(HYDRAULIC_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = rows[index]
  if (current.status !== '需复调') {
    return {
      ok: false,
      message: `当前状态「${current.status}」不能复调重交，流程变更只能按顺序走`,
    }
  }
  const stamp = nowStamp()
  const draft: DraftSnapshot = {
    版本: latestVersion(current) + 1,
    提交时间: stamp,
    阀门开度: checked.opening,
    流量读数: input.流量读数.trim(),
    调节人: input.调节人.trim(),
  }
  const updated: EntryRow = {
    ...current,
    status: '调节中',
    pending: true,
    abnormal: false,
    换热站: input.换热站.trim(),
    调节回路: input.调节回路.trim(),
    阀门开度: checked.opening,
    流量读数: input.流量读数.trim(),
    调节人: input.调节人.trim(),
    调节日期: stamp.slice(0, 10),
    调节状态: '调节中',
    最近提交时间: stamp,
    底稿留痕: [...draftHistory(current), draft],
  }
  const next = [...rows]
  next[index] = updated
  saveRows(HYDRAULIC_KEY, next)
  writeFollowUp(updated, draft)
  return {
    ok: true,
    message: `复调底稿（第 ${draft.版本} 版）已落在原回路「${updated['调节回路']}」上，状态回到「调节中」，结果已回写停暖通知待跟踪清单`,
  }
}

/** 当前状态下页面该亮出哪些动作：顺序不对的直接不显示，即便绕过页面请求，runAction 也会再挡一次。 */
export function allowedActions(key: string, row: EntryRow): string[] {
  const meta = moduleMeta(key)
  return meta.actions.filter((action) => {
    const target = meta.actionTargets[action]
    return target && canTransit(meta, action, String(row.status), target)
  })
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 流程状态变更只能顺着走：白名单不命中或下标倒退的动作一律打回，状态保持原样。
  if (!canTransit(meta, action, current, target)) {
    return {
      ok: false,
      message: `${meta.entity}当前为「${current}」，不能执行「${action}」（目标「${target}」），流程变更只能按顺序走，回退操作已打回`,
    }
  }
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: !terminalStatuses(meta).includes(target),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
    调节状态: key === HYDRAULIC_KEY ? target : rows[index]['调节状态'],
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
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
