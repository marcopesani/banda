import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
const artifacts = resolve(".local/review122");
const temp = await mkdtemp("/private/tmp/r122-");
const env = { ...process.env, TMPDIR: temp, BANDA_STATE_SHOTS: resolve(artifacts, "after"), BANDA_REMOTE: "off" };
await mkdir(env.BANDA_STATE_SHOTS, {recursive:true});
const commands = [
 ["npm", ["run", "check"]],
 ["npm", ["run", "web:contrast"]],
 ["npm", ["run", "typecheck"]],
 ["npm", ["run", "test:fast", "--", "--config", ".local/review122/vitest.config.ts", "--maxWorkers=2"]],
 ["npm", ["run", "build"]],
];
let log = "Node " + process.version + "\n";
try {
 for (const [program,args] of commands) {
  const command = [program,...args].join(" ");
  console.log("START " + command);
  log += "START " + command + "\n";
  const code = await new Promise((resolve,reject) => {
   const child=spawn(program,args,{env,stdio:["ignore","pipe","pipe"]});
   for (const stream of [child.stdout,child.stderr]) stream.on("data",data => {log+=data.toString();});
   child.on("error",reject);
   child.on("exit",resolve);
  });
  log += "EXIT " + code + ": " + command + "\n";
  await writeFile(resolve(artifacts,"own-gate.log"),log);
  console.log("EXIT " + code + ": " + command);
  if (code !== 0) { console.log(log.slice(-8000)); process.exitCode=1; break; }
 }
} finally { await rm(temp,{recursive:true,force:true}); }
