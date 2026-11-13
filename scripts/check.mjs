import assert from "node:assert/strict";
import {spawn,spawnSync} from "node:child_process";
import {serverOrigin,relativePath,proofStatus,operation,replayBundle,closeVerification} from "../cli/verification.mjs";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {EmptyResultSchema,LATEST_PROTOCOL_VERSION} from "@modelcontextprotocol/sdk/types.js";
import {createInterface} from "node:readline";
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
const existing={...state,reproRuns:[{base:{exitCode:1,afterFingerprint:"base"},candidate:{exitCode:0,afterFingerprint:"fixed"}}]};
assert.equal(proofStatus(existing,base,candidate).verified,true);
assert.equal(proofStatus({...existing,reproRuns:[...existing.reproRuns,{base:{exitCode:1,afterFingerprint:"base"},candidate:{exitCode:1,afterFingerprint:"fixed"}}]},base,candidate).verified,false,"A later failing reproducer invalidates an existing-bug repair");
assert.equal(proofStatus({...existing,reproRuns:[...existing.reproRuns,{base:{exitCode:0,afterFingerprint:"base"},candidate:{exitCode:0,afterFingerprint:"fixed"}}]},base,candidate).verified,false,"A disappearing differential is inconclusive");
const cleanupFetch=globalThis.fetch;
try{
  const attempts=[];
  globalThis.fetch=async(url,options)=>{attempts.push(JSON.parse(options.body).sandboxId);return new Response(JSON.stringify({error:"provider unavailable"}),{status:503});};
  await assert.rejects(closeVerification({server:"http://127.0.0.1:3001",base:{sandboxId:"base"},candidate:{sandboxId:"candidate"}}),/Could not destroy/);
  assert.deepEqual(attempts,["base","candidate"],"Attempt both cleanups even if one fails");
}finally{globalThis.fetch=cleanupFetch;}
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
const transport=new StdioClientTransport({command:process.execPath,args:["cli/mcp.mjs"],stderr:"pipe"});
const client=new Client({name:"osmogrep-compatibility-check",version:"1.0.0"});
try {
  await client.connect(transport);
  assert.equal(client.getServerVersion().name,"osmogrep-verification");
  assert(client.getServerCapabilities().tools);
  await client.ping();
  const {tools}=await client.listTools();
  assert.equal(tools.length,10);
  assert(!tools.some(tool=>tool.name==="host_shell"));
  assert(tools.find(tool=>tool.name==="write").inputSchema.required.includes("session"));
  assert.equal(tools.find(tool=>tool.name==="read").annotations.readOnlyHint,true);
  assert.equal(tools.find(tool=>tool.name==="command").annotations.destructiveHint,true);
  for(const [name,args,reason] of [
    ["context",{session:"unknown"},/Unknown session/],
    ["start",{repo:42,base:"HEAD"},/Invalid arguments/],
    ["read",{session:"unknown",revision:"host",path:"etc/passwd"},/Invalid arguments/],
    ["context",{session:"unknown",extra:"unexpected"},/Invalid arguments/],
    ["missing_tool",{},/not found/],
  ]) {
    const result=await client.callTool({name,arguments:args});
    assert(result.isError);assert.match(result.content[0].text,reason);
  }
  await assert.rejects(client.request({method:"unknown/method"},EmptyResultSchema),error=>error.code===-32601);
  await client.ping();
}finally{await client.close();}
// An unknown client version must negotiate a supported version, never echo it.
const child=spawn(process.execPath,["cli/mcp.mjs"],{stdio:["pipe","pipe","pipe"]});
const lines=createInterface({input:child.stdout});
try {
  const response=new Promise((resolve,reject)=>{lines.once("line",line=>resolve(JSON.parse(line)));child.once("error",reject);});
  child.stdin.write(JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"9999-01-01",capabilities:{},clientInfo:{name:"future-client",version:"1"}}})+"\n");
  assert.equal((await response).result.protocolVersion,LATEST_PROTOCOL_VERSION);
}finally{child.stdin.end();await new Promise(resolve=>child.once("close",resolve));lines.close();}
const fixedDirectory=await mkdtemp(join(tmpdir(),"osmogrep-fixed-check-"));
try {
  const file=join(fixedDirectory,"session.json");
  await writeFile(file,JSON.stringify({server:"http://127.0.0.1:3001",changedPaths:["src.js"],candidate:{localSource:{files:[{path:"src.js"}]}},reproRuns:[]}));
  const fixedClient=new Client({name:"fixed-check",version:"1"});
  try {
    await fixedClient.connect(new StdioClientTransport({command:process.execPath,args:["cli/mcp.mjs","--session",file],stderr:"pipe"}));
    const {tools}=await fixedClient.listTools();assert.equal(tools.length,8);
    const result=await fixedClient.callTool({name:"context",arguments:{}});
    assert(!result.isError);assert.deepEqual(result.structuredContent.changedPaths,["src.js"]);
    assert.deepEqual(JSON.parse(result.content[0].text),result.structuredContent);
  }finally{await fixedClient.close();}
}finally{await rm(fixedDirectory,{recursive:true,force:true});}
const missingBundle=spawnSync(process.execPath,["cli/replay.mjs"],{encoding:"utf8"});
assert.equal(missingBundle.status,1);assert.match(missingBundle.stderr,/Supply --bundle/);
const invalidClient=spawnSync(process.execPath,["scripts/install.mjs","unknown"],{encoding:"utf8"});
assert.equal(invalidClient.status,1);assert.match(invalidClient.stderr,/Usage:/);
console.log("Verification checks passed: official SDK client, protocol negotiation, schemas, structured results, method errors, loopback confinement, original-test guards, differential proof, stale rejection and replay integrity.");
