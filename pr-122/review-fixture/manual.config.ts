import { fileURLToPath } from "node:url";
export default {
 resolve:{alias:{"@":fileURLToPath(new URL("../../web/src",import.meta.url))}},
 cacheDir:".local/review122/manual-cache",
 test:{include:[".local/review122/manual.browser.test.ts"],globalSetup:[],setupFiles:["test/browser-slot.ts"],maxWorkers:1,env:{BANDA_REMOTE:"off"},testTimeout:60000,hookTimeout:120000}
};
