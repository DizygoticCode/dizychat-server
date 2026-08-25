import fs from "node:fs";

const preservedPaths = [
  "scripts/tests/rumble-userscript-version-source.test.mjs",
  "scripts/tests/rumble-burn-master-alias-source.test.mjs",
  "scripts/tests/rumble-burn-reply-delay-source.test.mjs"
];

const preserved = new Map(preservedPaths.map((path) => [path, fs.readFileSync(path, "utf8")]));

try {
  await import("./patch-rumble-burn-selected-user.mjs");
} finally {
  for (const [path, content] of preserved) fs.writeFileSync(path, content);
}
