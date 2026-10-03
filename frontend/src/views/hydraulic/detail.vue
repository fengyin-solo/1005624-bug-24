<template>
  <section class="page detail-page" data-module="hydraulic-detail">
    <header class="page-head">
      <div>
        <h2>调节回路详情</h2>
        <p class="page-desc">
          <RouterLink class="link" to="/hydraulic">返回水力平衡列表</RouterLink>
          · 调节编号 {{ row?.['调节编号'] ?? '—' }}
        </p>
      </div>
    </header>

    <div v-if="!row" class="detail-card">
      <p class="empty-state">没有找到这条调节记录，可能已被重置。</p>
    </div>

    <template v-else>
      <article class="detail-card">
        <header class="detail-card-head">
          <h3>{{ row['调节回路'] }}</h3>
          <span class="legend-item">{{ row.status }}</span>
        </header>
        <dl class="detail-grid">
          <div v-for="field in fields" :key="field" class="detail-item">
            <dt>{{ field }}</dt>
            <dd v-if="field === '阀门开度'">{{ formatOpening(row[field]) }}</dd>
            <dd v-else>{{ row[field] ?? '—' }}</dd>
          </div>
          <div class="detail-item">
            <dt>最近提交时间</dt>
            <dd>{{ row['最近提交时间'] ?? '—' }}</dd>
          </div>
        </dl>
        <div class="detail-actions">
          <template v-for="action in actionList" :key="action">
            <RouterLink
              v-if="action === '复调重交'"
              class="btn"
              :to="{ path: `/hydraulic/${row.id}`, query: { action: 'resubmit' } }"
            >
              {{ action }}
            </RouterLink>
            <button v-else class="btn primary" type="button" @click="runAction(action)">
              {{ action }}
            </button>
          </template>
          <span v-if="!actionList.length" class="muted-text">当前状态没有可执行的动作，流程变更只能按顺序走。</span>
        </div>
        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
      </article>

      <article class="detail-card">
        <header class="detail-card-head">
          <h3>底稿留痕（{{ drafts.length }} 版）</h3>
          <span class="muted-text">同一回路每次提交/复调重交追加一版，先后以版本号为准</span>
        </header>
        <table class="data-table">
          <thead>
            <tr>
              <th>版本</th>
              <th>提交时间</th>
              <th>阀门开度</th>
              <th>流量读数</th>
              <th>调节人</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="draft in drafts" :key="draft['版本']">
              <td>第 {{ draft['版本'] }} 版</td>
              <td>{{ draft['提交时间'] }}</td>
              <td>{{ formatOpening(draft['阀门开度']) }}</td>
              <td>{{ draft['流量读数'] }}</td>
              <td>{{ draft['调节人'] }}</td>
            </tr>
          </tbody>
        </table>
      </article>

      <DraftDialog
        v-if="resubmitting"
        title="复调重交（覆盖本回路最新底稿）"
        submit-text="提交复调"
        :error="dialogError"
        :initial="resubmitInitial"
        @close="closeResubmit"
        @submit="submitResubmit"
      />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  allowedActions,
  formatOpening,
  getEntry,
  resubmitAdjustment,
  runAction as applyAction,
} from '@/api/local-service'
import type { AdjustmentDraftInput } from '@/api/local-service'
import type { DraftSnapshot, EntryRow } from '@/data/types'
import DraftDialog from './DraftDialog.vue'

const route = useRoute()
const router = useRouter()

const fields = ["换热站", "调节回路", "阀门开度", "流量读数", "调节人", "调节日期", "调节状态"]

const row = ref<EntryRow | null>(null)
const errorMessage = ref('')
const dialogError = ref('')

const drafts = computed<DraftSnapshot[]>(() => {
  const value = row.value?.['底稿留痕']
  return Array.isArray(value) ? (value as DraftSnapshot[]) : []
})
const actionList = computed(() => (row.value ? allowedActions('hydraulic', row.value) : []))
const resubmitting = ref(route.query.action === 'resubmit')
const resubmitInitial = computed<Partial<AdjustmentDraftInput>>(() => ({
  换热站: row.value ? String(row.value['换热站'] ?? '') : '',
  调节回路: row.value ? String(row.value['调节回路'] ?? '') : '',
  阀门开度: row.value ? String(row.value['阀门开度'] ?? '') : '',
  流量读数: row.value ? String(row.value['流量读数'] ?? '') : '',
  调节人: row.value ? String(row.value['调节人'] ?? '') : '',
}))

watch(
  () => route.query.action,
  (value) => {
    resubmitting.value = value === 'resubmit'
  },
)

function closeResubmit() {
  dialogError.value = ''
  router.replace({ path: route.path })
}

function loadRow() {
  const id = Number(route.params.id)
  row.value = getEntry('hydraulic', id)
}

function runAction(action: string) {
  if (!row.value) {
    return
  }
  errorMessage.value = ''
  const result = applyAction('hydraulic', Number(row.value.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
  }
  loadRow()
}

function submitResubmit(input: AdjustmentDraftInput) {
  if (!row.value) {
    return
  }
  const result = resubmitAdjustment(Number(row.value.id), input)
  if (!result.ok) {
    dialogError.value = result.message
    return
  }
  dialogError.value = ''
  router.replace({ path: route.path })
  resubmitting.value = false
  loadRow()
}

onMounted(loadRow)
</script>
