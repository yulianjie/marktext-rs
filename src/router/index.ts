import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'editor',
    component: () => import('@/pages/EditorPage.vue'),
  },
  {
    path: '/preferences',
    name: 'preferences',
    component: () => import('@/pages/PreferencesPage.vue'),
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
