/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  // 办结状态：落在这些状态上的记录不再算待处理。默认取状态序列最后一个。
  closedStatuses?: string[]
  // 显式允许的状态流转边（目标 → 可达状态）。缺省时按状态序列顺序单向前进一步。
  transitions?: Record<string, string[]>
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 平衡调节重交表单：开度底稿与读数底稿同单提交，一条回路只认这一份。 */
export type HydraulicDraft = {
  换热站: string
  调节回路: string
  阀门开度: string
  流量读数: string
  调节人: string
  调节日期: string
}

/** 停暖通知的待跟踪清单项：复调结果回写在这里，确认平衡后核销。 */
export type TrackingItem = {
  id: number
  调节编号: string
  换热站: string
  调节回路: string
  阀门开度: string
  流量读数: string
  调节人: string
  调节日期: string
  轮次: number
  open: boolean
  createdAt: string
}
