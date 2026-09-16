<script setup lang="ts">
import { useAgentStore } from '@/stores/agent'
import { useEditorStore } from '@/stores/editor'
import { useI18n } from '@/i18n'
const agent = useAgentStore(), editor = useEditorStore()
const { t } = useI18n()
function attach(event: Event) {
  const select = event.target as HTMLSelectElement
  if (select.value) agent.addReferenceTab(select.value)
  select.value = ''
}
</script>
<template>
  <details class="agent-references">
    <summary>{{ t('agent.references.title') }}<span v-if="agent.conversation.references.length"> · {{ agent.conversation.references.length }}/8</span></summary>
    <p class="agent-muted">{{ t('agent.references.detail') }}</p>
    <div class="agent-reference-controls"><select :aria-label="t('agent.references.openTab')" :disabled="agent.busy || agent.conversation.readingReferences" @change="attach"><option value="">{{ t('agent.references.openTab') }}</option><option v-for="tab in editor.tabs.filter(tab => tab.id !== editor.currentFileId)" :key="tab.id" :value="tab.id">{{ tab.filename }}</option></select><button type="button" :disabled="agent.busy || agent.conversation.readingReferences" @click="agent.chooseReferences">{{ t('agent.references.files') }}</button></div>
    <p v-if="agent.conversation.readingReferences" role="status">{{ t('agent.references.reading') }}</p>
    <ul v-if="agent.conversation.references.length" class="agent-reference-chips"><li v-for="(reference, index) in agent.conversation.references" :key="reference.documentId"><span :title="reference.snapshot.path || reference.snapshot.name">{{ reference.snapshot.name }}</span><button type="button" :disabled="agent.busy" :aria-label="t('agent.references.remove', { name: reference.snapshot.name })" @click="agent.conversation.references.splice(index, 1)">×</button></li></ul>
  </details>
</template>
