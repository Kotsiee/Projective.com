import { assert, assertEquals } from "@std/assert";
import type { CardPaymentHandoff } from "@projective/types/finance";
import { cardStepPending } from "./card-step.ts";

/**
 * Pins the checkout's commit contract (DESIGN_SYSTEM §B.8.1 tier 1, Decision #157): every commit is a
 * pill `Button` on the global `severity="accent"` pair, and the surface declares no commit colour of
 * its own. The pair's ratios are pinned in `packages/ui/system/core/theme-engine.test.ts`.
 */

const root = new URL("../", import.meta.url);

async function read(path: string): Promise<string> {
	return (await Deno.readTextFile(new URL(path, root))).replace(/\r\n/g, "\n");
}

async function sources(dir: string, ext: string): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	for await (const entry of Deno.readDir(new URL(dir, root))) {
		if (entry.isFile && entry.name.endsWith(ext)) {
			out.set(`${dir}${entry.name}`, await read(`${dir}${entry.name}`));
		}
	}
	return out;
}

function buttonTags(source: string): string[] {
	return source.split("<Button").slice(1).map((rest) => {
		const firstLine = rest.slice(0, rest.indexOf("\n"));
		if (/\/>\s*$/.test(firstLine) || /<\/Button>/.test(firstLine)) return firstLine;
		const end = rest.search(/\n[\t ]*\/?>/);
		return end < 0 ? rest : rest.slice(0, end);
	});
}

const COMMITS: ReadonlyArray<readonly [string, number]> = [
	["components/ConfirmPayDialog.tsx", 1],
	["islands/AddPaymentMethodModal.island.tsx", 2],
	["islands/CheckoutDetailsScreen.island.tsx", 1],
	["islands/CheckoutPaymentScreen.island.tsx", 1],
	["islands/SaveDetailsModal.island.tsx", 1],
];

Deno.test("checkout stylesheets declare no private commit pair", async () => {
	for (const [path, css] of await sources("styles/", ".css")) {
		assert(!/--checkout-commit-/.test(css), `${path} declares a --checkout-commit-* token`);
		assert(!/\.cko-commit\b/.test(css), `${path} styles the retired .cko-commit class`);
	}
});

Deno.test("no checkout markup carries the retired commit class or the warning ramp", async () => {
	const markup = new Map([
		...await sources("components/", ".tsx"),
		...await sources("islands/", ".tsx"),
	]);
	for (const [path, tsx] of markup) {
		assert(!/\bcko-commit\b/.test(tsx), `${path} still uses .cko-commit`);
		assert(!/ui-button--warning/.test(tsx), `${path} commits on the warning ramp`);
	}
});

Deno.test("every checkout commit is a tier-1 accent pill", async () => {
	for (const [path, expected] of COMMITS) {
		const accent = buttonTags(await read(path)).filter((tag) => /severity="accent"/.test(tag));
		assertEquals(accent.length, expected, `${path} accent commits`);
		for (const tag of accent) {
			assert(/\brounded\b/.test(tag), `${path} accent commit is not a pill`);
			assert(!/variant="(outlined|text|link)"/.test(tag), `${path} accent commit is not filled`);
		}
	}
});

Deno.test("the basket's Proceed to Checkout anchor wears the accent Button classes", async () => {
	const tsx = await read("islands/CheckoutBasketScreen.island.tsx");
	const cta = tsx.match(/class="([^"]*\bbsk-summary__cta\b[^"]*)"/);
	assert(cta, "bsk-summary__cta not found");
	for (const cls of ["ui-button--accent", "ui-button--filled", "ui-button--rounded"]) {
		assert(cta[1].split(/\s+/).includes(cls), `bsk-summary__cta lacks ${cls}`);
	}
});

const HANDOFF: CardPaymentHandoff = {
	paymentId: "00000000-0000-4000-8000-000000000001",
	purpose: "wallet_topup",
	status: "requires_payment",
	lockStatus: "not_applicable",
	amount: { minor: 1200, currency: "GBP", display: "£12.00", origin: null },
	providerRef: "pi_test",
	clientSecret: "pi_test_secret",
	publishableKey: null,
	mode: "test",
	replayed: false,
	confirmation: "collect",
};

Deno.test("a pending card step owns the commit, so the rail's Buy Now steps out", () => {
	assert(cardStepPending({ status: "requires_action", payment: HANDOFF }));
	assert(!cardStepPending({ status: "requires_action", payment: undefined }));
	assert(!cardStepPending({ status: "failed", payment: HANDOFF }));
	assert(!cardStepPending(null));
});

Deno.test("the rail's accent Buy Now renders only while no card step is pending", async () => {
	const tsx = await read("islands/CheckoutPaymentScreen.island.tsx");
	assert(
		/const cardStep = cardStepPending\(result\);/.test(tsx),
		"cardStep is not derived from the result",
	);
	assert(
		/\{!cardStep && \(\s*<div class="cko-rail__commit">/.test(tsx),
		"the rail commit is not gated on the card step",
	);
});
