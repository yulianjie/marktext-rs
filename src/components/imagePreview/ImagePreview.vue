<script setup lang="ts">
/**
 * Full-screen image preview modal.
 *
 * Opened by MuyaEditor's `format-click` handler when the user Ctrl/Cmd-clicks
 * an image inside the editor (mirrors the upstream "image viewer" behaviour).
 * Mounted once at the EditorPage level and listens on the `image-preview/open`
 * bus channel — so any future caller (e.g. a sidebar thumbnail) can reuse it.
 *
 * ESC or click on the backdrop closes the modal.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { bus } from '@/bus'

const visible = ref(false)
const src = ref('')
const alt = ref('')

let off: (() => void) | null = null

function open(payload: { src: string; alt?: string }) {
  src.value = payload.src
  alt.value = payload.alt ?? ''
  visible.value = true
}

function close() {
  visible.value = false
  src.value = ''
  alt.value = ''
}

function onKey(ev: KeyboardEvent) {
  if (!visible.value) return
  if (ev.key === 'Escape') {
    ev.preventDefault()
    close()
  }
}

onMounted(() => {
  off = bus.on('image-preview/open', open)
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  off?.()
  off = null
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="mt-image-preview-backdrop"
      role="dialog"
      aria-modal="true"
      @click.self="close"
    >
      <img class="mt-image-preview-img" :src="src" :alt="alt" @click.stop />
      <button class="mt-image-preview-close" type="button" :aria-label="'Close'" @click="close">
        ×
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.mt-image-preview-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9000;
  cursor: zoom-out;
}
.mt-image-preview-img {
  max-width: 92vw;
  max-height: 92vh;
  object-fit: contain;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  cursor: default;
}
.mt-image-preview-close {
  position: absolute;
  top: 16px;
  right: 24px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
.mt-image-preview-close:hover {
  background: rgba(255, 255, 255, 0.28);
}
</style>
