import {mkdir,readFile,writeFile,rename,rm,chmod,realpath} from "node:fs/promises";
import {resolve,join,dirname,posix} from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
import {renderReport} from "./report.mjs";

const hash=value=>createHash("sha256").update(value).digest("hex");
export const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
export function serverOrigin(value="http://127.0.0.1:3001") {
  const url=new URL(value);
  if(!["http:","https:"].includes(url.protocol)||!["localhost","127.0.0.1","[::1]"].includes(url.hostname)||url.username||url.password||url.pathname!=="/"||url.search||url.hash)throw new Error("This local preview accepts only a loopback OsmoGrep server origin.");
  return url.origin;
}
export function relativePath(value) {
  if(typeof value!=="string"||value.length>1000||!value||value.startsWith("/")||value.includes("\\")||value.includes("\0")||value.split("/").some(part=>!part||part==="."||part===".."||part===".git"||part.startsWith(".env")))throw new Error("Use a safe relative source path.");
  return value;
}
async function api(state,path,body,method) {
  const response=await fetch(serverOrigin(state.server)+"/api/sandbox/"+path,{method:method||(body?"POST":"GET"),...(body?{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(240000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||`OsmoGrep returned HTTP ${response.status}`);return data;
}
const sandbox=(state,revision)=>{if(!["base","candidate"].includes(revision))throw new Error("Revision must be base or candidate.");return state[revision].sandboxId;};
const read=(state,revision,path)=>api(state,`file?sandboxId=${encodeURIComponent(sandbox(state,revision))}&path=${encodeURIComponent(relativePath(path))}`);
const saveFile=(state,revision,path,content)=>api(state,"file",{sandboxId:sandbox(state,revision),path:relativePath(path),content},"PUT");
const run=(state,revision,command)=>{
  if(typeof command!=="string"||!command.trim()||command.length>4000||command.includes("\0"))throw new Error("Use a command of 1–4000 characters.");
  return api(state,"commands",{sandboxId:sandbox(state,revision),command});
};
const exported=(state,revision)=>api(state,`export?sandboxId=${encodeURIComponent(sandbox(state,revision))}`);
async function writeJSON(path,value){await writeFile(path+".tmp",JSON.stringify(value,null,2),{mode:0o600});await rename(path+".tmp",path);}
async function capture(state,revision,folder,paths) {
  for(let i=0;i<paths.length;i+=4) {
    const results=await Promise.allSettled(paths.slice(i,i+4).map(async entry=>{
      const path=typeof entry==="string"?entry:entry.path;relativePath(path);
      const file=await read(state,revision,path);
      if(typeof entry!=="string"&&hash(file.content)!==entry.sha256)throw new Error(`Source changed while capturing ${revision}/${path}`);
      const destination=join(folder,path);await mkdir(dirname(destination),{recursive:true});await writeFile(destination,file.content,{mode:typeof entry==="string"?0o644:entry.mode});
    }));
    for(const result of results)if(result.status==="rejected")throw result.reason;
  }
}
export async function beginVerification({repo,base="HEAD",server,output}) {
  const origin=serverOrigin(server),source=await realpath(resolve(repo));
  if(base.startsWith("-")||base.length>200)throw new Error("Invalid base reference.");
  const revision=execFileSync("git",["-c","core.fsmonitor=false","-C",source,"rev-parse","--verify","--end-of-options",base+"^{commit}"],{encoding:"utf8",env:{...process.env,GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:"/dev/null"}}).trim();
  const folder=resolve(output);await mkdir(folder,{recursive:false,mode:0o700});
  const state={version:1,id:randomUUID(),server:origin,source,baseRevision:revision,createdAt:new Date().toISOString(),reproRuns:[],folder};
  const stateFile=join(folder,"session.json");
  try{
    for(const name of ["base","candidate"]){
      state[name]=await api(state,"create",{localPath:source,...(name==="base"?{localRevision:revision}:{})});
      if(!state[name].localSource)throw new Error("Update the console server: local source manifests are required.");
      if(state[name].importSummary?.omittedTestCount)throw new Error("The import omitted test files; full original-test verification is unavailable.");
      await writeJSON(stateFile,state);
      await capture(state,name,join(folder,"sources",name==="candidate"?"working":"base"),state[name].localSource.files);
    }
    if(state.base.localSource.head!==state.candidate.localSource.head)throw new Error("HEAD changed between snapshots. Start a fresh verification.");
    const before=new Map(state.base.localSource.files.map(file=>[file.path,file.sha256]));
    const current=new Map(state.candidate.localSource.files.map(file=>[file.path,file.sha256]));
    state.changedPaths=[...new Set([...before.keys(),...current.keys()])].filter(path=>before.get(path)!==current.get(path));
    if(!state.changedPaths.length)throw new Error("No filtered working-tree changes differ from the selected base.");
    state.initial={};
    for(const name of ["base","candidate"])state.initial[name]=await api(state,"validate",{sandboxId:sandbox(state,name)});
    await writeJSON(stateFile,state);return {stateFile,state};
  }catch(error){await closeVerification(state).catch(()=>{});await writeJSON(join(folder,"error.json"),{error:error.message});throw error;}
}
export async function closeVerification(state) {
  for(const name of ["base","candidate"])if(state[name]?.sandboxId)await api(state,"destroy",{sandboxId:state[name].sandboxId}).catch(()=>{});
}
export function proofStatus(state,base,candidate) {
  const first=state.reproRuns[0],last=state.reproRuns.at(-1);
  const baseChanges=base.changedFiles.filter(path=>path!==state.reproducer?.path);
  if(baseChanges.length)return {verified:false,reason:"The base source changed; it no longer represents the pinned revision."};
  if(!state.reproducer||!first||!last)return {verified:false,reason:"No agent-authored differential reproducer was recorded."};
  if(!base.validation?.passed||!candidate.validation?.passed||base.validation.originalTests?.status!=="unchanged"||candidate.validation.originalTests?.status!=="unchanged")return {verified:false,reason:"The original suites must pass with original test files and definitions unchanged."};
  if(last.base.afterFingerprint!==base.fingerprint||last.candidate.afterFingerprint!==candidate.fingerprint)return {verified:false,reason:"Source changed after the reproducer. Run the same reproducer and original checks again."};
  const introduced=first.base.exitCode===0&&first.candidate.exitCode!==0;
  const existingFix=first.base.exitCode!==0&&first.candidate.exitCode===0;
  if(introduced&&(state.reproRuns.length<2||last.base.exitCode!==0||last.candidate.exitCode!==0))return {verified:false,reason:"The introduced failure has not been reproduced and repaired with the same check."};
  if(!introduced&&!existingFix)return {verified:false,reason:"The reproducer did not distinguish base from candidate."};
  return {verified:true,classification:introduced?"introduced-regression-repaired":"existing-bug-fixed",reason:"Identical reproducer, observed differential behavior, and unchanged original suites."};
}
export async function operation(stateFile,name,args={}) {
  const lock=stateFile+".lock";try{await mkdir(lock);}catch{throw new Error("This verification session is busy.");}
  try{
    const state=JSON.parse(await readFile(stateFile,"utf8"));serverOrigin(state.server);
    let result;
    if(name==="context")result={baseRevision:state.baseRevision,changedPaths:state.changedPaths,initial:state.initial,reproducer:state.reproducer?{path:state.reproducer.path,sha256:state.reproducer.sha256,command:state.reproducer.command}:null,reproRuns:state.reproRuns,files:state.candidate.localSource.files.map(file=>file.path)};
    else if(name==="read")result=await read(state,args.revision||"candidate",args.path);
    else if(name==="command")result=await run(state,args.revision||"candidate",args.command);
    else if(name==="write"){
      if(!state.reproRuns.length)throw new Error("Compare a reproducer against the unmodified candidate before writing a repair.");
      const path=relativePath(args.path);
      const protectedPaths=new Set([...state.initial.candidate.profile.basis,...(state.initial.candidate.report.originalTests?.files||[]).map(file=>file.path.replace(/^\/workspace\//,""))]);
      if(protectedPaths.has(path)||path===state.reproducer?.path)throw new Error("Preserve original tests and recipes. Use reproducer for a new generated test.");
      if(typeof args.content!=="string"||args.content.length>120000)throw new Error("Source text exceeds the write limit.");
      result=await saveFile(state,"candidate",path,args.content);
    }else if(name==="reproducer"){
      const path=relativePath(args.path);
      if(!/\.(?:js|mjs|cjs|py|ts)$/.test(path)||typeof args.content!=="string"||args.content.length>120000)throw new Error("Use a new JavaScript, TypeScript or Python reproduction file.");
      if(["base","candidate"].some(version=>state[version].localSource.files.some(file=>file.path===path)))throw new Error("A generated reproducer cannot replace any original source or test file.");
      if(state.reproducer&&state.reproducer.path!==path)throw new Error("Update the same reproduction file in this bounded session.");
      for(const version of ["base","candidate"])await saveFile(state,version,path,args.content);
      state.reproducer={path,content:args.content,sha256:hash(args.content)};state.reproRuns=[];result={savedInBothRevisions:true,path,sha256:state.reproducer.sha256};
    }else if(name==="compare"){
      if(!state.reproducer)throw new Error("Write a reproducer first.");
      if(state.reproducer.command&&state.reproducer.command!==args.command)throw new Error("The same reproduction command must be used before and after the repair.");
      if(!state.reproRuns.length)for(const version of ["base","candidate"]){
        const current=await exported(state,version);
        if(current.changedFiles.some(path=>path!==state.reproducer.path))throw new Error("Initial comparison requires untouched captured source; only the new reproducer may differ.");
      }
      const observed={recordedAt:new Date().toISOString(),command:args.command,sha256:state.reproducer.sha256};
      for(const version of ["base","candidate"]){
        if(hash((await read(state,version,state.reproducer.path)).content)!==state.reproducer.sha256)throw new Error("Reproducer bytes changed; comparison refused.");
        observed[version]=await run(state,version,args.command);
        if(observed[version].beforeFingerprint!==observed[version].afterFingerprint||hash((await read(state,version,state.reproducer.path)).content)!==state.reproducer.sha256)throw new Error("The reproduction command changed source or test bytes; comparison refused.");
      }
      state.reproducer.command=args.command;state.reproRuns.push(observed);result=observed;
    }else if(name==="check"){
      result={};for(const version of ["base","candidate"])result[version]=await api(state,"validate",{sandboxId:sandbox(state,version)});
    }else if(name==="export"){
      const base=await exported(state,"base"),candidate=await exported(state,"candidate");
      const status=proofStatus(state,base,candidate);
      result={...status,recordedAt:new Date().toISOString(),baseRevision:state.baseRevision,changedPaths:state.changedPaths,initial:state.initial,generatedReproducer:state.reproducer,reproRuns:state.reproRuns,base,candidate,scope:"Observed code and command behavior. Not a guarantee of complete correctness or a tamper-proof attestation."};
      if(status.verified){
        const tree=await api(state,`files?sandboxId=${encodeURIComponent(sandbox(state,"candidate"))}`);
        const present=new Set();const visit=nodes=>{for(const node of nodes)if(node.type==="directory")visit(node.children||[]);else present.add(node.path.replace(/^\/workspace\//,""));};visit(tree);
        const paths=[...new Set([...state.candidate.localSource.files.map(file=>file.path),...candidate.changedFiles])].filter(path=>present.has(path));
        await capture(state,"candidate",join(state.folder,"sources","fixed"),paths);
        if((await exported(state,"candidate")).fingerprint!==candidate.fingerprint)throw new Error("Source changed during bundle capture. Export again after edits stop.");
        await writeFile(join(state.folder,"fix.patch"),candidate.patch,{mode:0o600});
        const modes=new Map(state.candidate.localSource.files.map(file=>[file.path,file.mode]));
        const fixed=await Promise.all(paths.map(async path=>({path,sha256:hash(await readFile(join(state.folder,"sources","fixed",path))),mode:modes.get(path)||0o644})));
        await writeJSON(join(state.folder,"replay.json"),{version:1,command:state.reproducer.command,reproducer:state.reproducer,recipes:{base:state.initial.base.profile,candidate:state.initial.candidate.profile},sourceManifests:{base:state.base.localSource.files,working:state.candidate.localSource.files,fixed},fixedPaths:paths});
      }
      await writeJSON(join(state.folder,"result.json"),result);
      await writeFile(join(state.folder,"index.html"),renderReport(result),{mode:0o600});
    }else throw new Error("Unknown verification operation.");
    await writeJSON(stateFile,state);return result;
  }finally{await rm(lock,{recursive:true,force:true});}
}
export async function replayBundle(folder,revision,server) {
  if(!["base","working","fixed"].includes(revision))throw new Error("Replay revision must be base, working or fixed.");
  const bundle=JSON.parse(await readFile(join(folder,"replay.json"),"utf8"));
  if(hash(bundle.reproducer.content)!==bundle.reproducer.sha256)throw new Error("Reproducer content does not match the recorded hash.");
  const manifest=bundle.sourceManifests[revision];
  if(!Array.isArray(manifest)||manifest.length>10000)throw new Error("This replay requires a bounded source manifest for the selected revision.");
  for(const file of manifest)if(hash(await readFile(join(folder,"sources",revision,relativePath(file.path))))!==file.sha256)throw new Error(`Replay source changed: ${file.path}`);
  const state={server:serverOrigin(server)};
  const machine=await api(state,"create",{demo:true});state.candidate=machine;
  try{
    const root="osmogrep-replay-source";
    const paths=manifest.map(file=>file.path);
    const all=[...new Set([...paths,bundle.reproducer.path])];
    const directories=[...new Set(all.map(path=>posix.dirname(relativePath(path))).filter(path=>path!=="."))];
    await run(state,"candidate","rm -f -- /workspace/package.json && mkdir -p "+[root,...directories.map(path=>root+"/"+path)].map(quote).join(" "));
    for(const path of all){let content;if(path===bundle.reproducer.path)content=bundle.reproducer.content;else content=await readFile(join(folder,"sources",revision,relativePath(path)),"utf8");await saveFile(state,"candidate",root+"/"+path,content);}
    const executable=manifest.filter(file=>file.mode===0o755).map(file=>root+"/"+relativePath(file.path));
    if(executable.length)await run(state,"candidate","chmod 755 -- "+executable.map(quote).join(" "));
    const recipe=bundle.recipes[revision==="base"?"base":"candidate"];
    await saveFile(state,"candidate",root+"/osmogrep-replay.sh","set -eu\n"+(recipe.install?recipe.install+"\n":"")+bundle.command+"\n");
    return await run(state,"candidate","cd "+quote(root)+" && sh osmogrep-replay.sh");
  }finally{await closeVerification(state);}
}
