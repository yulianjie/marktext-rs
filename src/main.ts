import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'

import App from './App.vue'
import router from './router'
import { initTauriBridge } from './services/tauri-bridge'
import { installDebugBridge } from './services/debug-bridge'

import './assets/styles/global.css'

// Install the debug bridge BEFORE creating the Vue app so we catch even
// errors thrown during component initialisation.
installDebugBridge()

const app = createApp(App)

app.config.errorHandler = (err, _instance, info) => {
  const error = err instanceof Error ? err : new Error(String(err))
  console.error(`[vue:${info}]`, error)
}

app.use(createPinia())
app.use(router)
app.use(ElementPlus)

// Wire up Tauri event listeners before mount so the initial render can react
// to file-association launches and second-instance forwards.
initTauriBridge(app)

app.mount('#app')
