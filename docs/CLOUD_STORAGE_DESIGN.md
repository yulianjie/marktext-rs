# Cloud storage architecture

MarkText cloud storage is local-first. The editor, project tree, search, image
resolver, and file watcher continue to operate on a normal local directory.
The Rust storage layer synchronizes that working copy with one configured
provider. A failed network request must never make a successful local save
fail.

## Supported providers

Only four provider families are in scope:

1. **Self-hosted MarkText Sync** — a separate private service and repository.
2. **Git** — an existing local checkout with a configured remote and branch.
3. **WebDAV** — standards-based file and directory synchronization.
4. **Plugin** — all other cloud services are external executables speaking the
   versioned storage plugin protocol. No additional cloud API belongs in the
   desktop application.

`selfHosted`, `git`, and `webdav` are built in. `plugin` is the single extension
point and must not be specialized for individual vendors in renderer code.

## Trust boundary

- Vue receives connection metadata, capability flags, and `hasSecret` only.
- Passwords and tokens are accepted by a save/test command, immediately moved
  into the OS credential store, and never persisted in preferences or logs.
- All network and child-process access is owned by Rust.
- Plugin processes are launched directly without a shell, use newline-delimited
  JSON-RPC over stdio, have bounded messages and deadlines, and receive only
  the connection and workspace involved in the current request.
- A plugin is trusted native code running with the user's OS account; this
  protocol boundary is not an operating-system sandbox. Install manifests and
  executables only from trusted sources.
- A plugin manifest declares protocol version and capabilities. Unknown
  protocol versions and undeclared operations are rejected before launch.

## Provider contract

Every provider exposes the same logical operations:

```text
probe
list(path)
read(resource)
write(path, bytes, expectedVersion | createOnly)
createDirectory(path)
move(source, destination, expectedVersion)
delete(path, expectedVersion)
changes(cursor)             optional capability
```

Providers return opaque versions. WebDAV uses a strong ETag where available;
MarkText Sync uses its revision; plugins choose a value with equivalent
compare-and-swap semantics. A provider without conditional writes is marked
unsafe and may create conflict copies but may not automatically overwrite a
remote object.

## Working copy and state

Each binding maps one connection and remote root to one explicit local root.
The local root remains user-visible and editable by other tools. A private
manifest records only synchronization metadata:

```text
relative path
local content hash
remote resource id
remote version
last synchronized base hash
tombstone state
```

Editor `isSaved` continues to mean "written to the local working copy". Cloud
state is separate: `synced`, `pending`, `syncing`, `offline`, `conflict`, or
`error`.

## Conflict policy

The synchronization engine compares base, local, and remote states:

- only local changed: conditionally upload;
- only remote changed: atomically replace the clean local working copy;
- both changed: preserve both and create an explicit conflict;
- delete versus edit: preserve the edited side until the user decides.

There is no silent last-writer-wins fallback.

Git conflict handling offers two paths:

1. Continue in the working tree and resolve manually with normal Git tools.
2. Send bounded base/local/remote conflict hunks to the existing writing Agent.
   The Agent may produce a reviewed edit proposal only. It cannot apply,
   commit, push, reset, force-push, or read the whole repository implicitly.

## Self-hosted service

The private `marktext-sync-server` repository owns authentication, SQLite
metadata, filesystem blobs, stable entry IDs, immutable revisions, a monotonic
change cursor, conditional writes, and version recovery. It is deployable with
Docker Compose and exposes no desktop credentials.

## Delivery boundaries

- Phase 1: provider contract, connection management, credential storage,
  capability probing, manual synchronization, status and conflict reporting.
- Phase 2: background retry queue, change polling, and per-workspace scheduling.
- Phase 3: version browser and richer reviewed three-way merge UI.

Native Tauri tests must cover credential isolation, process boundaries, local
watcher interaction, restart recovery, two-client races, and offline saves.
Browser-only tests do not establish those guarantees.
