import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import { getCurrentWindow } from '@tauri-apps/api/window'

import App from './App.vue'
import router from './router'
import { initTauriBridge } from './services/tauri-bridge'
import { installDebugBridge } from './services/debug-bridge'
import { applyPreferencesToDom } from './services/preferences-applier'
import { useListenForMainStore } from './stores/listenForMain'
import { usePreferencesStore } from './stores/preferences'
import { t } from './i18n'

import './assets/styles/global.css'

// Install the debug bridge BEFORE creating the Vue app so we catch even
// errors thrown during component initialisation.
installDebugBridge()

const app = createApp(App)
const pinia = createPinia()

app.config.errorHandler = (err, _instance, info) => {
  const error = err instanceof Error ? err : new Error(String(err))
  console.error(`[vue:${info}]`, error)
}

// Expose `$t` so templates can call it without an extra import per SFC.
app.config.globalProperties.$t = t

app.use(pinia)
app.use(router)
app.use(ElementPlus)

// Wire up Tauri event listeners before mount so the initial render can react
// to file-association launches and second-instance forwards.
initTauriBridge(app)

async function bootstrap() {
  const appWindow = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
    ? getCurrentWindow()
    : null
  // Secondary windows are created visible by Tauri. Hide them immediately so
  // their default document colours cannot flash while preferences are loading.
  if (appWindow) await appWindow.hide().catch(() => undefined)

  // Load and apply preferences before the first render. This keeps every
  // window — including Preferences — from flashing the default English/light
  // appearance while its page-level mounted hook waits for IPC.
  const prefs = usePreferencesStore(pinia)
  const listener = useListenForMainStore(pinia)
  // Subscribe first, then load the snapshot. A sibling window can write while
  // this window boots without its patch falling into a listener gap.
  await listener.install().catch(() => undefined)
  await prefs.load()
  await applyPreferencesToDom()

  app.mount('#app')

  // Window starts hidden (tauri.conf.json visible:false) so the user never sees
  // the unpainted webview or the window-state plugin restoring geometry.
  // Reveal after the first paint. Browser-only Vite development skips this.
  if (appWindow) {
    requestAnimationFrame(() => {
      void appWindow.show().then(() => appWindow.setFocus())
    })
  }
}

void bootstrap()
