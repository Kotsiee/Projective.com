import { HttpError } from "fresh";
import { define } from "@web/utils/state.ts";

const SECTION_OF: Readonly<Record<string, string>> = {
	transactions: "transactions",
	activity: "cash-flow",
	payouts: "upcoming",
	funding: "upcoming",
	invoices: "upcoming",
	access: "upcoming",
	methods: "methods",
};

/**
 * `/wallet/[section]` — 308-redirects each retired wallet deep page to the `/wallet` section that
 * absorbed it, carrying `?w=` and `?display=`. Unknown segments are a 404.
 */
export const handler = define.handlers({
	GET(ctx) {
		const section = SECTION_OF[ctx.params.section];
		if (!section) throw new HttpError(404);
		const carried = new URLSearchParams();
		const wallet = ctx.url.searchParams.get("w");
		const display = ctx.url.searchParams.get("display");
		if (wallet) carried.set("w", wallet);
		if (display) carried.set("display", display);
		const query = carried.toString();
		return new Response(null, {
			status: 308,
			headers: { location: `/wallet${query ? `?${query}` : ""}#${section}` },
		});
	},
});
