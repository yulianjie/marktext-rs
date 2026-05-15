# IPC migration map: Electron channels → Tauri commands/events

This document is the canonical mapping from the original MarkText IPC surface
(`ipcMain.on` / `ipcMain.handle` in `marktext/src/main/`, and the matching
`ipcRenderer.send/invoke/on` calls in `src/renderer/`) to the new Tauri API.

Three things were unified during the rewrite:

1. **`renderer → main`** (write-style commands): `ipcRenderer.send` and
   `ipcMain.on` → Tauri `invoke('cmd_*')` + `#[tauri::command]`. We do **not**
   use the fire-and-forget `send`-style pattern in the new app; every command
   is awaitable and returns `AppResult<T>`.
2. **`renderer → main` (request/response)**: `ipcRenderer.invoke` /
   `ipcMain.handle` → same `invoke('cmd_*')`. Same shape, just consolidated.
3. **`main → renderer`** broadcasts: `BrowserWindow.webContents.send` → Tauri
   `emit('mt://<area>/<action>', payload)` + renderer-side `listen(...)`.

Channel naming convention:
- **Commands** (renderer-initiated): `cmd_<area>_<verb>` (snake_case).
- **Events** (main-initiated): `mt://<area>/<action>` (URL-style for grep-ability).

## File operations

| Original channel | Direction | New |
|---|---|---|
| `AGANI::ask-for-open-files` (was on the menu side) | renderer→main | `invoke('cmd_open_files')` |
| `mt::response-file-save` | renderer→main | `invoke('cmd_save_markdown', { path, markdown, options })` |
| `mt::response-file-save-as` | renderer→main | `invoke('cmd_save_as_dialog')` then `cmd_save_markdown` |
| `mt::save-tabs` | renderer→main | loop on renderer side calling `cmd_save_markdown` |
| `mt::save-and-close-tabs` | renderer→main | renderer orchestrates `cmd_save_markdown` + window close |
| `mt::rename` | renderer→main | `invoke('cmd_rename_file', { from, to })` |
| `mt::response-file-move-to` | renderer→main | `invoke('cmd_rename_file')` (move = rename) |
| `mt::window::drop` | renderer→main | Tauri's webview drop event handles this; `cmd_read_markdown` per dropped file |
| `mt::cmd-open-file` | renderer→main | `invoke('cmd_open_files')` |
| `mt::cmd-open-folder` | renderer→main | `invoke('cmd_open_folder')` |
| `mt::cmd-import-file` | renderer→main | `invoke('cmd_open_files')` + renderer-side conversion |
| `mt::ask-for-image-auto-path` | renderer→main | `invoke('cmd_save_image_local')` |
| `mt::ask-for-open-project-in-sidebar` | renderer→main | `invoke('cmd_open_folder')` + `cmd_watch_folder` |
| `mt::format-link-click` | renderer→main | `tauri-plugin-shell::open()` directly from renderer |

## Workspace / watcher

| Original | New |
|---|---|
| `watcher-watch-file` | `invoke('cmd_watch_folder', { path })` (folder-level only — file-level watching collapses into folder watcher) |
| `watcher-watch-directory` | `invoke('cmd_watch_folder', { path })` |
| `watcher-unwatch-file` | `invoke('cmd_unwatch_folder')` |
| `watcher-unwatch-directory` | `invoke('cmd_unwatch_folder')` |
| `watcher-unwatch-all-by-id` | renderer tracks workspaces and unwatches each |
| (FS change broadcast) | event `mt://fs/change` with `FileWatchEvent` payload |
| (file list) | `invoke('cmd_list_directory', { path })` |

## Window management

| Original | New |
|---|---|
| `mt::open-file` (open into target window) | event `mt://window/open-file` to that window |
| `mt::close-window` | `invoke('cmd_close_window')` |
| `mt::window-toggle-always-on-top` | `invoke('cmd_set_always_on_top')` |
| `app-create-editor-window` | `invoke('cmd_new_window')` |
| `app-create-settings-window` | `invoke('cmd_open_settings')` |
| `window-close-by-id` | `invoke('cmd_close_window', { label })` |
| `window-reload-by-id` | `WebviewWindow.reload()` via Tauri JS API |
| `mt::app-try-quit` | `invoke('process:plugin:exit')` from `@tauri-apps/plugin-process` |

## Preferences / user data

| Original | New |
|---|---|
| `mt::ask-for-user-preference` | `invoke('cmd_get_preferences')` |
| `mt::set-user-preference` | `invoke('cmd_set_preferences', { patch })` |
| `mt::user-preference` (broadcast) | event `mt://prefs/changed` |
| `mt::ask-for-user-data` | `invoke('cmd_get_user_data')` |
| `mt::set-user-data` | `invoke('cmd_set_user_data', { patch })` |
| `mt::ask-for-image-path` | `invoke('cmd_get_preference', { key: 'imageFolderPath' })` |
| `mt::ask-for-modify-image-folder-path` | `invoke('cmd_set_preference', { key, value })` |
| `set-image-folder-path` | same as above |
| `broadcast-preferences-changed` | event `mt://prefs/changed` |
| `broadcast-user-data-changed` | event `mt://userdata/changed` |
| `mt::ask-for-user-themes` | `invoke('cmd_list_directory', { path: userThemesDir })` |
| `mt::open-user-themes-folder` | `tauri-plugin-shell::open()` |
| `mt::reload-user-themes` | renderer reloads from disk; no IPC |
| `mt::select-default-directory-to-open` | `invoke('cmd_open_folder')` + `cmd_set_preference` |
| `mt::cmd-toggle-autosave` | `invoke('cmd_set_preference', { key: 'autoSave', value })` |

## Menu / view state

| Original | New |
|---|---|
| `mt::update-line-ending-menu` | event `mt://menu/line-ending` (main owns the menu state in Rust) |
| `mt::update-format-menu` | event `mt://menu/format` |
| `mt::update-sidebar-menu` | event `mt://menu/sidebar` |
| `mt::view-layout-changed` | renderer pushes via `cmd_set_preference` |
| `mt::editor-selection-changed` | event `mt://editor/selection-changed` |
| `mt::add-recently-used-document` | `invoke('cmd_set_preference', ...)` + Tauri recent docs API |
| `menu-add-recently-used` | same |
| `menu-clear-recently-used` | `invoke('cmd_set_preference', { key: 'recents', value: [] })` |

## Keybindings

| Original | New |
|---|---|
| `mt::request-keybindings` | renderer reads JSON file directly via `@tauri-apps/plugin-fs` |
| `mt::open-keybindings-config` | `tauri-plugin-shell::open()` on the keybindings file |
| `mt::keybinding-get-pref-keybindings` | renderer reads from preferences store |
| `mt::keybinding-save-user-keybindings` | renderer writes via plugin-fs |
| `mt::keybinding-get-keyboard-info` | `@tauri-apps/plugin-os::platform()` / `arch()` |
| `mt::keybinding-debug-dump-keyboard-info` | renderer-side log only |

## Spellchecker

| Original | New |
|---|---|
| `mt::spellchecker-remove-word` | `invoke('cmd_spellcheck_remove_word')` |
| `mt::spellchecker-switch-language` | renderer-side preference change; `cmd_spellcheck_words` re-queries |
| `mt::spellchecker-get-available-dictionaries` | `invoke('cmd_spellcheck_available_dictionaries')` |
| `mt::spellchecker-set-enabled` | `invoke('cmd_set_preference', { key: 'spellcheckerEnabled' })` |
| `mt::spellchecker-get-custom-dictionary-words` | renderer reads from store |

## Export / print

| Original | New |
|---|---|
| `mt::response-export` | `invoke('cmd_export_html')` or `cmd_export_pdf` |
| `mt::response-print` | webview's `window.print()` directly |
| `mt::open-pdf` | `tauri-plugin-shell::open()` |

## Errors / lifecycle

| Original | New |
|---|---|
| `mt::handle-renderer-error` | renderer calls `console.error` + optional `tracing` via `invoke('cmd_log_error')` (TODO) |
| `mt::NEED_UPDATE` | event `mt://updater/available` |
| `mt::check-for-update` | `tauri-plugin-updater` from renderer |
| `screen-capture` / `mt::make-screenshot` | `tauri-plugin-screenshots` (separate crate, TBD) |
| `mt::open-setting-window` | `invoke('cmd_open_settings')` |
| `mt::show-command-palette` | event `mt://palette/show` |
| `mt::toggle-view-mode-entry` | event `mt://view/toggle` |

## Drag/drop into renderer

The Electron `file-drop` event on `BrowserWindow` is replaced by Tauri's
`dragDrop` window event from the webview. Renderer listens via
`getCurrentWebview().onDragDropEvent(...)`.

## Notes

- All `*-by-id` channels referenced the Electron `BrowserWindow.id` integer.
  In Tauri we use string `label`s instead; the renderer can read its own via
  `getCurrentWebviewWindow().label`.
- Multi-window broadcasts use `app.emit_to(...)`; per-window targeted events
  use `WebviewWindow.emit(...)`.
- All command payloads are JSON-serialisable via serde; no path strings need
  to be normalised (Rust `PathBuf` round-trips through serde as a string).
