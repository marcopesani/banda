import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const own=process.cwd();
const before=resolve(own,"../review-122-before");
const targets=process.argv[2]==="integration" ? [["before",before],["merge",resolve(own,"../review-122-merge")]] : [["before",before],["after",own]];
for(const [side,cwd] of targets) {
 const temp=await mkdtemp("/private/tmp/r122m-");
 const env={...process.env,TMPDIR:temp,REVIEW_SIDE:side,REVIEW_MEDIA:resolve(own,".local/review122/manual-"+side),BANDA_REMOTE:"off"};
 const git=(args)=>execFileSync("git",args,{cwd,encoding:"utf8"}).trim();
 const evidence={side,head:git(["rev-parse","HEAD"]),tree:git(["rev-parse","HEAD^{tree}"]),dirty:git(["status","--porcelain"]),command:"node node_modules/vitest/vitest.mjs run --config .local/review122/manual.config.ts",startedAt:new Date().toISOString()};
 let output="";
 try {
  console.log("START native walkthrough "+side);
  const code=await new Promise((done,reject)=>{
   const p=spawn(process.execPath,["node_modules/vitest/vitest.mjs","run","--config",".local/review122/manual.config.ts"],{cwd,env,stdio:["ignore","pipe","pipe"]});
   for(const s of [p.stdout,p.stderr])s.on("data",b=>{output+=b.toString();});
   p.on("error",reject);p.on("exit",done);
  });
  await writeFile(resolve(own,".local/review122/manual-"+side+".log"),output+"\nEXIT "+code+"\n");
  evidence.exit=code; evidence.headAfter=git(["rev-parse","HEAD"]); evidence.dirtyAfter=git(["status","--porcelain"]); evidence.finishedAt=new Date().toISOString();
  await writeFile(resolve(own,".local/review122/manual-"+side+"-manifest.json"),JSON.stringify(evidence,null,2));
  console.log(output);console.log("EXIT "+code+": "+side);
  if(code!==0){process.exitCode=1;break;}
 } finally {await rm(temp,{recursive:true,force:true});}
}
