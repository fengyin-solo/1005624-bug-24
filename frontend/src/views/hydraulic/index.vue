<template>
  <section class="page" data-module="hydraulic">
    <header class="page-head">
      <div>
        <h2>水力平衡管理</h2>
        <p class="page-desc">维护平衡调节记录，围绕调节编号、换热站、调节回路、阀门开度做登记、筛选与状态流转。状态只能顺着走，同一条回路只落一份底稿。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记平衡调节记录</button>
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
          <td v-for="column in columns" :key="column">
            <RouterLink v-if="column === '调节编号'" class="link" :to="`/hydraulic/${row.id}`">
              {{ row[column] }}
            </RouterLink>
            <template v-else-if="column === '阀门开度'">{{ formatOpening(row[column]) }}</template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-for="action in allowedActions(meta.key, row)" :key="action">
              <RouterLink v-if="action === '复调重交'" class="link" :to="`/hydraulic/${row.id}?action=resubmit`">
                {{ action }}
              </RouterLink>
              <button v-else class="link" type="button" @click="runAction(action, row)">
                {{ action }}
              </button>
            </template>
            <span v-if="!allowedActions(meta.key, row).length" class="muted-text">—</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无水力平衡数据，可先登记平衡调节记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条水力平衡记录（同回路重复底稿已在读取时合并）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <DraftDialog
      v-if="creating"
      title="登记平衡调节记录"
      submit-text="提交登记"
      :error="dialogError"
      @close="creating = false"
      @submit="submitCreate"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  allowedActions,
  createAdjustment,
  downloadEntries,
  formatOpening,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { AdjustmentDraftInput } from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import DraftDialog from './DraftDialog.vue'

const meta = moduleMeta('hydraulic')
const columns = ["调节编号", "换热站", "调节回路", "阀门开度", "流量读数", "调节人", "调节日期", "调节状态"]
const statuses = ["待调节", "调节中", "已平衡", "需复调"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const creating = ref(false)
const dialogError = ref('')

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: '待调节回路', value: rows.value.filter((row) => row.status === '待调节').length },
  { label: '调节中回路', value: rows.value.filter((row) => row.status === '调节中').length },
  { label: '已平衡回路', value: rows.value.filter((row) => row.status === '已平衡').length },
])

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  dialogError.value = ''
  creating.value = true
}

function submitCreate(input: AdjustmentDraftInput) {
  const result = createAdjustment(input)
  if (!result.ok) {
    dialogError.value = result.message
    return
  }
  creating.value = false
  reload()
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
