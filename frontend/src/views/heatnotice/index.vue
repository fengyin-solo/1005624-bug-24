<template>
  <section class="page" data-module="heatnotice">
    <header class="page-head">
      <div>
        <h2>停暖通知管理</h2>
        <p class="page-desc">维护停暖通知单，围绕通知编号、影响片区、停暖原因、计划开始做登记、筛选与状态流转。水力平衡的复调结果会回写到下方待跟踪清单。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记停暖通知单</button>
        <button class="btn" type="button" @click="exportRows">导出停暖通知清单</button>
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
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in allowedActions(meta.key, row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!allowedActions(meta.key, row).length" class="muted-text">—</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无停暖通知数据，可先登记停暖通知单</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条停暖通知记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <section class="followup-panel">
      <header class="followup-head">
        <h3>停暖通知待跟踪清单（水力平衡复调回写）</h3>
        <span class="muted-text">同一调节回路重复复调重交只保留最新一条</span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>调节编号</th>
            <th>换热站</th>
            <th>调节回路</th>
            <th>关联通知</th>
            <th>复调开度</th>
            <th>复调读数</th>
            <th>底稿版本</th>
            <th>复调时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in followUps" :key="item.id">
            <td>{{ item.调节编号 }}</td>
            <td>{{ item.换热站 }}</td>
            <td>{{ item.调节回路 }}</td>
            <td>{{ item.关联通知编号 || '未匹配通知' }}</td>
            <td>{{ formatOpening(item.阀门开度) }}</td>
            <td>{{ item.流量读数 }}</td>
            <td>第 {{ item.版本 }} 版</td>
            <td>{{ item.复调时间 }}</td>
            <td>
              <button class="link" type="button" @click="resolveItem(item.id)">跟踪办结</button>
            </td>
          </tr>
          <tr v-if="!followUps.length">
            <td colspan="9" class="empty-state">暂无待跟踪的复调结果</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  allowedActions,
  downloadEntries,
  formatOpening,
  listEntries,
  listTrackingFollowUps,
  moduleMeta,
  resolveFollowUp,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import type { FollowUp } from '@/data/types'

const meta = moduleMeta('heatnotice')
const columns = ["通知编号", "影响片区", "停暖原因", "计划开始", "计划恢复", "通知方式", "发布人", "通知状态"]
const statuses = ["待拟稿", "待发布", "已发布", "已撤销"]

const rows = ref<EntryRow[]>([])
const followUps = ref<FollowUp[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: '待发布通知', value: rows.value.filter((row) => row.status === '待发布').length },
  { label: '已发布通知', value: rows.value.filter((row) => row.status === '已发布').length },
  { label: '待跟踪复调', value: followUps.value.length },
])

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '停暖通知单登记入口尚未接入审批流'
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

function resolveItem(id: number) {
  errorMessage.value = ''
  const result = resolveFollowUp(id)
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
    followUps.value = listTrackingFollowUps()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '停暖通知列表读取失败'
  }
}

onMounted(reload)
</script>
