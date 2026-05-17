# marktext-rs 后续工作计划

## 已完成（按 commit 顺序）

- **ff1529e** Initial Tauri 2 + Vue 3 + Rust 脚手架，含 28 个 `#[tauri::command]`、84 IPC 映射文档、Muya 5 项兼容补丁、debug-bridge
- **608e9bf** Phase 3 — 8 个 Pinia stores（取代 12 Vuex 模块），10 个 Vue 3 组件（TitleBar/TabsBar/MuyaEditor/SideBar/TreePane/TreeRow/TocPane/CommandPalette/AboutDialog/EditorPage 拼装）
- **c1659b2** Phase 4 — 完整原生菜单（7 组 47 项含快捷键）、源码模式 textarea、查找替换栏、侧栏全局搜索、Rename/Recent 弹窗、拖放打开、HTML/PDF 导出雏形
- **ddb71fd** Phase 5 — 接通菜单 Paragraph/Format/Undo/Redo 到 Muya、完整 HTML 导出（Muya getSanitizeHtml + 嵌入 CSS）、HTML5 拖拽 tab 重排、CodeMirror 6 源码模式
- **本次（Phase 6 主体）** — 完整 Preferences 多分区表单（General/Editor/Markdown/Theme/Image/Spellchecker/View/Search）、主题系统（CSS vars + light/dark/material-dark/one-dark/graphite-light/ulysses-light + autoSwitchTheme OS 跟随）、实时应用 zoom/font/line-width 到编辑器、Typewriter/Focus 模式、Always-on-Top/Fullscreen 菜单、PDF 通过 OS 打印对话框（emit mt://export/print 由前端 window.print()）、CLI 文件参数启动开文件 + single-instance 转发、Rust 端 set_preference/set_user_data 广播 mt://prefs/changed 给所有窗口

## Phase 7 — 后续（不在本次范围）

## Phase 5 — 完成（保留作为施工记录）

### 1. 接通菜单 Paragraph / Format → Muya 实际 API

**现状**：Rust 菜单点击发 `mt://menu/action`，EditorPage 把 `paragraph.*` / `format.*` 转成 bus 事件 `paragraph` / `format`，但**没有消费方**。Muya 本身有方法叫 `updateParagraph(type)` 和 `format(type)`，要在 `MuyaEditor.vue` 里订阅这两个 bus 事件并调用 Muya 实例方法。

**改动**：
- [src/components/editorWithTabs/MuyaEditor.vue](src/components/editorWithTabs/MuyaEditor.vue) 在 onMounted 里订阅 `bus.on('paragraph', ...)` 和 `bus.on('format', ...)`，转发到 `muyaRef.value.updateParagraph(type)` / `muyaRef.value.format(type)`
- 同时支持 Undo / Redo / Copy as HTML / Copy as Markdown / Paste as Plain — 这些菜单项也调 Muya 内部方法。原版 `editor.vue` 的 mounted 钩子里有完整的 bus 订阅清单，按图施工。

**验收**：从 Format 菜单点 "Bold"，光标处选中的文字会被 `**...**` 包围。

### 2. 完整 HTML 导出（Muya `getSanitizeHtml`）

**现状**：EditorPage 的 `doExportHtml` 用 `<pre>` 包了一下原始 markdown，等同于没做。

**改动**：
- 改成调 Muya 的 `getSanitizeHtml(markdown, opts)`（来自 `muya/lib/utils/exportHtml.js`，里面已经处理 KaTeX/Mermaid/Prism/`?inline` CSS 拼接）
- 把它包到 `services/muya-export.ts` 里以便测试和复用
- HTML 头里加 `<style>` 嵌入 githubMarkdown/exportStyle/prism/katex CSS（这些都是 `?inline` 字符串，已经能拿到）
- 文件名默认 `{filename}.html`

**验收**：导出后用浏览器打开，标题/代码高亮/数学公式应该都渲染正常。

### 3. 标签拖拽重排

**现状**：原版用 dragula。我们已经在 editor store 实现了 `exchangeTabs(fromIndex, toIndex)`，但 UI 没有触发。

**改动**：
- [TabsBar.vue](src/components/editorWithTabs/TabsBar.vue) 用 HTML5 原生 `draggable="true"` + `@dragstart` / `@dragover` / `@drop` 实现，不引入 dragula 依赖。
- 拖动时显示 placeholder/indicator，drop 后调 `editor.exchangeTabs(from, to)`

**验收**：能用鼠标拖动 tab 调换顺序，松手后顺序持久（直到关闭窗口）。

### 4. CodeMirror 6 替换源码模式 textarea

**现状**：[SourceCodePane.vue](src/components/editorWithTabs/SourceCodePane.vue) 是 monospace textarea，没有语法高亮、行号、折叠。

**改动**：
- 装依赖：`@codemirror/state`、`@codemirror/view`、`@codemirror/lang-markdown`、`@codemirror/commands`、`@codemirror/language`、`@codemirror/theme-one-dark`（约 200 KB）
- 改造 SourceCodePane 用 `EditorView` 替代 textarea，markdown 语言扩展提供 `#` heading / fence code 等高亮
- 编辑事件通过 `EditorView.updateListener` 转发到 `editor.setMarkdownExternal`
- 切 tab 时 `EditorView.dispatch` 替换 doc 而不是销毁重建

**验收**：源码模式下能看到 markdown 语法着色 + 行号。

### 5. 提交

`git commit -m "Phase 5: ..."`

## Phase 7 — 后续（不在本次范围）

| 项目 | 工作量估 | 备注 |
|---|---|---|
| 拼写检查（Hunspell/spellbook + dic 文件） | 2-3 天 | 需 Rust 侧 spellbook crate + frontend 红下划线 |
| Mermaid SVG 内联到 HTML 导出 | 0.5 天 | 把动态生成的 `<svg>` 写进导出的 HTML |
| 图片上传完整链路（GitHub / Unsplash UI） | 1 天 | Rust 命令 + Prefs UI 已就位，缺 Muya imageSelector 联动 |
| 完整 Muya 工具栏（粘贴格式按钮） | 0.5 天 | FormatPicker 已注册但没显示触发 UI |
| 自动更新签名链路 | 1-2 天 | 需要 `tauri signer generate` + 签名服务器 |
| 多窗口 / 多 instance 完整支持 | 0.5 天 | single-instance 已接，多窗口编辑器实例隔离 |
| i18n（zh-CN / en） | 1 天 | 所有 UI 字符串走 `t()` |
| E2E 测试（Playwright） | 1-2 天 | 启动 Tauri 二进制，跑核心流程 |
| 打包签名 / GitHub Actions CI | 1 天 | macOS notarize / Windows code signing |
| ESLint 9 配置迁移 | 0.5 天 | 旧 .eslintrc 在 ESLint 9 下不工作，需 flat config |
| TypeScript 严格类型修复 | 0.5 天 | preferences.ts set() 的 Pinia 类型 + 几个 @ts-expect-error 标注 |

## 执行顺序

Phase 5 与 Phase 6 已合入。下一步择优挑选 Phase 7 项目，或先做 Phase 7 的"完整 Muya 工具栏 + 图片上传 UI"以提升日常编辑体验。
