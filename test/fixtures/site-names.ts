/**
 * The names the box suites' stand-in sites answer to on the computer, where the site is a server on this machine at a
 * public address (11.x, routed nowhere) the runner gave a dummy interface, and the names are lines of /etc/hosts that
 * the proxy's resolver reads through the computer's DNS. One list, for the tests and for CI's provisioning:
 * `node test/fixtures/site-names.ts 11.77.0.1` prints the /etc/hosts lines for that address.
 */
export const SITE_LABELS = ["echo", "forge", "shop", "blog"] as const;
export type SiteLabel = (typeof SITE_LABELS)[number];

export const siteName = (label: SiteLabel) => `${label}.banda-site.example`;

if (import.meta.main) {
	const [address] = process.argv.slice(2);
	if (address === undefined || !/^11\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address))
		throw new Error("Usage: node test/fixtures/site-names.ts 11.A.B.C");
	for (const label of SITE_LABELS) console.log(`${address} ${siteName(label)}`);
}
