export type StorageProviderKind = 'selfHosted' | 'git' | 'webdav' | 'plugin'

export type StorageCapability =
  | 'conditionalWrite'
  | 'incrementalChanges'
  | 'atomicMove'
  | 'versionHistory'
  | 'stableFileId'

export interface StorageConnection {
  id: string
  name: string
  kind: StorageProviderKind
  endpoint?: string
  username?: string
  workspaceId?: string
  localRoot: string
  repositoryPath?: string
  remote?: string
  branch?: string
  pluginId?: string
  pluginConfig?: string
  hasSecret: boolean
  capabilities: StorageCapability[]
}

export interface StorageConnectionInput {
  id?: string
  name: string
  kind: StorageProviderKind
  endpoint?: string
  username?: string
  workspaceId?: string
  localRoot: string
  repositoryPath?: string
  remote?: string
  branch?: string
  pluginId?: string
  pluginConfig?: string
}

export interface StoragePluginManifest {
  id: string
  name: string
  version: string
  protocolVersion: number
  capabilities: StorageCapability[]
}

export interface StorageProbeResult {
  ok: boolean
  message: string
  capabilities: StorageCapability[]
}

export type StorageSyncState =
  | 'synced'
  | 'pending'
  | 'syncing'
  | 'offline'
  | 'conflict'
  | 'error'

export interface StorageConflictSummary {
  path: string
  kind: 'content' | 'deleteEdit' | 'rename' | 'git'
}

export interface StorageSyncResult {
  state: StorageSyncState
  uploaded: number
  downloaded: number
  conflicts: StorageConflictSummary[]
  message?: string
}

export interface StorageStatusEvent extends StorageSyncResult {
  connectionId: string
}

export interface GitConflictFile {
  path: string
  stages: number[]
}

export interface GitSyncResult {
  state: 'upToDate' | 'updated' | 'pushed' | 'diverged' | 'mergeReady' | 'conflicts'
  ahead: number
  behind: number
  conflicts: GitConflictFile[]
}
