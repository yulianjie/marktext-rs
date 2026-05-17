# Auto-update signing

Tauri's `tauri-plugin-updater` verifies update bundles against a Ed25519
keypair. The public half lives in `tauri.conf.json` (`plugins.updater.pubkey`)
and ships with the app; the private half stays on the release machine.

The plugin is **disabled by default** (`plugins.updater.active = false`)
because shipping without signing keys is a footgun — a malformed pubkey or
swapped `latest.json` endpoint can deliver an unsigned binary to users.

## To enable

1. Generate a keypair:

   ```bash
   npx tauri signer generate -w ~/.tauri/marktext.key
   # → emits the public key (paste into tauri.conf.json) and the private
   #   key (encrypted with the password you supplied).
   ```

2. Edit `src-tauri/tauri.conf.json`:

   ```jsonc
   "updater": {
     "active": true,
     "endpoints": ["https://your.update.server/latest.json"],
     "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6..."   // pasted from step 1
   }
   ```

3. Re-enable the plugin in [src-tauri/src/lib.rs](src-tauri/src/lib.rs)
   — uncomment the `tauri_plugin_updater::Builder::new().build()` line in
   the `#[cfg(desktop)]` block. (Stub left in place for that reason.)

4. In CI, sign each artefact with the private key. Tauri's `tauri build`
   reads `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
   env vars and writes `<bundle>.sig` alongside each output. Upload the
   `.sig` files together with the bundles.

5. Generate a `latest.json` per release pointing at the bundle + signature
   URLs; serve it from your endpoint. See
   <https://v2.tauri.app/plugin/updater/#latestjson-format>.

## Why we ship the plugin off

If you ship `active: true` with an empty `pubkey`, the plugin refuses to
verify anything — your user sees a generic "updater error" toast. The
intent of leaving it off is to fail closed until step 1–5 are wired.
