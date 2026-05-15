<script setup lang="ts">
import { onMounted } from 'vue'
import { usePreferencesStore } from '@/stores/preferences'

const prefs = usePreferencesStore()

onMounted(() => {
  void prefs.load()
})
</script>

<template>
  <div class="prefs-page">
    <h1>Preferences</h1>
    <p class="hint">A skeleton settings page — full forms come in Phase 6.</p>

    <el-form label-width="180px" label-position="left">
      <el-form-item label="Auto save">
        <el-switch :model-value="prefs.autoSave" @update:model-value="v => prefs.set('autoSave', !!v)" />
      </el-form-item>
      <el-form-item label="Language">
        <el-select
          :model-value="prefs.language"
          @update:model-value="v => prefs.set('language', v as string)"
          style="width: 200px"
        >
          <el-option label="English" value="en" />
          <el-option label="简体中文" value="zh-CN" />
        </el-select>
      </el-form-item>
      <el-form-item label="Font size">
        <el-input-number
          :model-value="prefs.fontSize"
          :min="12"
          :max="32"
          @update:model-value="v => prefs.set('fontSize', Number(v))"
        />
      </el-form-item>
      <el-form-item label="Theme">
        <el-select
          :model-value="prefs.theme"
          @update:model-value="v => prefs.set('theme', v as string)"
          style="width: 200px"
        >
          <el-option label="Light" value="light" />
          <el-option label="Dark" value="dark" />
        </el-select>
      </el-form-item>
    </el-form>
  </div>
</template>

<style scoped>
.prefs-page {
  padding: 24px 32px;
  overflow: auto;
  height: 100%;
}
.hint {
  color: #6a737d;
  font-size: 13px;
  margin-bottom: 24px;
}
</style>
