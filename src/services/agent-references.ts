import type { ReferenceSnapshot, DocumentSnapshot } from './agent'

export const MAX_REFERENCES = 8
export const referenceBytes = (value: string) => new TextEncoder().encode(value).length
export function validateReferences(references: ReferenceSnapshot[]) {
  const ids = new Set<string>()
  if (references.length > MAX_REFERENCES || references.some(ref => !/^[0-9a-f-]{36}$/i.test(ref.documentId)
    || ids.has(ref.documentId) || !ids.add(ref.documentId) || ref.snapshot.name.length > 1024
    || referenceBytes(ref.snapshot.markdown) > 2_000_000)
    || references.reduce((sum, ref) => sum + referenceBytes(ref.snapshot.markdown), 0) > 4_000_000) throw new Error('agent:referenceLimit')
}
export function referenceSnapshot(tab: { id: string; filename: string; markdown: string; pathname?: string | null }): DocumentSnapshot {
  return { tabId: tab.id, name: tab.filename, markdown: tab.markdown, from: 0, to: tab.markdown.length, ...(tab.pathname ? { path: tab.pathname } : {}) }
}
export function referenceRequest(references: ReferenceSnapshot[]) {
  validateReferences(references)
  return references.map(({ documentId, snapshot }) => ({ documentId, name: snapshot.name, markdown: snapshot.markdown }))
}
