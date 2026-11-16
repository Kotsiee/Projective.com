import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { CardArtConfigSchema, CardBrand, resolveCardArt } from "./card-art.ts";

const BRANDS = [...CardBrand.options, "Visa Debit", null] as const;

function lightnessesOf(gradient: string): number[] {
	return [...gradient.matchAll(/oklch\(from var\(--[a-z-]+\) ([0-9.]+) /g)].map((m) =>
		Number.parseFloat(m[1])
	);
}

Deno.test("every resolved face parses against the SSOT schema, so no art carries a raw hex", () => {
	for (const brand of BRANDS) {
		for (const isBusinessCard of [false, true]) {
			const art = resolveCardArt({ brand, binNumber: null, isBusinessCard });
			const parsed = CardArtConfigSchema.safeParse(art);
			assert(parsed.success, `${brand}/${isBusinessCard}: ${parsed.error?.message}`);
			assert(!JSON.stringify(art).includes("#"), `${brand} art carries a hex`);
		}
	}
});

Deno.test("faces print in the mode-invariant scrim ink, never the dark --on-primary pair", () => {
	for (const brand of BRANDS) {
		const art = resolveCardArt({ brand, binNumber: null, isBusinessCard: false });
		assertEquals(art.foreground, "var(--on-scrim)");
		assert(
			!art.gradient.includes("--surface"),
			"a face must not ramp over a mode-flipping surface",
		);
	}
});

Deno.test("accent ramps pin lightness at or below the 0.46 lit edge and fall towards the deep corner", () => {
	for (const brand of ["visa", "mastercard", "amex", "discover", "unionpay", "vault"]) {
		const stops = lightnessesOf(
			resolveCardArt({ brand, binNumber: null, isBusinessCard: false }).gradient,
		);
		assertEquals(stops.length, 3, brand);
		assert(stops[0] <= 0.46, `${brand} lit edge ${stops[0]}`);
		assert(stops[0] > stops[1] && stops[1] > stops[2], `${brand} ramp ${stops}`);
	}
});

Deno.test("a business face sits deeper than the personal one and carries the foil", () => {
	const personal = resolveCardArt({ brand: "visa", binNumber: null, isBusinessCard: false });
	const business = resolveCardArt({ brand: "visa", binNumber: null, isBusinessCard: true });
	assert(lightnessesOf(business.gradient)[0] < lightnessesOf(personal.gradient)[0]);
	assertEquals(business.holographic, true);
	assertEquals(personal.holographic, false);
	assertEquals(business.issuerHint, "Visa Business");
});

Deno.test("an unknown or wallet-wrapped card resolves to the neutral graphite plate", () => {
	for (const brand of ["apple_pay", "google_pay", "unknown", null]) {
		const art = resolveCardArt({ brand, binNumber: null, isBusinessCard: false });
		assertEquals(art.network, "unknown");
		assertEquals(art.issuerHint, null);
		assert(art.gradient.includes("var(--scrim)") && !art.gradient.includes("oklch"));
	}
});

Deno.test("a BIN outranks the brand string", () => {
	const art = resolveCardArt({ brand: "visa", binNumber: "378282", isBusinessCard: false });
	assertEquals(art.network, "amex");
	assertNotEquals(
		art.gradient,
		resolveCardArt({ brand: "visa", binNumber: null, isBusinessCard: false }).gradient,
	);
});
