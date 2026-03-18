# omp-config

Custom Oh My Pi (`omp`) skills and a worktree-aware wrapper CLI for repository-local coding sessions.

This repo contains two related pieces:

- `skills/` — reusable OMP skills loaded through `skills.customDirectories`
- `packages/ompw/` — a git worktree wrapper for `omp` that injects `worktree_info` into managed sessions

## Repository layout

```text
skills/
  my-commit-staged/
  my-commit-changes/
  my-integrate-worktree/
packages/
  ompw/
```

## What is included

### Skills

- `my-commit-staged`
  - Commits only what is already staged using a single Conventional Commit message.
- `my-commit-changes`
  - Reviews all uncommitted changes, groups them into atomic Conventional Commits, and creates a safety stash snapshot before mutating git state.
- `my-integrate-worktree`
  - Integrates an `ompw`-managed branch into its recorded target branch using authoritative `worktree_info` metadata.
  - This skill is intentionally fail-closed and only works inside an active `ompw` session.

### Wrapper CLI

- `ompw`
  - Creates or reuses named git worktrees
  - Launches `omp` inside the selected worktree
  - Injects a private worktree-awareness extension
  - Exposes a read-only `worktree_info` tool inside the session
  - Persists metadata used by cleanup and integration workflows
  - Supports repo-scoped session hooks

## Configure OMP to discover these skills

OMP does not auto-discover a top-level `skills/` directory in a repo. Configure the user-level OMP config instead.

Edit:

```text
~/.omp/agent/config.yml
```

Add this entry under `skills.customDirectories`:

```yaml
skills:
  customDirectories:
    - /Users/marceloschroeder/myfiles/projects/omp-config/skills
```

Notes:

- Use an absolute path.
- Merge this into any existing `skills.customDirectories` list instead of replacing other entries.
- This is a user-level setting so the same OMP install can reuse these skills from multiple projects.

## Verify skill discovery

From this repo or any other repo, run:

```bash
omp -p --no-session "/skill:my-commit-staged
Reply with exactly: skill-loaded"
```

Expected output:

```text
skill-loaded
```

## Install and expose `ompw`

From this repo root:

```bash
npm --prefix packages/ompw install
npm --prefix packages/ompw link
```

Or with the equivalent two-step form:

```bash
cd packages/ompw
npm install
npm link
```

After linking, verify:

```bash
ompw --help
```

## Using `ompw`

### Basic usage

From inside a git repository:

```bash
ompw
ompw feature-auth
ompw feature-auth -- --model sonnet:high
ompw feature-auth --base develop --target develop
```

### Commands

```bash
ompw [name] [options] [-- <omp args...>]
ompw list
ompw path <name>
ompw rm <name>
ompw rename <old-name> <new-name>
```

### Important behavior

- Managed branches use the prefix `ompw/`.
- Managed worktrees are stored beside the repo in `<repo>.worktrees/<name>`.
- Auto-generated clean worktrees are deleted on clean exit by default.
- Explicitly named clean worktrees prompt before deletion by default.
- Cleanup protection uses persisted integration metadata when available.
- The wrapper passes a private extension with `--extension` and exposes `worktree_info` inside managed sessions.

## `worktree_info` and managed sessions

Inside an `ompw`-launched OMP session, the private extension provides `worktree_info`.

That tool is the authoritative source for:

- worktree name
- branch
- path
- repo root
- original launch directory
- whether persisted metadata is complete
- recorded base and integration metadata

Skills that operate on managed worktrees should use `worktree_info` instead of guessing from filesystem layout or upstream tracking.

## Using the included skills

### `my-commit-staged`

Inside OMP:

```text
/skill:my-commit-staged
```

Use it when the staging area already contains exactly what should be committed.

### `my-commit-changes`

Inside OMP:

```text
/skill:my-commit-changes
```

Use it when the working tree has staged, unstaged, or untracked changes that should be committed.

This skill uses the bundled helper:

```text
skill://my-commit-changes/scripts/create-stash-snapshot.sh
```

### `my-integrate-worktree`

Inside an `ompw` session:

```text
/skill:my-integrate-worktree
```

This skill requires:

- an active `ompw`-managed session
- `worktree_info.active === true`
- `worktree_info.kind === "ompw"`
- `worktree_info.managed === true`
- `worktree_info.metadataComplete === true`
- a managed branch starting with `ompw/`
- recorded integration metadata

If you run it outside `ompw`, it should stop with:

```text
This skill requires an ompw-managed worktree session. Re-launch the task with ompw.
```

## Hook configuration for `ompw`

`ompw` supports two optional repo-root config files:

- `ompw.config.json` — committed shared config
- `.ompw.local.json` — untracked local config

Shared config is read from the target worktree root. Local config is read from the checkout where `ompw` was invoked.

Example:

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

Hook commands run with:

- `cwd` set to the target worktree root
- inherited stdio
- `PI_WORKTREE_*` environment variables for session metadata
- `OMPW_HOOK_*` environment variables describing the hook execution

## Development and verification

Run the `ompw` tests:

```bash
cd packages/ompw
node --test ./test/*.test.js
```

Useful smoke checks:

```bash
ompw --help
./skills/my-integrate-worktree/scripts/integrate_worktree.sh --help
./skills/my-commit-changes/scripts/create-stash-snapshot.sh --help
```

## Requirements

Runtime tools used by this repo:

- `omp`
- `node`
- `npm`
- `git`
- `bash`
- `mktemp`
- `date`
- standard POSIX shell utilities
