/**
 * Migrates a seeded home under a fault schedule, as a daemon's start does: checks what the process before left, then
 * runs until it settles, starting over after a thrown fault. Prints how many attempts this process took.
 */
import { type Fault, Faults, InjectedFault } from "./faults.ts";
import { checkSettled, checkStopped, migrate } from "./format-scenario.ts";

const [home, count, schedule] = process.argv.slice(2) as [string, string, string];
const faults = new Faults(JSON.parse(schedule) as Fault[]);
const injected = (error: unknown): boolean =>
	error instanceof InjectedFault || (error instanceof Error && error.cause !== undefined && injected(error.cause));
await checkStopped(home, Number(count));
for (let attempts = 1; ; attempts++) {
	try {
		await migrate(home, Number(count), (point) => faults.hit(point));
		await checkSettled(home, Number(count));
		console.log(JSON.stringify({ attempts }));
		break;
	} catch (error) {
		if (!injected(error)) throw error;
		await checkStopped(home, Number(count));
	}
}
