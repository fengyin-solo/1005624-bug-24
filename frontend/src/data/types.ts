/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

/** 一份调节底稿留痕：同一条回路每次提交/复调重交都追加一版，先后顺序靠版本号和提交时间说清楚。 */
export type DraftSnapshot = {
  版本: number
  提交时间: string
  阀门开度: number
  流量读数: string
  调节人: string
}

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean | DraftSnapshot[]
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
  /** 每个动作允许的出发状态：命中白名单才放行；不登记的模块按状态下标只能往前走。 */
  actionFrom?: Record<string, string[]>
  /** 视为已收尾、不再待处理的状态；不登记时取状态表最后一个。 */
  terminalStatuses?: string[]
  metrics: string[]
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

/** 停暖通知待跟踪清单里的一行：一条回路复调重交后回写一条，同一回路只留最新一条。 */
export type FollowUp = {
  id: number
  调节编号: string
  换热站: string
  调节回路: string
  关联通知编号: string
  阀门开度: number
  流量读数: string
  版本: number
  复调时间: string
  状态: '待跟踪' | '已跟踪'
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
