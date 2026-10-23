// A preview stamp is written only after npm ci and a successful local dependency-tree check.
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const stamp = (root) =>
  join(root, "node_modules", ".hris-preview-install.json");
export function fingerprint(root) {
  const hash = createHash("sha256");
  for (const name of ["package.json", "package-lock.json", ".npmrc"]) {
    hash.update(name + "\0");
    if (existsSync(join(root, name)))
      hash.update(readFileSync(join(root, name)));
    else if (name !== ".npmrc") throw Error("Dependency manifest missing.");
    hash.update("\0");
  }
  hash.update(
    JSON.stringify({
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      abi: process.versions.modules,
    }),
  );
  return hash.digest("hex");
}
function installed(root) {
  try {
    const lock = JSON.parse(
      readFileSync(join(root, "package-lock.json"), "utf8"),
    );
    for (const name of ["next", "typescript"]) {
      const actual = JSON.parse(
        readFileSync(join(root, "node_modules", name, "package.json"), "utf8"),
      );
      if (actual.version !== lock.packages?.[`node_modules/${name}`]?.version)
        return false;
    }
    if (!existsSync(join(root, "node_modules", "next", "dist", "bin", "next")))
      return false;
    const tree = spawnSync("npm", ["ls", "--all", "--silent"], {
      cwd: root,
      stdio: "ignore",
      timeout: 15000,
    });
    return !tree.error && tree.status === 0;
  } catch {
    return false;
  }
}
export function reusable(root) {
  try {
    return (
      JSON.parse(readFileSync(stamp(root), "utf8")).fingerprint ===
        fingerprint(root) && installed(root)
    );
  } catch {
    return false;
  }
}
export function record(root) {
  if (!installed(root))
    throw Error(
      "Dependency verification failed; the installation was not marked reusable.",
    );
  const target = stamp(root),
    temporary = target + `.${process.pid}.tmp`;
  try {
    writeFileSync(
      temporary,
      JSON.stringify({ fingerprint: fingerprint(root) }) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  try {
    if (process.argv[2] === "check") process.exitCode = reusable(root) ? 0 : 1;
    else if (process.argv[2] === "record") record(root);
    else throw Error("Use check or record.");
  } catch (e) {
    console.error(
      e instanceof Error ? e.message : "Dependency verification failed.",
    );
    process.exitCode = 1;
  }
}
