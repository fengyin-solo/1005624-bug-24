<template>
  <section class="page" data-module="hydraulic">
    <header class="page-head">
      <div>
        <h2>水力平衡管理</h2>
        <p class="page-desc">维护平衡调节记录，围绕调节编号、换热站、调节回路、阀门开度做登记、筛选与状态流转。一条回路只落一份底稿，流程只能按顺序前进。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate()">调节重交</button>
        <button class="btn" type="button" @click="exportRows">导出水力平衡清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ renderCell(column, row) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actionsFor(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button v-if="String(row.status) === '需复调'" class="link" type="button" @click="openCreate(row)">
              调节重交
            </button>
            <button class="link" type="button" @click="openDetail(row)">查看详情</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无水力平衡数据，可先提交调节重交</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条水力平衡记录（同一回路重复底稿已自动合并为一条）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="createVisible" class="modal-mask" @click.self="closeCreate">
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="调节重交">
        <header class="modal-head">
          <h3>{{ formMode === 'restart' ? `第 ${formRound} 轮调节重交` : '调节重交' }}</h3>
          <button class="link" type="button" @click="closeCreate">关闭</button>
        </header>
        <p class="modal-tip">
          开度底稿与读数底稿同单提交；同一换热站 + 同一回路重复提交只更新这一条，不新增记录。
        </p>
        <form class="modal-form" @submit.prevent="submitDraft">
          <label v-for="field in draftFields" :key="field" class="filter-item">
            <span>{{ draftLabel(field) }}</span>
            <input
              v-model="draft[field]"
              :type="field === '调节日期' ? 'date' : 'text'"
              :placeholder="field === '阀门开度' ? '按既有口径填 0~100，可带 %' : `请输入${field}`"
            />
          </label>
          <p v-if="formError" class="error-text">{{ formError }}</p>
          <div class="modal-actions">
            <button class="btn ghost" type="button" @click="closeCreate">取消</button>
            <button class="btn primary" type="submit">提交重交</button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="detailRow" class="modal-mask" @click.self="closeDetail">
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="调节记录详情">
        <header class="modal-head">
          <h3>调节记录详情 · {{ detailRow.调节编号 }}</h3>
          <button class="link" type="button" @click="closeDetail">关闭</button>
        </header>
        <dl class="detail-grid">
          <template v-for="field in detailFields" :key="field">
            <dt>{{ field }}</dt>
            <dd>{{ renderCell(field, detailRow) }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd>{{ detailRow.status }}</dd>
          <dt>调节轮次</dt>
          <dd>第 {{ Number(detailRow.轮次 ?? 1) }} 轮</dd>
        </dl>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  availableActions,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  submitHydraulicDraft,
} from '@/api/local-service'
import { formatOpening } from '@/data/hydraulic'
import type { EntryRow, HydraulicDraft } from '@/data/types'

const meta = moduleMeta('hydraulic')
const columns = ["调节编号", "换热站", "调节回路", "阀门开度", "流量读数", "调节人", "调节日期", "调节状态"]
const allActions = ["提交调节", "确认平衡", "要求复调"]
const statuses = ["待调节", "调节中", "已平衡", "需复调"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const stats = computed(() => [
  { label: "待调节回路", value: countByStatus('待调节') },
  { label: "调节中回路", value: countByStatus('调节中') },
  { label: "已平衡回路", value: countByStatus('已平衡') },
])

function countByStatus(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: countByStatus(status),
  })),
)

// 列表和详情共用这一处开度口径，保证两处读到的开度一致。
function renderCell(column: string, row: EntryRow): string {
  if (column === '阀门开度') {
    return formatOpening(row[column])
  }
  const value = row[column]
  return value === undefined || value === '' ? '—' : String(value)
}

function actionsFor(row: EntryRow): string[] {
  return availableActions(meta, String(row.status)).filter((action) => allActions.includes(action))
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

const createVisible = ref(false)
const formError = ref('')
const formMode = ref<'create' | 'restart'>('create')
const formRound = ref(1)
const draftFields: (keyof HydraulicDraft)[] = ['换热站', '调节回路', '阀门开度', '流量读数', '调节人', '调节日期']
const emptyDraft = (): HydraulicDraft => ({
  换热站: '',
  调节回路: '',
  阀门开度: '',
  流量读数: '',
  调节人: '',
  调节日期: new Date().toISOString().slice(0, 10),
})
const draft = ref<HydraulicDraft>(emptyDraft())

function draftLabel(field: keyof HydraulicDraft): string {
  return field === '阀门开度' ? '阀门开度（0~100，可带 %）' : field
}

function openCreate(row?: EntryRow) {
  errorMessage.value = ''
  formError.value = ''
  if (row) {
    formMode.value = 'restart'
    formRound.value = Number(row.轮次 ?? 1) + 1
    draft.value = {
      换热站: String(row.换热站 ?? ''),
      调节回路: String(row.调节回路 ?? ''),
      阀门开度: formatOpening(row.阀门开度),
      流量读数: String(row.流量读数 ?? ''),
      调节人: String(row.调节人 ?? ''),
      调节日期: new Date().toISOString().slice(0, 10),
    }
  } else {
    formMode.value = 'create'
    formRound.value = 1
    draft.value = emptyDraft()
  }
  createVisible.value = true
}

function closeCreate() {
  createVisible.value = false
  formError.value = ''
}

function submitDraft() {
  formError.value = ''
  const result = submitHydraulicDraft(draft.value)
  if (!result.ok) {
    formError.value = result.message
    return
  }
  createVisible.value = false
  reload()
  errorMessage.value = result.message
}

const detailRow = ref<EntryRow | null>(null)
const detailFields = ["调节编号", "换热站", "调节回路", "阀门开度", "流量读数", "调节人", "调节日期"]

function openDetail(row: EntryRow) {
  // 详情读列表当前这一条（同一来源），不再单独查一份，避免多出重复底稿。
  detailRow.value = row
}

function closeDetail() {
  detailRow.value = null
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '水力平衡列表读取失败'
  }
}

onMounted(reload)
</script>
