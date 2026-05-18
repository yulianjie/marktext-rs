import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import { getCurrentWindow } from '@tauri-apps/api/window'

import App from './App.vue'
import router from './router'
import { initTauriBridge } from './services/tauri-bridge'
import { installDebugBridge } from './services/debug-bridge'
import { t } from './i18n'

import './assets/styles/global.css'

// Install the debug bridge BEFORE creating the Vue app so we catch even
// errors thrown during component initialisation.
installDebugBridge()

const app = createApp(App)

app.config.errorHandler = (err, _instance, info) => {
  const error = err instanceof Error ? err : new Error(String(err))
  console.error(`[vue:${info}]`, error)
}

// Expose `$t` so templates can call it without an extra import per SFC.
app.config.globalProperties.$t = t

app.use(createPinia())
app.use(router)
app.use(ElementPlus)

// Wire up Tauri event listeners before mount so the initial render can react
// to file-association launches and second-instance forwards.
initTauriBridge(app)

app.mount('#app')

// Window starts hidden (tauri.conf.json visible:false) so the user never sees
// the unpainted webview or the window-state plugin restoring geometry.
// Reveal after the first paint.
if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
  requestAnimationFrame(() => {
    const win = getCurrentWindow()
    void win.show().then(() => win.setFocus())
  })
}
