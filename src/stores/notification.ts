/**
 * Notification store — bridge for `mt://notify/*` events from Rust and a
 * lightweight `pushToast` helper. Uses Element Plus's `ElNotification` so
 * styling is consistent with the rest of the UI.
 */

import { defineStore } from 'pinia'
import { ElNotification } from 'element-plus'

export interface ToastSpec {
  type: 'success' | 'info' | 'warning' | 'error'
  title?: string
  message: string
  duration?: number
}

export const useNotificationStore = defineStore('notification', () => {
  function pushToast(spec: ToastSpec) {
    ElNotification({
      type: spec.type,
      title: spec.title,
      message: spec.message,
      duration: spec.duration ?? 4500,
      position: 'bottom-right',
    })
  }

  return { pushToast }
})
