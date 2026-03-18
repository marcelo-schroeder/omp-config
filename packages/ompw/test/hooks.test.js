import assert from "node:assert/strict";
import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createTempRepo, expectedWorktreePath, git, readJson, runOmpw } from "./helpers.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(TEST_DIR, "fixtures");
const CAPTURE_HOOK_PATH = path.join(FIXTURES_DIR, "capture-hook.js");

function quoteShellArg(value) {
	return JSON.stringify(value);
}

function buildHookCommand(label) {
	return `${quoteShellArg(process.execPath)} ${quoteShellArg(CAPTURE_HOOK_PATH)} ${quoteShellArg(label)}`;
}

async function writeJson(filePath, value) {
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fileExists(targetPath) {
	try {
		await access(targetPath);
		return true;
	} catch {
		return false;
	}
}

test("runs machine-local session-setup hooks for newly created worktrees", async () => {
	const repo = await createTempRepo({ withOrigin: false });
	const hookCapturePath = path.join(repo.tempRoot, "capture", "local-hook.json");
	const ompCapturePath = path.join(repo.tempRoot, "capture", "omp.json");
	const worktreePath = expectedWorktreePath(repo.repoPath, "feature-auth");

	try {
		await writeJson(path.join(repo.repoPath, ".ompw.local.json"), {
			hooks: {
				"session-setup": [
					{
						name: "local-create",
						command: buildHookCommand("local-create"),
						when: "create",
					},
				],
			},
		});

		const result = await runOmpw({
			cwd: repo.repoPath,
			args: ["feature-auth"],
			env: {
				OMPW_HOOK_CAPTURE_PATH: hookCapturePath,
				OMPW_FAKE_OMP_CAPTURE: ompCapturePath,
			},
		});

		assert.equal(result.code, 0);
		const hookRecords = await readJson(hookCapturePath);
		assert.equal(hookRecords.length, 1);
		assert.deepEqual(hookRecords[0].argv, ["local-create"]);
		assert.equal(hookRecords[0].cwd, worktreePath);
		assert.equal(hookRecords[0].env.OMPW_HOOK_EVENT, "session-setup");
		assert.equal(hookRecords[0].env.OMPW_HOOK_MODE, "create");
		assert.equal(hookRecords[0].env.OMPW_HOOK_SOURCE_KIND, "local");
		assert.equal(hookRecords[0].env.PI_WORKTREE_NAME, "feature-auth");
		assert.equal(hookRecords[0].env.PI_WORKTREE_PATH, worktreePath);
		assert.equal(await fileExists(ompCapturePath), true);
		assert.equal(await fileExists(path.join(worktreePath, ".ompw.local.json")), false);
	} finally {
		await repo.cleanup();
	}
});

test("merges shared and local hooks and respects create vs reuse filters", async () => {
	const repo = await createTempRepo({ withOrigin: false });
	const hookCapturePath = path.join(repo.tempRoot, "capture", "merged-hooks.json");
	const worktreePath = expectedWorktreePath(repo.repoPath, "feature-auth");

	try {
		await writeJson(path.join(repo.repoPath, "ompw.config.json"), {
			hooks: {
				"session-setup": [
					{
						name: "shared-create",
						command: buildHookCommand("shared-create"),
						when: "create",
					},
					{
						name: "shared-reuse",
						command: buildHookCommand("shared-reuse"),
						when: "reuse",
					},
				],
			},
		});
		await git(["add", "ompw.config.json"], repo.repoPath);
		await git(["commit", "-m", "add shared ompw hook config"], repo.repoPath);

		await writeJson(path.join(repo.repoPath, ".ompw.local.json"), {
			hooks: {
				"session-setup": [
					{
						name: "local-always",
						command: buildHookCommand("local-always"),
						when: "always",
					},
				],
			},
		});

		const createResult = await runOmpw({
			cwd: repo.repoPath,
			args: ["feature-auth"],
			env: { OMPW_HOOK_CAPTURE_PATH: hookCapturePath },
		});
		assert.equal(createResult.code, 0);
		assert.equal(await fileExists(path.join(worktreePath, "ompw.config.json")), true);

		const reuseResult = await runOmpw({
			cwd: repo.repoPath,
			args: ["feature-auth"],
			env: { OMPW_HOOK_CAPTURE_PATH: hookCapturePath },
		});
		assert.equal(reuseResult.code, 0);

		const hookRecords = await readJson(hookCapturePath);
		assert.deepEqual(
			hookRecords.map((record) => record.argv[0]),
			["shared-create", "local-always", "shared-reuse", "local-always"],
		);
		assert.equal(hookRecords[0].env.OMPW_HOOK_SOURCE_KIND, "shared");
		assert.equal(hookRecords[1].env.OMPW_HOOK_SOURCE_KIND, "local");
		assert.equal(hookRecords[2].env.OMPW_HOOK_MODE, "reuse");
		assert.equal(hookRecords[3].env.OMPW_HOOK_MODE, "reuse");
	} finally {
		await repo.cleanup();
	}
});

test("aborts before launching omp when a hook fails", async () => {
	const repo = await createTempRepo({ withOrigin: false });
	const hookCapturePath = path.join(repo.tempRoot, "capture", "failing-hook.json");
	const ompCapturePath = path.join(repo.tempRoot, "capture", "omp.json");

	try {
		await writeJson(path.join(repo.repoPath, ".ompw.local.json"), {
			hooks: {
				"session-setup": [
					{
						name: "failing-hook",
						command: buildHookCommand("failing-hook"),
						when: "create",
					},
				],
			},
		});

		const result = await runOmpw({
			cwd: repo.repoPath,
			args: ["feature-auth"],
			env: {
				OMPW_HOOK_CAPTURE_PATH: hookCapturePath,
				OMPW_TEST_HOOK_EXIT_CODE: "7",
				OMPW_FAKE_OMP_CAPTURE: ompCapturePath,
			},
		});

		assert.equal(result.code, 1);
		assert.match(result.stderr, /Hook 'failing-hook' failed with exit code 7\./);
		assert.equal((await readJson(hookCapturePath)).length, 1);
		assert.equal(await fileExists(ompCapturePath), false);
	} finally {
		await repo.cleanup();
	}
});

test("--skip-hooks bypasses configured hooks", async () => {
	const repo = await createTempRepo({ withOrigin: false });
	const hookCapturePath = path.join(repo.tempRoot, "capture", "skipped-hooks.json");
	const ompCapturePath = path.join(repo.tempRoot, "capture", "omp.json");

	try {
		await writeJson(path.join(repo.repoPath, ".ompw.local.json"), {
			hooks: {
				"session-setup": [
					{
						name: "local-create",
						command: buildHookCommand("local-create"),
						when: "create",
					},
				],
			},
		});

		const result = await runOmpw({
			cwd: repo.repoPath,
			args: ["feature-auth", "--skip-hooks"],
			env: {
				OMPW_HOOK_CAPTURE_PATH: hookCapturePath,
				OMPW_FAKE_OMP_CAPTURE: ompCapturePath,
			},
		});

		assert.equal(result.code, 0);
		assert.equal(await fileExists(hookCapturePath), false);
		assert.equal(await fileExists(ompCapturePath), true);
	} finally {
		await repo.cleanup();
	}
});
