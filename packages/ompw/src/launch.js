import path from "node:path";
import { constants } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const THIS_FILE = fileURLToPath(import.meta.url);
const SRC_DIR = path.dirname(THIS_FILE);
const PACKAGE_ROOT = path.dirname(SRC_DIR);
const WORKTREE_EXTENSION_PATH = path.join(PACKAGE_ROOT, "extensions", "worktree-awareness", "index.ts");

function hasExplicitExtension(ompArgs, extensionPath) {
	for (let index = 0; index < ompArgs.length; index += 1) {
		if (ompArgs[index] === "--extension" && ompArgs[index + 1] === extensionPath) {
			return true;
		}
	}
	return false;
}

function getSignalExitCode(signalName) {
	if (!signalName) return 1;
	const signalNumber = constants.signals[signalName];
	return typeof signalNumber === "number" ? 128 + signalNumber : 1;
}

export function getWorktreeExtensionPath() {
	return WORKTREE_EXTENSION_PATH;
}

export function buildWorktreeChildEnv({ session, originalCwd, extraEnv = {} }) {
	const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PI_WORKTREE_")));
	env.PI_WORKTREE_SESSION = "1";
	env.PI_WORKTREE_NAME = session.name;
	env.PI_WORKTREE_PATH = session.path;
	env.PI_WORKTREE_BRANCH = session.branch;
	env.PI_WORKTREE_REPO_ROOT = session.repoRoot;
	env.PI_WORKTREE_ORIGINAL_CWD = originalCwd;

	if (session.metadata) {
		env.PI_WORKTREE_METADATA_JSON = JSON.stringify(session.metadata);
	}

	return {
		...env,
		...extraEnv,
	};
}

export async function launchOmpSession({ session, ompArgs, ompBin, originalCwd }) {
	const resolvedOmpBin = ompBin || process.env.OMPW_OMP_BIN || "omp";
	const launchArgs = hasExplicitExtension(ompArgs, WORKTREE_EXTENSION_PATH)
		? [...ompArgs]
		: ["--extension", WORKTREE_EXTENSION_PATH, ...ompArgs];
	const env = buildWorktreeChildEnv({ session, originalCwd });

	return await new Promise((resolve, reject) => {
		const child = spawn(resolvedOmpBin, launchArgs, {
			cwd: session.path,
			env,
			stdio: "inherit",
		});

		child.once("error", (error) => {
			if (error?.code === "ENOENT") {
				reject(new Error(`Unable to launch omp using '${resolvedOmpBin}'.`));
				return;
			}
			reject(error);
		});

		child.once("exit", (code, signal) => {
			resolve(typeof code === "number" ? code : getSignalExitCode(signal));
		});
	});
}
