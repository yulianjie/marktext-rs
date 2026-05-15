# MarkText (Tauri rewrite)

Tauri 2 + Vue 3 + Rust port of [MarkText](https://github.com/marktext/marktext) — a real-time preview markdown editor.

This codebase is a rewrite-in-progress of the original Electron app, mapping each Electron main-process responsibility onto a Rust module while preserving the Muya WYSIWYG engine and existing renderer component structure.

## Prerequisites

| Tool | Version |
|---|---|
| Node | ≥ 20 |
| npm | ≥ 10 (yarn / pnpm also fine) |
| Rust | ≥ 1.77 (`rustup default stable`) |
| Platform deps | Tauri 2 prerequisites — see https://tauri.app/start/prerequisites/ |

Windows: Visual Studio C++ Build Tools + WebView2 (preinstalled on Win11).
macOS: Xcode CLI tools.
Linux: `webkit2gtk-4.1`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `build-essential`.

## Quickstart

```bash
npm install
npm run tauri:dev      # launches Vite dev server + Rust app
```

For production:
```bash
npm run tauri:build    # produces installer in src-tauri/target/release/bundle/
```

## Project layout

```
marktext-rs/
├── src/                  # Vue 3 + Pinia frontend
│   ├── main.ts           # bootstrap
│   ├── App.vue
│   ├── router/           # vue-router
│   ├── stores/           # Pinia stores (preferences, editor, ...)
│   ├── services/         # tauri-invoke / tauri-bridge wrappers
│   ├── pages/            # top-level routes
│   ├── components/       # SFC components (sideBar/, editorWithTabs/, ...)
│   ├── common/           # shared utils (ex marktext/src/common)
│   └── muya/             # WYSIWYG editor engine (verbatim from original)
├── src-tauri/            # Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   └── src/
│       ├── main.rs / lib.rs
│       ├── app.rs        # long-lived state
│       ├── commands/     # #[tauri::command] handlers
│       ├── filesystem/   # markdown, watcher, encoding
│       ├── preferences/  # store + schema
│       ├── menu/         # native menu builder
│       └── ipc/events.rs # typed event payloads
├── static/               # themes, logo
├── resources/            # build assets
├── docs/IPC_MAP.md       # Electron channel → Tauri command mapping
└── test/                 # vitest + playwright (TBA)
```

## Status

See [docs/IPC_MAP.md](docs/IPC_MAP.md) for the migration channel-by-channel.
Phase 1 (scaffolding) is in progress; the editor mounts Muya in a Tauri webview and supports open/save round-trips. Full feature parity is tracked in `develop.md` (TBA).
