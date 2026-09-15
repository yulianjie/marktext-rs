<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ArrowLeft, ExternalLink, FileText, LoaderCircle, Plus, Trash2 } from '@lucide/vue'
import { open as openExternal } from '@tauri-apps/plugin-shell'
import { useAgentStore, agentError } from '@/stores/agent'
import { agentTransport } from '@/services/agent-transport'
import type { AgentSkill, AgentSkillDetail } from '@/services/agent'
import { useI18n } from '@/i18n'

const agent = useAgentStore()
const { t } = useI18n()
const detail = ref<AgentSkillDetail | null>(null)
const reading = ref(false)
function label(skill: AgentSkill) { return skill.builtin ? t(`agent.skills.builtins.${skill.name}.name`) : skill.name }
async function inspect(skill: AgentSkill) {
  if (reading.value) return
  reading.value = true
  agent.skillsError = ''
  try { detail.value = await agentTransport.readSkill(skill.id) }
  catch (cause) { agent.skillsError = agentError(cause) }
  finally { reading.value = false }
}
async function source(url: string) {
  try {
    if ('__TAURI_INTERNALS__' in window) await openExternal(url)
    else window.open(url, '_blank', 'noopener,noreferrer')
  } catch (cause) { agent.skillsError = agentError(cause) }
}
onMounted(() => { void agent.loadSkills() })
</script>

<template>
  <section class="agent-settings agent-skills">
    <button class="agent-back" type="button" @click="detail ? detail = null : agent.skillsOpen = false"><ArrowLeft :size="16" />{{ t(detail ? 'agent.skills.back' : 'agent.settings.back') }}</button>
    <h2>{{ t('agent.skills.title') }}</h2>
    <p v-if="agent.skillsError" class="agent-error" role="alert">{{ agent.skillsError }} <button type="button" :disabled="agent.skillsLoading" @click="agent.loadSkills">{{ t('agent.retry') }}</button></p>
    <template v-if="detail">
      <h3>{{ detail.id.split(':').slice(1).join(':') }}</h3>
      <pre class="agent-skill-content">{{ detail.instructions }}</pre>
      <details v-if="detail.files.length"><summary>{{ t('agent.skills.files', { count: detail.files.length }) }}</summary><ul class="agent-skill-files"><li v-for="file in detail.files" :key="file">{{ file }}</li></ul></details>
    </template>
    <template v-else>
      <p>{{ t('agent.skills.description') }}</p>
      <div class="agent-skill-actions"><button type="button" :disabled="agent.skillsLoading || agent.busy" @click="agent.changeSkills(agentTransport.importSkill)"><Plus :size="14" />{{ t('agent.skills.import') }}</button></div>
      <p class="agent-skill-help">{{ t('agent.skills.importHelp') }}</p>
      <div v-if="agent.skillsLoading || reading" class="agent-working" role="status"><LoaderCircle :size="14" class="agent-spin" />{{ t('agent.working') }}</div>
      <article v-for="skill in agent.skills" :key="skill.id" class="agent-skill-card" :data-skill-id="skill.id">
        <label><input type="checkbox" :checked="skill.enabled" :disabled="agent.skillsLoading || agent.busy" :aria-label="t('agent.skills.enable', { name: label(skill) })" @change="agent.changeSkills(() => agentTransport.setSkillEnabled(skill.id, !skill.enabled))"><strong>{{ label(skill) }}</strong><small>{{ t(skill.builtin ? 'agent.skills.builtin' : 'agent.skills.custom') }}</small></label>
        <code>{{ skill.name }}</code>
        <p>{{ skill.builtin ? t(`agent.skills.builtins.${skill.name}.description`) : skill.description }}</p>
        <footer><span>{{ skill.license || t('agent.skills.licenseUnknown') }}</span><button type="button" :disabled="reading" @click="inspect(skill)"><FileText :size="12" />{{ t('agent.skills.view') }}</button><button v-if="skill.source" type="button" @click="source(skill.source)"><ExternalLink :size="12" />{{ t('agent.skills.source') }}</button><button v-if="!skill.builtin" type="button" :disabled="agent.skillsLoading || agent.busy" :aria-label="t('agent.skills.remove', { name: label(skill) })" @click="agent.changeSkills(() => agentTransport.removeSkill(skill.id))"><Trash2 :size="13" /></button></footer>
      </article>
    </template>
  </section>
</template>
