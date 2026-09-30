import { HttpError } from "fresh";
import { define } from "@web/utils/state.ts";

/**
 * Where each retired wallet deep-page address lives now: the analytics page for the old activity page,
 * and a section of the overview for the rest. `/wallet/transactions`, `/wallet/analytics` and
 * `/wallet/invoices` are real pages of their own and never reach this route.
 */
const TARGET_OF: Readonly<Record<string, string>> = {
	activity: "/wallet/analytics",
	payouts: "/wallet#upcoming",
	funding: "/wallet#upcoming",
	access: "/wallet#upcoming",
	methods: "/wallet#methods",
};

/**
 * `/wallet/[section]` — 308-redirects each retired wallet deep page to where it lives now, carrying
 * `?w=` and `?display=`. Unknown segments are a 404.
 */
export const handler = define.handlers({
	GET(ctx) {
		const target = TARGET_OF[ctx.params.section];
		if (!target) throw new HttpError(404);
		const [path, hash] = target.split("#");
		const carried = new URLSearchParams();
		const wallet = ctx.url.searchParams.get("w");
		const display = ctx.url.searchParams.get("display");
		if (wallet) carried.set("w", wallet);
		if (display) carried.set("display", display);
		const query = carried.toString();
		return new Response(null, {
			status: 308,
			headers: { location: `${path}${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}` },
		});
	},
});
