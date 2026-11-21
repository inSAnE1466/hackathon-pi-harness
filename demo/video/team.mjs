#!/usr/bin/env node
// Writes assets/team.js (gitignored) with the team password from .dev.vars, for the closing card.
//
//   node team.mjs    reads TEAM_PASSWORD from the environment or from .dev.vars at the repository root
//
// The password never goes into a committed file, and this script never prints it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let pw = process.env.TEAM_PASSWORD?.trim();
const vars = join(here, "..", "..", ".dev.vars");
if (!pw && existsSync(vars)) {
  for (const line of readFileSync(vars, "utf8").split("\n")) {
    const m = line.match(/^\s*TEAM_PASSWORD\s*=\s*(.*)\s*$/);
    if (m) pw = m[1].replace(/^["']|["']$/g, "").trim();
  }
}
if (!pw) {
  console.error("TEAM_PASSWORD is not set; the closing card shows the address only.");
  writeFileSync(join(here, "assets", "team.js"), "window.TEAM_PASSWORD = null;\n");
  process.exit(0);
}
writeFileSync(join(here, "assets", "team.js"), `window.TEAM_PASSWORD = ${JSON.stringify(pw)};\n`);
console.log("assets/team.js written (password not shown)");
