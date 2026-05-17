/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type
  const component: DefineComponent<{}, {}, any>
  export default component
}

// Muya is plain JS; declare the shape we use as `any` for now and tighten later.
declare module 'muya/lib' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Muya: any
  export default Muya
}

// Marked-derived Muya internal modules — surface as `any`.
declare module 'muya/*'



