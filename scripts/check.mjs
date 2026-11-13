import assert from "node:assert/strict";
import {spawn,spawnSync} from "node:child_process";
import {serverOrigin,relativePath,proofStatus,operation,replayBundle} from "../cli/verification.mjs";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {renderReport} from "../cli/report.mjs";

assert.equal(serverOrigin(),"http://127.0.0.1:3001");
for(const url of ["https://evil.invalid","http://127.0.0.1.evil.invalid","http://user:pass@127.0.0.1:3001","http://127.0.0.1:3001/path"])assert.throws(()=>serverOrigin(url));
for(const path of ["../secrets",".env.local",".git/config","/etc/passwd","a\\b","a/../b"])assert.throws(()=>relativePath(path));
assert.equal(relativePath("src/feature.js"),"src/feature.js");
const unsafeHTML=renderReport({reason:'<script>alert("x")</script>',changedPaths:['<img src=x onerror=alert(1)>']});
assert(!unsafeHTML.includes("<script>"));assert(!unsafeHTML.includes("<img"));assert(unsafeHTML.includes("&lt;script&gt;"));
const passing={passed:true,originalTests:{status:"unchanged"}};
const base={changedFiles:["repro.js"],validation:passing,fingerprint:"base"};
const candidate={validation:passing,fingerprint:"fixed"};
const state={reproducer:{path:"repro.js"},reproRuns:[{base:{exitCode:0,afterFingerprint:"base"},candidate:{exitCode:1,afterFingerprint:"broken"}},{base:{exitCode:0,afterFingerprint:"base"},candidate:{exitCode:0,afterFingerprint:"fixed"}}]};
assert.equal(proofStatus(state,base,candidate).verified,true);
assert.equal(proofStatus({...state,reproRuns:[state.reproRuns[0]]},base,candidate).verified,false);
assert.equal(proofStatus(state,{...base,changedFiles:["src/changed.js"]},candidate).verified,false);
assert.equal(proofStatus(state,base,{...candidate,fingerprint:"later"}).verified,false);
assert.equal(proofStatus(state,base,{...candidate,validation:{...passing,originalTests:{status:"changed"}}}).verified,false);
assert.equal(proofStatus({...state,reproRuns:[{...state.reproRuns[1]}]},base,candidate).verified,false,"Both versions passing is not a differential finding");
const directory=await mkdtemp(join(tmpdir(),"osmogrep-verification-check-"));
try{
  const file=join(directory,"session.json");
  await writeFile(file,JSON.stringify({server:"http://127.0.0.1:3001",reproRuns:[]}));
  await assert.rejects(operation(file,"write",{path:"src.js",content:"changed"}),/unmodified candidate/);
  await writeFile(file,JSON.stringify({server:"http://127.0.0.1:3001",reproRuns:[{}],initial:{candidate:{profile:{basis:["package.json"]},report:{originalTests:{files:[{path:"/workspace/test_run.js"}]}}}}}));
  await assert.rejects(operation(file,"write",{path:"test_run.js",content:"weakened"}),/Preserve original tests/);
  await writeFile(file,JSON.stringify({server:"http://127.0.0.1:3001",base:{sandboxId:"base-fixture"},candidate:{sandboxId:"candidate-fixture"},reproRuns:[],reproducer:{path:"repro.js"}}));
  const originalFetch=globalThis.fetch;
  try{
    globalThis.fetch=async url=>new Response(JSON.stringify({changedFiles:String(url).includes("candidate-fixture")?["source.js"]:["repro.js"]}));
    await assert.rejects(operation(file,"compare",{command:"node repro.js"}),/untouched captured source/);
  }finally{globalThis.fetch=originalFetch;}
  await writeFile(join(directory,"replay.json"),JSON.stringify({reproducer:{content:"altered",sha256:"wrong"}}));
  await assert.rejects(replayBundle(directory,"fixed"),/recorded hash/);
  const digest=value=>createHash("sha256").update(value).digest("hex");
  await mkdir(join(directory,"sources","fixed"),{recursive:true});
  await writeFile(join(directory,"sources","fixed","a.js"),"changed source");
  await writeFile(join(directory,"replay.json"),JSON.stringify({reproducer:{content:"test",sha256:digest("test")},sourceManifests:{fixed:[{path:"a.js",sha256:digest("original")} ]}}));
  await assert.rejects(replayBundle(directory,"fixed"),/Replay source changed/);
}finally{await rm(directory,{recursive:true,force:true});}
const child=spawn(process.execPath,["cli/mcp.mjs","--session","/unused/session.json"],{stdio:["pipe","pipe","pipe"]});
let text="";child.stdout.on("data",chunk=>text+=chunk);
child.stdin.end(JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-06-18"}})+"\n"+JSON.stringify({jsonrpc:"2.0",id:2,method:"tools/list"})+"\n");
await new Promise((resolve,reject)=>{child.on("error",reject);child.on("close",code=>code?reject(new Error("MCP startup failed")):resolve());});
const messages=text.trim().split("\n").map(line=>JSON.parse(line));
assert.equal(messages[0].result.protocolVersion,"2025-06-18");
assert(messages[1].result.tools.some(tool=>tool.name==="compare"));
assert(!messages[1].result.tools.some(tool=>tool.name==="host_shell"));
const manager=spawn(process.execPath,["cli/mcp.mjs"],{stdio:["pipe","pipe","pipe"]});
let managedText="";manager.stdout.on("data",chunk=>managedText+=chunk);
manager.stdin.end([
  {jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-06-18"}},
  {jsonrpc:"2.0",id:2,method:"tools/list"},
  {jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"context",arguments:{session:"unknown"}}},
  {jsonrpc:"2.0",id:4,method:"tools/call",params:{name:"start",arguments:{repo:42,base:"HEAD"}}},
  {jsonrpc:"2.0",id:5,method:"tools/call",params:{name:"read",arguments:{session:"unknown",revision:"host",path:"etc/passwd"}}},
].map(value=>JSON.stringify(value)).join("\n")+"\n");
await new Promise((resolve,reject)=>{manager.on("error",reject);manager.on("close",code=>code?reject(new Error("Managed MCP startup failed")):resolve());});
const managed=managedText.trim().split("\n").map(line=>JSON.parse(line));
assert(managed[1].result.tools.some(tool=>tool.name==="start"));
assert(managed[1].result.tools.some(tool=>tool.name==="close"));
assert(managed[1].result.tools.find(tool=>tool.name==="write").inputSchema.required.includes("session"));
assert(managed[2].result.isError);assert.match(managed[2].result.content[0].text,/Unknown session/);
assert.equal(managed[3].error.code,-32602);
assert.match(managed[4].error.message,/revision/i);
const missingBundle=spawnSync(process.execPath,["cli/replay.mjs"],{encoding:"utf8"});
assert.equal(missingBundle.status,1);assert.match(missingBundle.stderr,/Supply --bundle/);
const invalidClient=spawnSync(process.execPath,["scripts/install.mjs","unknown"],{encoding:"utf8"});
assert.equal(invalidClient.status,1);assert.match(invalidClient.stderr,/Usage:/);
console.log("Verification checks passed: loopback-only transport, confined paths, original-test guards, differential proof, stale rejection and MCP handshake.");
