import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { record, reusable } from "../scripts/preview-dependencies.mjs";
const root = mkdtempSync(join(tmpdir(), "hris-deps-"));
const json = (file, value) =>
  writeFileSync(join(root, file), JSON.stringify(value));
try {
  const manifest = {
    name: "preview-fixture",
    version: "1.0.0",
    dependencies: { next: "1.2.3", typescript: "4.5.6" },
  };
  const lock = {
    name: "preview-fixture",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "": manifest,
      "node_modules/next": { version: "1.2.3" },
      "node_modules/typescript": { version: "4.5.6" },
    },
  };
  json("package.json", manifest);
  json("package-lock.json", lock);
  mkdirSync(join(root, "node_modules/next/dist/bin"), { recursive: true });
  mkdirSync(join(root, "node_modules/typescript"), { recursive: true });
  json("node_modules/next/package.json", { name: "next", version: "1.2.3" });
  json("node_modules/typescript/package.json", {
    name: "typescript",
    version: "4.5.6",
  });
  writeFileSync(join(root, "node_modules/next/dist/bin/next"), "fixture");
  assert.equal(reusable(root), false, "Unrecorded installs are not trusted");
  record(root);
  assert.equal(reusable(root), true);
  json("package.json", { ...manifest, description: "changed manifest" });
  assert.equal(reusable(root), false);
  record(root);
  assert.equal(reusable(root), true);
  json("package-lock.json", { ...lock, description: "changed lock" });
  assert.equal(reusable(root), false);
  record(root);
  writeFileSync(join(root, ".npmrc"), "fund=false\n");
  assert.equal(reusable(root), false);
  record(root);
  assert.equal(reusable(root), true);
  json("node_modules/next/package.json", { name: "next", version: "1.2.4" });
  assert.equal(reusable(root), false);
  assert.throws(() => record(root), /verification failed/);
  json("node_modules/next/package.json", {
    name: "next",
    version: "1.2.3",
    dependencies: { "missing-preview-fixture": "1.0.0" },
  });
  assert.equal(
    reusable(root),
    false,
    "Missing transitive dependency must fail npm ls",
  );
  assert.throws(() => record(root), /verification failed/);
  json("node_modules/next/package.json", { name: "next", version: "1.2.3" });
  assert.equal(reusable(root), true);
  rmSync(join(root, "node_modules/next/dist/bin/next"));
  assert.equal(reusable(root), false);
  writeFileSync(join(root, "node_modules/next/dist/bin/next"), "fixture");
  const stamp = join(root, "node_modules/.hris-preview-install.json");
  writeFileSync(stamp, "broken");
  assert.equal(reusable(root), false);
  record(root);
  assert.equal(reusable(root), true);
  assert.equal(JSON.parse(readFileSync(stamp, "utf8")).fingerprint.length, 64);
  console.log(
    "PASS: preview reuses verified dependency trees; changed manifests, lockfile, npm config, wrong versions, missing binaries/transitive dependencies and corrupted stamps require repair.",
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
