import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { ExploreItem } from "@projective/types/explore";
import { buyNowOpen, closeBuyNow } from "@web/features/checkout/core/buy-now-state.ts";
import {
	commitArchiveDraft,
	commitBasket,
	commitBuyNow,
	commitConfigure,
	commitContact,
	commitPipeline,
	commitSession,
	readSlots,
} from "./booking-commits.ts";
import {
	seedSimulation,
	type SimulationFacts,
	simulationFacts,
	simulationOutcome,
} from "./simulation.ts";

/**
 * booking-commits — with the owner's buyer simulation armed (Decision #217 (j)), pressing every CTA a
 * listing page offers sends NOTHING: `fetch` is stubbed and must never be called, and each commit
 * resolves locally with its would-be outcome. With the simulation off, the same commits reach their
 * real endpoints, which proves the test drives the live paths rather than dead code.
 */

// #region Harness
const COMMIT_PATH = /\/api\/(basket|checkout|booking|services)/;

const FACTS: SimulationFacts = {
	title: "Brand identity sprint",
	sellerName: "Ivy",
	price: "$480",
	isFloor: false,
	format: "one_off",
	escrows: false,
	stageCount: 2,
};

const ITEM = {
	id: "prd-fontpack01",
	type: "products",
	title: "Font pack",
	owner: { name: "Ivy", handle: "@ivy" },
	priceMinor: 4800,
	currency: "USD",
} as unknown as ExploreItem;

/** Stub `fetch`, run `body`, and return every URL requested while it ran. */
async function recordingFetch(body: () => Promise<void>): Promise<string[]> {
	const seen: string[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = ((input: RequestInfo | URL) => {
		seen.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
		// A soft refusal: every live path still makes its request, and none acts on a fabricated answer.
		return Promise.resolve(Response.json({ ok: false, message: "stubbed" }, { status: 422 }));
	}) as typeof fetch;
	try {
		await body();
	} finally {
		globalThis.fetch = original;
	}
	return seen;
}

/** Press every CTA a listing page offers, through the same commit functions the islands call. */
async function pressEveryCta(): Promise<unknown[]> {
	return [
		await commitPipeline({ serviceId: ITEM.id, workspaceId: null, idempotencyKey: "k" }),
		await commitArchiveDraft({ projectId: "prj-draft01" }),
		await commitSession({
			subjectId: ITEM.id,
			format: "session",
			slotIds: ["slot-1"],
			seats: 1,
			answers: {},
		}),
		await commitConfigure({
			subjectId: ITEM.id,
			format: "one_off",
			requirements: "A logo",
			fundingScope: "first_stage",
			stageIds: [],
			attachments: [],
			answers: {},
		}),
		await commitContact({ kind: "ask_question", handle: "ivy", subjectId: ITEM.id, message: "Hi" }),
		await commitContact({
			kind: "custom_quote",
			handle: "ivy",
			subjectId: ITEM.id,
			scope: "A bigger scope",
		}),
		await commitContact({
			kind: "discovery_call",
			handle: "ivy",
			subjectId: ITEM.id,
			slotId: "slot-1",
			callType: "courtesy",
		}, 20),
		await commitBasket(ITEM),
		await commitBuyNow({
			itemId: ITEM.id,
			itemType: "digital_product",
			title: ITEM.title,
			sellerName: "Ivy",
			signInHref: "/login",
		}, true),
		await readSlots({ subjectId: ITEM.id, purpose: "session" }),
	];
}

function reset(): void {
	simulationFacts.value = null;
	simulationOutcome.value = null;
	closeBuyNow();
}
// #endregion

Deno.test("simulation: no CTA reaches basket, checkout, booking or services", async () => {
	reset();
	seedSimulation(FACTS);
	try {
		let results: unknown[] = [];
		const seen = await recordingFetch(async () => {
			results = await pressEveryCta();
		});
		assertEquals(seen.filter((url) => COMMIT_PATH.test(url)), []);
		// The one request a simulated page makes is the owner's slot-grid READ.
		assertEquals(seen, ["/api/catalogue/simulate/slots?subjectId=prd-fontpack01&purpose=session"]);
		// Every commit resolved locally, with its outcome, and instant checkout never opened.
		for (const result of results.slice(0, -1)) {
			assertEquals((result as { simulated: boolean }).simulated, true);
			assertStringIncludes((result as { outcome: string }).outcome, "would now");
		}
		assertEquals(buyNowOpen.value, false);
		assert(simulationOutcome.value);
	} finally {
		reset();
	}
});

Deno.test("simulation off: the same commits reach their real endpoints", async () => {
	reset();
	try {
		const seen = await recordingFetch(async () => {
			await pressEveryCta();
		});
		for (
			const path of [
				"/api/services/instantiate-pipeline",
				"/api/services/archive-draft",
				"/api/services/book-session",
				"/api/services/configure",
				"/api/services/contact-action",
				"/api/services/slots",
			]
		) {
			assert(seen.some((url) => url.startsWith(path)), `${path} was not requested`);
		}
		assertEquals(buyNowOpen.value, true);
		assertEquals(simulationOutcome.value, null);
	} finally {
		reset();
	}
});
