import { assertEquals } from "@std/assert";
import { formatMoney, splitMoney } from "./currency-store.ts";

/**
 * Tests for {@link splitMoney} — the split that lets a figure de-emphasise its minor units without
 * re-composing the string `Intl` produced.
 *
 * The whole risk here is that a split LOOKS right on the one locale anyone tests with. A thousands
 * separator and a decimal separator are the same two characters in different roles, and which is
 * which flips between `en-GB` and `de-DE`; a zero-decimal currency has no minor run at all. So these
 * cases deliberately cross those axes rather than sampling one of them.
 */

Deno.test("splitMoney — a prefix-symbol 2dp amount splits into symbol / major / minor", () => {
	assertEquals(splitMoney("£1,246.29", "GBP"), {
		symbol: "£",
		major: "1,246",
		minor: ".29",
		suffix: "",
	});
});

Deno.test("splitMoney — a zero-decimal currency has no minor run", () => {
	// The trap: `,362` is a thousands group, not 2dp. Keying off `currencyExponent` rather than
	// "the last separator" is what stops ¥14,362 rendering as ¥14 with a raised 362.
	assertEquals(splitMoney("JP¥14,362", "JPY"), {
		symbol: "JP¥",
		major: "14,362",
		minor: null,
		suffix: "",
	});
});

Deno.test("splitMoney — a comma-decimal locale splits on the comma, not the dot", () => {
	// de-DE: dots group, the comma is the decimal. The mirror image of the GBP case.
	assertEquals(splitMoney("1.234,56 €", "EUR"), {
		symbol: "",
		major: "1.234",
		minor: ",56",
		suffix: " €",
	});
});

Deno.test("splitMoney — a suffixed currency keeps its trailing run out of the number", () => {
	assertEquals(splitMoney("348.58 AED", "AED"), {
		symbol: "",
		major: "348",
		minor: ".58",
		suffix: " AED",
	});
});

Deno.test("splitMoney — an unparseable string returns itself, rendering as if unsplit", () => {
	// The wallet renders an em dash for an absent figure. It must survive untouched rather than
	// throwing or being silently emptied.
	assertEquals(splitMoney("—", "GBP"), { symbol: "", major: "—", minor: null, suffix: "" });
});

Deno.test("splitMoney — reassembling the parts reproduces the input exactly, for every offerable currency", () => {
	// The invariant that matters: the split is lossless. If it were not, a figure would render with a
	// character missing and nothing would catch it — the parts are re-joined by the DOM, not by code.
	const codes = ["GBP", "USD", "EUR", "JPY", "AED", "INR", "CHF", "ZAR", "NGN", "SGD"];
	for (const code of codes) {
		for (const locale of ["en-GB", "de-DE", "ja-JP"]) {
			for (const minorAmount of [0, 5, 99, 1_234_56, 999_999_99]) {
				const display = formatMoney(minorAmount, code, locale);
				const p = splitMoney(display, code);
				assertEquals(
					`${p.symbol}${p.major}${p.minor ?? ""}${p.suffix}`,
					display,
					`${code} / ${locale} / ${minorAmount} did not round-trip`,
				);
				// Losslessness ALONE is too weak an invariant to protect this, and that is not a
				// hypothetical: a lost backslash once made the minor-unit regex match a literal "d",
				// so every 2dp amount came back as `minor: null` — and still round-tripped perfectly,
				// because the un-split major run reassembles to exactly the input. Assert that a
				// two-decimal currency actually FOUND its minor run.
				if (code !== "JPY") {
					assertEquals(
						p.minor !== null,
						true,
						`${code} / ${locale} / ${minorAmount} produced no minor run (got "${display}")`,
					);
				}
			}
		}
	}
});
