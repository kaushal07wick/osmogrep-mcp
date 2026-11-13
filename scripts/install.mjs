import { spawnSync } from "node:child_process";
import { mkdir, copyFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const client = process.argv[2];
if (!["codex", "claude"].includes(client)) {
  console.error("Usage: node scripts/install.mjs codex|claude");
  process.exit(1);
}
if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node.js 22 or newer is required.");
const root = fileURLToPath(new URL("../", import.meta.url));
const server = join(root, "cli/mcp.mjs");
const args = client === "codex"
  ? ["mcp", "add", "osmogrep", "--", process.execPath, server]
  : ["mcp", "add", "--scope", "user", "--transport", "stdio", "osmogrep", "--", process.execPath, server];
const child = spawnSync(client, args, { stdio: "inherit", shell: false });
if (child.error) throw new Error(`Install the ${client} CLI first: ${child.error.message}`);
if (child.status !== 0) process.exit(child.status || 1);
const destination = client === "codex"
  ? join(process.env.CODEX_HOME || join(homedir(), ".codex"), "skills/osmogrep-verify")
  : join(homedir(), ".claude/skills/osmogrep-verify");
await mkdir(destination, { recursive: true });
await copyFile(join(root, "skills/osmogrep-verify/SKILL.md"), join(destination, "SKILL.md"));
if (client === "codex") {
  await mkdir(join(destination, "agents"), { recursive: true });
  await copyFile(join(root, "skills/osmogrep-verify/agents/openai.yaml"), join(destination, "agents/openai.yaml"));
}
console.log(`Installed the OsmoGrep MCP connection and skill for ${client}.`);
console.log("Open a new client session to load the tools. The local OsmoGrep runtime service must be running.");
