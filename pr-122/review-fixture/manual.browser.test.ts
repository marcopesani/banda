import { writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { startDaemon } from "../../src/daemon.ts";
import { readDaemonFile } from "../../src/home.ts";
import { hostBox } from "../../test/fixtures/host-box.ts";
import { skipShippedSkills, tempHome, until, webServer } from "../../test/helpers.ts";
import { withPage } from "../../test/smoke/chrome.ts";

const gate = () => { let open = () => {}; const promise = new Promise<void>(r => { open = r; }); return { open, promise }; };
const before = process.env.REVIEW_SIDE === "before";
const out = resolve(process.env.REVIEW_MEDIA ?? ".local/review122/manual-after");
const line = `document.querySelector('[data-working-line]')`;
const button = `${line}?.querySelector('button')`;

for (const width of [1440,390]) it(`native composer and activity at ${width}px (${before ? "before" : "after"})`, async () => {
 const home = await tempHome();
 const first = gate(), last = gate();
 let second = false;
 await writeFile(join(home,"config.json"),JSON.stringify({model:{provider:"faux",modelId:"faux-1"}}));
 const faux = fauxProvider({tokensPerSecond:4000,tokenSize:{min:40,max:40}});
 const models = createModels(); models.setProvider(faux.provider);
 faux.setResponses([
  async () => { await first.promise; return fauxAssistantMessage([
   fauxToolCall("message_user",{text:"The report is ready. Checking one more thing."}),
   fauxToolCall("bash",{command:"sleep 3"})
  ],{stopReason:"toolUse"}); },
  async () => {second=true; await last.promise; return fauxAssistantMessage("Done.");}
 ]);
 const daemon = await startDaemon({home,port:0,models,box:hostBox(home),log:()=>{}});
 let web;
 try {
  const token = (await readDaemonFile(home)).token;
  await skipShippedSkills(daemon.port,token);
  const response = await fetch(`http://127.0.0.1:${daemon.port}/api/companion`,{
   method:"PUT",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},
   body:JSON.stringify({name:"Sancho",personality:"Brief."})
  });
  expect(response.ok).toBe(true);
  web=await webServer({server:{proxy:{"/api":{target:`http://127.0.0.1:${daemon.port}`,changeOrigin:true,headers:{origin:`http://127.0.0.1:${daemon.port}`}}}}});
  await mkdir(out,{recursive:true});
  await withPage(`${web.origin}/#token=${token}`,{width,height:900},async page=>{
   const shot = name => page.shoot(join(out,`${name}-${width}.png`));
   await page.until(`localStorage.getItem('banda.token')`);
   await page.run(`location.hash='#/a/sancho'`);
   await page.until(`document.querySelector('textarea[name="message"]')`);
   await page.click(`document.querySelector('textarea[name="message"]')`);
   await page.input("Input.insertText",{text:"Please check the report."});
   await page.click(`document.querySelector('form button[aria-label="Send"]')`);
   await page.until(`${line}?.innerText.trim() === 'Working…'`);
   await shot("1-start");
   await page.click(button);
   await page.until(`document.querySelector('[role="dialog"] [data-activity-timeline]')`);
   await shot("2-activity");
   await page.click(`document.querySelector('[data-slot="sheet-close"]')`);
   await page.until(`!document.querySelector('[role="dialog"]')`);
   await page.until(`document.activeElement === ${button}`);
   first.open();
   await page.until(`document.body.innerText.includes('The report is ready. Checking one more thing.')`);
   await page.until(before ? `${line}?.hasAttribute('data-quiet')` : `${line}?.innerText.trim() === 'Running a command…'`);
   await shot("3-command");
   const name=await page.run(`${button}.getAttribute('aria-label')`);
   if(!before) {
    expect(name).toBe("Sancho is working: Running a command…");
    expect(await page.input("Accessibility.getFullAXTree",{})).toMatchObject({nodes:expect.arrayContaining([expect.objectContaining({role:expect.objectContaining({value:"button"}),name:expect.objectContaining({value:name})})])});
   }
   await writeFile(join(out,`accessible-name-${width}.json`),JSON.stringify({name,visible:await page.run(`${line}.innerText.trim()`)}));
   await until(()=>second);
   await page.until(before ? `${line}?.hasAttribute('data-quiet')` : `${line}?.innerText.trim() === 'Working…'`);
   await shot("4-after-command");
   await page.reload();
   await page.until(before ? `${line}?.hasAttribute('data-quiet')` : `${line}?.innerText.trim() === 'Working…'`);
   await shot("5-reloaded");
   await page.input("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
   await page.until(`${line}?.innerText.trim() === 'Working…'`);
   await shot("6-reduced-motion");
   last.open();
   await page.until(`!${line}`);
   await shot("7-done");
   expect(await page.run(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
   expect(page.errors()).toEqual([]);
  });
 } finally { first.open(); last.open(); await web?.close(); await daemon.close(); }
},60000);
