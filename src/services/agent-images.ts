import type { AgentImage } from './agent'

export const AGENT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_MESSAGE_IMAGES = 4
export const MAX_HISTORY_IMAGES = 12
export const MAX_HISTORY_IMAGE_BYTES = 20 * 1024 * 1024

export function imageBytes(image: AgentImage): number {
  const data = image.dataUrl.slice(image.dataUrl.indexOf(',') + 1)
  return data.length * 3 / 4 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0)
}

export function validateImageBudget(images: AgentImage[]) {
  if (images.length > MAX_HISTORY_IMAGES || images.reduce((sum, image) => sum + imageBytes(image), 0) > MAX_HISTORY_IMAGE_BYTES) {
    throw new Error('agent:imageHistoryLimit')
  }
}

export async function readAgentImage(file: File): Promise<AgentImage> {
  if (!AGENT_IMAGE_TYPES.includes(file.type)) throw new Error('agent:imageType')
  if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error('agent:imageSize')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reader.onabort = () => reject(new Error('agent:imageRead'))
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('agent:imageRead'))
    reader.readAsDataURL(file)
  })
  // Only local raster images enter the preview and IPC; no HTML or remote URLs.
  await new Promise<void>((resolve, reject) => {
    const preview = new Image()
    preview.onload = () => resolve()
    preview.onerror = () => reject(new Error('agent:imageRead'))
    preview.src = dataUrl
  })
  return { name: file.name.slice(0, 200) || 'image', dataUrl }
}
