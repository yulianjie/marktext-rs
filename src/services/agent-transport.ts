import { agentCancel, agentGetConfig, agentSaveConfig, agentStart, agentTestConnection, agentListSkills, agentImportSkill, agentSetSkillEnabled, agentRemoveSkill, agentReadSkill } from './tauri-invoke'
import { listenTyped } from './tauri-bridge'
import type { AgentEvent } from './agent'

export const agentTransport = {
  getConfig: () => '__TAURI_INTERNALS__' in window ? agentGetConfig() : Promise.reject(new Error('agent:desktopOnly')),
  saveConfig: agentSaveConfig,
  testConnection: agentTestConnection,
  start: agentStart,
  cancel: agentCancel,
  listSkills: agentListSkills,
  importSkill: agentImportSkill,
  setSkillEnabled: agentSetSkillEnabled,
  removeSkill: agentRemoveSkill,
  readSkill: agentReadSkill,
  listen: (handler: (event: AgentEvent) => void) => listenTyped('mt://agent/event', handler),
}
