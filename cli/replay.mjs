import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { replayBundle } from "./verification.mjs";
try {
  const { values } = parseArgs({ options: { bundle: { type: "string" }, revision: { type: "string", default: "fixed" } } });
  if (!values.bundle) throw new Error("Supply --bundle /path/to/export and optional --revision base|working|fixed.");
  const result = await replayBundle(resolve(values.bundle), values.revision);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.exitCode === 0 ? 0 : 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
