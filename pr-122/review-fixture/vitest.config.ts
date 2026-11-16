import config from "../../vitest.config.ts";
export default { ...config, cacheDir: ".local/review122/vite-cache", test: { ...config.test, globalSetup: [] } };
