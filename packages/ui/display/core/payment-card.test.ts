import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import {
	cardExpiryOf,
	cardMaskGroupsFor,
	cardProgrammeOf,
	cardWordmarkOf,
	describeCardBack,
	describeCardFront,
	paymentCardArt,
} from "./payment-card.ts";

const css = Deno.readTextFileSync(new URL("../styles/payment-card.css", import.meta.url))
	.replace(/\r\n/g, "\n");

function block(selector: string): string {
	const at = css.indexOf(`\n${selector} {`);
	assert(at >= 0, `missing rule ${selector}`);
	return css.slice(at, css.indexOf("}", at));
}

function reducedSelectors(): string {
	return [...css.matchAll(/:root\[data-motion="reduced"\]([^{]*)\{/g)].map((m) => m[1]).join(" ");
}

const NO_WALLET = { scopeLabel: null, currency: null };

Deno.test("a partial or missing expiry renders nothing, never a placeholder", () => {
	assertEquals(cardExpiryOf({ expMonth: 8, expYear: 2028 }), "08/28");
	assertEquals(cardExpiryOf({ expMonth: 8, expYear: null }), null);
	assertEquals(cardExpiryOf({ expMonth: null, expYear: 2028 }), null);
	assertEquals(cardExpiryOf({ expMonth: Number.NaN, expYear: 2028 }), null);
});

Deno.test("the mask is the shape of a number and never a digit; Amex groups 4-6-5", () => {
	assertEquals(cardMaskGroupsFor("visa").length, 3);
	assertEquals(cardMaskGroupsFor("amex").length, 2);
	for (const group of [...cardMaskGroupsFor("visa"), ...cardMaskGroupsFor("amex")]) {
		assertFalse(/\d/.test(group));
	}
});

Deno.test("network wordmarks are typographic, short, and absent for an unknown network", () => {
	assertEquals(cardWordmarkOf(paymentCardArt({ brand: "amex" })), "Amex");
	assertEquals(cardWordmarkOf(paymentCardArt({ brand: "mastercard" })), "Mastercard");
	assertEquals(cardWordmarkOf(paymentCardArt({ brand: "apple_pay" })), null);
	assertEquals(
		cardProgrammeOf(paymentCardArt({ brand: "visa", isBusinessCard: true })),
		"Business",
	);
	assertEquals(cardProgrammeOf(paymentCardArt({ brand: "visa" })), null);
});

Deno.test("the front's name carries only held facts; the back says the code is not stored", () => {
	const card = {
		brand: "visa",
		last4: "4242",
		expMonth: 8,
		expYear: 2028,
		cardholderName: "Ines Duarte",
	};
	const art = paymentCardArt(card);
	assertEquals(
		describeCardFront(card, art, "card", NO_WALLET),
		"Visa, ending 4242, expires 08 2028, Ines Duarte",
	);
	assertEquals(describeCardFront({ brand: "visa" }, art, "card", NO_WALLET), "Visa");
	assertMatch(describeCardBack(art), /security code is not stored and is not shown/);
});

Deno.test("a wallet face is named by its scope and currency, never by a number", () => {
	const art = {
		...paymentCardArt({ brand: "vault" }),
		networkLabel: "Projective",
		issuerHint: null,
	};
	assertEquals(
		describeCardFront(
			{ cardholderName: "Studio Fern", last4: "1234" },
			art,
			"wallet",
			{ scopeLabel: "Team vault", currency: "GBP" },
		),
		"Projective wallet, Team vault, held in GBP, Studio Fern",
	);
});

Deno.test("the stylesheet is token-only and keeps the ISO-7810 ID-1 ratio", () => {
	assertFalse(/#[0-9a-f]{3,8}\b/i.test(css), "payment-card.css carries a raw hex");
	assertMatch(block(".ui-paycard"), /--pc-ratio: 1\.586;/);
	assertMatch(css, /aspect-ratio: var\(--pc-ratio\);/);
	assertMatch(css, /--pc-radius: clamp\(var\(--radius-lg\), calc\(3\.8cqi/);
	assertMatch(css, /container: ui-paycard \/ inline-size;/);
});

Deno.test("both reduced-motion channels stop the flip, the sheen and the foil drift", () => {
	const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
	assert(start >= 0);
	const media = css.slice(start, css.indexOf(":root[data-motion", start));
	const attribute = reducedSelectors();
	for (
		const needle of [
			".ui-paycard__flipper",
			".ui-paycard__sheen",
			".ui-paycard__foil",
			".ui-paycard__glare",
		]
	) {
		assert(media.includes(needle), `media channel misses ${needle}`);
		assert(attribute.includes(needle), `data-motion channel misses ${needle}`);
	}
});

Deno.test("high contrast removes every decorative layer and restores full-strength ink", () => {
	assertMatch(css, /:root\[data-contrast="high"\] \.ui-paycard \{[^}]*--pc-pattern: none;/);
	assertMatch(css, /:root\[data-contrast="high"\] \.ui-paycard \{[^}]*--pc-dim-micro: 1;/);
	assertMatch(
		css,
		/:root\[data-contrast="high"\] :is\(\.ui-paycard__sheen, \.ui-paycard__foil, \.ui-paycard__glare\)/,
	);
});

Deno.test("every printed figure is isolated left-to-right with tabular digits", () => {
	for (const selector of [".ui-paycard__pan", ".ui-paycard__expiry-value"]) {
		const rule = block(selector);
		assertMatch(rule, /direction: ltr;/);
		assertMatch(rule, /unicode-bidi: isolate;/);
		assertMatch(rule, /font-variant-numeric: tabular-nums/);
	}
	assertMatch(block(".ui-paycard__holder"), /unicode-bidi: plaintext;/);
	assertMatch(block(".ui-paycard__holder"), /text-overflow: ellipsis;/);
});
