//! Renderer-facing event payload types.
//!
//! Channel naming convention: `mt://<area>/<action>`. The renderer subscribes
//! via `listen('mt://...', cb)` from `@tauri-apps/api/event`.

pub mod events;
