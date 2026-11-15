/**
 * What stands where the browser's Iroh endpoint would be (`web/iroh/pkg`) in every build but the one the app's own
 * origin serves: web/vite.config.ts puts this in its place, so those builds carry neither the endpoint's code nor its
 * WebAssembly. Nothing in them reaches it: only that origin's build is a device through a browser's endpoint.
 */
const none = (): never => {
	throw new Error("this build has no Iroh endpoint of its own");
};

export default async function init(): Promise<never> {
	return none();
}

export const Device = { create: async (): Promise<never> => none() };

export const computer = (_ticket: string): never => none();
