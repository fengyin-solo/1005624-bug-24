<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal">
      <header class="modal-head">
        <h3>{{ title }}</h3>
        <button class="link" type="button" @click="$emit('close')">关闭</button>
      </header>
      <form class="modal-body" @submit.prevent="$emit('submit', { ...form })">
        <label class="form-item">
          <span>换热站 *</span>
          <input v-model="form.换热站" placeholder="如：阳光花园换热站" />
        </label>
        <label class="form-item">
          <span>调节回路 *</span>
          <input v-model="form.调节回路" placeholder="如：1号楼二次侧供水回路" />
        </label>
        <label class="form-item">
          <span>阀门开度（%，0~100）*</span>
          <input v-model="form.阀门开度" inputmode="decimal" placeholder="沿用既有调节口径，如：62.5" />
        </label>
        <label class="form-item">
          <span>流量读数 *</span>
          <input v-model="form.流量读数" placeholder="如：13.8 m³/h" />
        </label>
        <label class="form-item">
          <span>调节人 *</span>
          <input v-model="form.调节人" />
        </label>
        <p v-if="error" class="error-text">{{ error }}</p>
        <footer class="modal-foot">
          <button class="btn" type="button" @click="$emit('close')">取消</button>
          <button class="btn primary" type="submit">{{ submitText }}</button>
        </footer>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue'

import type { AdjustmentDraftInput } from '@/api/local-service'
import { useSessionStore } from '@/stores/session'

const props = defineProps<{
  title: string
  submitText: string
  error: string
  initial?: Partial<AdjustmentDraftInput>
}>()

defineEmits<{
  (e: 'submit', input: AdjustmentDraftInput): void
  (e: 'close'): void
}>()

const session = useSessionStore()

const form = reactive<AdjustmentDraftInput>({
  换热站: props.initial?.换热站 ?? '',
  调节回路: props.initial?.调节回路 ?? '',
  阀门开度: props.initial?.阀门开度 ?? '',
  流量读数: props.initial?.流量读数 ?? '',
  调节人: props.initial?.调节人 ?? session.operator,
})
</script>
