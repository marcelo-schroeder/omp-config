# ompw

`ompw` is a user-owned git worktree wrapper for `omp`.

It creates or reuses a named worktree, launches `omp` inside it, injects worktree awareness through a private extension, persists small worktree metadata for automation, can run configurable session hooks, and cleans up disposable worktrees on exit.

## Layout

Everything related to this feature lives under `packages/ompw/`:

- wrapper CLI: `bin/` + `src/`
- private omp extension: `extensions/worktree-awareness/`
- tests: `test/`

This keeps the repo root clean and avoids making the helper extension look like a general-purpose top-level extension.

## Usage

From the repo root:

```bash
node packages/ompw/bin/ompw.js
node packages/ompw/bin/ompw.js feature-auth
node packages/ompw/bin/ompw.js feature-auth -- --model sonnet:high
node packages/ompw/bin/ompw.js feature-auth --base develop --target develop
```

Or install/link the package locally:

```bash
cd packages/ompw
npm link
ompw feature-auth
```

## Commands

```bash
ompw [name] [options] [-- <omp args...>]
ompw list
ompw path <name>
ompw rm <name>
ompw rename <old-name> <new-name>
```

## Naming and storage

Managed worktrees use:

- branch: `ompw/<name>`
- path: `<repo-parent>/<repo-name>.worktrees/<name>`

So `ompw rename <old-name> <new-name>` updates the managed branch, managed path, and persisted metadata together.
Renaming the currently active worktree from inside itself is intentionally not supported.

Example for this repo:

```text
/Users/marceloschroeder/myfiles/projects/omp-config
/Users/marceloschroeder/myfiles/projects/omp-config.worktrees/feature-auth
```

So the runtime worktree directories live **outside** the repo root.

## Options

### Run mode

- `--base <branch>`: base branch or revision for new worktrees
- `--target <branch>`: intended integration target on `origin` for new worktrees
- `--keep-clean`: keep a clean worktree after `omp` exits
- `--delete-clean`: delete a clean worktree after `omp` exits
- `--keep-dirty`: keep a protected worktree after `omp` exits
- `--delete-dirty`: delete a protected worktree after `omp` exits
- `--yes`: skip confirmations needed by delete flags
- `--skip-hooks`: skip configured session hooks
- `--omp-bin <path>`: override the `omp` executable, useful for testing
- `--debug`: print extra wrapper diagnostics

### Clean-exit defaults

- auto-generated worktrees created via `ompw` are treated as disposable and are deleted on clean exit by default
- explicitly named worktrees such as `ompw feature-auth` prompt on clean exit by default so you can choose whether to keep or delete them
- clean-exit disposal follows the worktree's persisted creation metadata, so reopening an auto-generated worktree by name still deletes it on clean exit by default, while reopening an explicitly named worktree still prompts by default
- clean-exit protection derives both `refs/heads/<target-branch>` and `refs/remotes/<remote>/<target-branch>` from the recorded integration metadata when available
- if the worktree `HEAD` is already contained in either derived target ref, `ompw` treats it as integrated for cleanup purposes
- worktrees with uncommitted changes, commits not yet merged into either derived target ref, or unknown integration state still prompt whether to keep or delete unless you override that with flags
- if `ompw` cannot verify the recorded target safely, it keeps the worktree by default in non-interactive mode

## Hook configuration

`ompw` supports repo-scoped session hooks.

### Config files

Two optional JSON files are supported:

- `ompw.config.json`: committed, shared hook config
- `.ompw.local.json`: untracked, machine-local hook config

Both files are repo-root files.

### Which checkout they come from

Hook config is loaded from two places:

- shared config (`ompw.config.json`) is read from the **target session checkout root**
- local config (`.ompw.local.json`) is read from the **checkout root where `ompw` was invoked**

That split keeps shared hook behavior branch-aware while still allowing a machine-local setup file to affect newly created worktrees.

For example, if you run `ompw` from a main checkout that has `.ompw.local.json`, that local config can run setup hooks for a newly created worktree even though the new worktree does not yet contain that untracked file.

### Supported event

Current supported hook event:

- `session-setup`: runs after the worktree is created or reused and metadata is available, but before `omp` launches

### Hook shape

```json
{
  "hooks": {
    "session-setup": [
      {
        "name": "setup-worktree",
        "command": "./scripts/setup_worktree.sh",
        "when": "create",
        "onFailure": "abort"
      }
    ]
  }
}
```

Hook fields:

- `name`: display name in `ompw` output; defaults to the command when omitted
- `command`: shell command to run from the target worktree root
- `when`: `create`, `reuse`, or `always` (default: `always`)
- `onFailure`: `abort` or `continue` (default: `abort`)

Shared hooks run first, then local hooks.

Hook commands run with:

- `cwd` set to the target worktree root
- inherited stdio
- the usual `PI_WORKTREE_*` environment variables
- additional hook env vars:
  - `OMPW_HOOK_EVENT`
  - `OMPW_HOOK_MODE`
  - `OMPW_HOOK_NAME`
  - `OMPW_HOOK_SOURCE_KIND`
  - `OMPW_HOOK_SOURCE_PATH`

If a hook fails and `onFailure` is `abort`, `ompw` stops before launching `omp` and leaves the worktree in place for inspection.

Example machine-local config:

```json
{
  "hooks": {
    "session-setup": [
      {
        "name": "bootstrap-worktree",
        "command": "./scripts/setup_worktree.sh",
        "when": "create",
        "onFailure": "abort"
      }
    ]
  }
}
```

A good place for that is:

```text
/path/to/repo/.ompw.local.json
```

## Persisted metadata

For each managed worktree, `ompw` stores a small JSON metadata file in the worktree's git admin area.

That metadata records:

- worktree identity (`name`, `branch`, `repoRoot`)
- whether the worktree name was explicit or auto-generated
- the creation base (`base.input`, `base.resolvedRef`, `base.commit`)
- the intended integration target on `origin`
- whether the worktree was created from the target commit (`integration.createdFromTarget`)

This metadata is used to make automation safer. For example, a skill can refuse to integrate a worktree when its target metadata is missing, ambiguous, or clearly not based on the intended target branch.

### Target behavior

- If you pass `--target <branch>`, `ompw` records that branch as the intended integration target on `origin`.
- If you omit `--target`, `ompw` tries to infer a target only when the base is a local branch and `origin/<branch>` exists.
- When `--base` is omitted and `ompw` can determine a target safely, new worktrees prefer the recorded target tip over a diverged local branch tip. For example, if local `main` is ahead of `origin/main`, `ompw` creates the worktree from `origin/main` by default so `integration.createdFromTarget` remains true.
- Passing `--base` keeps the requested base exactly as provided, even if it differs from the recorded target tip.
- If no safe target can be derived, the worktree still works normally, but metadata-backed integration workflows should treat it as incomplete.
- Existing older worktrees that predate metadata remain reusable, but they are intentionally treated as metadata-incomplete.

Examples:

```bash
ompw feature-auth --base develop --target develop
ompw feature-auth --base main --target main
```

Use the target branch that the work is intended to land in.

## Private extension behavior

`ompw` launches `omp` with its private extension:

```text
packages/ompw/extensions/worktree-awareness/index.ts
```

That extension:

- reads `PI_WORKTREE_*` environment variables
- injects worktree-aware instructions into the system prompt
- registers a read-only `worktree_info` tool

The `worktree_info` tool is the authoritative source for wrapper session metadata. It includes:

- worktree name, branch, path, and repo root
- the original launch directory
- whether persisted metadata is complete
- base and integration metadata when available

The extension is intentionally kept inside `packages/ompw/` because it is an implementation detail of this feature, not a standalone extension for normal sessions.

## Integration workflows

Skills that integrate a `ompw` worktree should:

- require the `worktree_info` tool
- rely on `worktree_info` instead of filesystem-layout guesses or upstream tracking
- use the real branch from `worktree_info` (for example `ompw/feature-auth`)
- rebase against the recorded integration target from `worktree_info.integration`
- refuse integration when `metadataComplete` is false

## Development

Run the package tests:

```bash
cd packages/ompw
npm test
```
