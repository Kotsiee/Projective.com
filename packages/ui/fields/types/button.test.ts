import { assertEquals } from "@std/assert";
import type { ButtonProps } from "./button.ts";

/**
 * The tone contract is enforced by the type checker, so these cases are asserted at compile time:
 * each `@ts-expect-error` fails the check if the line beneath it ever compiles. The runtime body only
 * keeps the values referenced.
 */
Deno.test("structural is a filled-only tone on the semantic ramps (§B.8.1 tier 2)", () => {
	const legal: ButtonProps[] = [
		{ structural: true },
		{ structural: true, variant: "filled" },
		{ structural: true, severity: "secondary" },
		{ structural: false, variant: "text" },
		{ severity: "accent" },
		{ severity: "neutral", variant: "outlined" },
	];

	const illegal: ButtonProps[] = [
		// @ts-expect-error tier 2 is a fill; a structural text Button would read as tier 5.
		{ structural: true, variant: "text" },
		// @ts-expect-error tier 2 is a fill; a structural outlined Button would read as tier 4.
		{ structural: true, variant: "outlined" },
		// @ts-expect-error tier 2 is a fill; a link never commits.
		{ structural: true, variant: "link" },
		// @ts-expect-error tier 1 amber is never also tier 2.
		{ structural: true, severity: "accent" },
		// @ts-expect-error tier 4 is outlined; its filled counterpart is spelled `structural`.
		{ structural: true, severity: "neutral", variant: "outlined" },
	];

	assertEquals(legal.length, 6);
	assertEquals(illegal.length, 5);
});
