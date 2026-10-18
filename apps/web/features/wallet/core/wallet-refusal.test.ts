import { assertEquals } from "@std/assert";
import { BUSINESS_REFUSAL_COPY } from "@features/workspaces/core/refusal-copy.ts";
import { walletRefusalSentence } from "./wallet-refusal.ts";

const HELIA = "5f0c7c1e-3a1b-4c2d-9e8f-0a1b2c3d4e5f";
const OTHER = "0bb1d9f1-b826-4bfc-ab8e-26ab3be30616";
const FALLBACK = "We couldn't confirm this went through.";

Deno.test("an archived business's refusal is the map's sentence and its restore ask, naming it", () => {
	const res = {
		message: "This business is archived — restore it first.",
		details: { reason: "business_not_active", status: "archived", businessId: HELIA },
	};
	const copy = BUSINESS_REFUSAL_COPY.business_not_active;
	const expected = `${copy.sentence({ business: "Helia Finance" })} ${
		copy.ask({ businessStatus: "archived" })
	}`;
	assertEquals(
		walletRefusalSentence(res, { businesses: { [HELIA]: "Helia Finance" } }, FALLBACK),
		expected,
	);
	assertEquals(
		expected,
		"Helia Finance isn't active, so it can't buy, hire or pay yet. Ask the owner to restore it.",
	);
});

Deno.test("the owner of the refused business is told to restore it, not to ask the owner", () => {
	const res = { details: { reason: "business_not_active", status: "archived", businessId: HELIA } };
	const businesses = { [HELIA]: "Helia Finance", [OTHER]: "Atlas Labs" };
	assertEquals(
		walletRefusalSentence(res, { businesses, owned: [HELIA] }, FALLBACK),
		"Helia Finance isn't active, so it can't buy, hire or pay yet. Restore it first.",
	);
	// Owning another business the movement touched does not make the reader this one's owner.
	assertEquals(
		walletRefusalSentence(res, { businesses, owned: [OTHER] }, FALLBACK),
		"Helia Finance isn't active, so it can't buy, hire or pay yet. Ask the owner to restore it.",
	);
});

Deno.test("a business the movement did not name reads in the general form", () => {
	assertEquals(
		walletRefusalSentence(
			{ details: { reason: "business_not_active", status: "draft", businessId: OTHER } },
			{ businesses: { [HELIA]: "Helia Finance" } },
			FALLBACK,
		),
		"This business isn't active, so it can't buy, hire or pay yet. Ask the owner to publish it.",
	);
	assertEquals(
		walletRefusalSentence({ details: { reason: "business_not_active" } }, {}, FALLBACK),
		"This business isn't active, so it can't buy, hire or pay yet. Ask the owner to publish or restore it.",
	);
});

Deno.test("any other refusal keeps the server's words, then its first field error, then the fallback", () => {
	assertEquals(
		walletRefusalSentence(
			{ message: "That wallet doesn't hold enough for this.", details: { reason: "over_limit" } },
			{},
			FALLBACK,
		),
		"That wallet doesn't hold enough for this.",
	);
	assertEquals(
		walletRefusalSentence({ errors: { amountMinor: "Enter an amount to add." } }, {}, FALLBACK),
		"Enter an amount to add.",
	);
	assertEquals(walletRefusalSentence(null, {}, FALLBACK), FALLBACK);
});
