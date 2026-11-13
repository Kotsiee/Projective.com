import { assert } from "@std/assert";
import { readSheets, reducedTwin, registerCommonGates } from "@web/utils/css-gate.testing.ts";

/**
 * The Add to basket control's sheet (Decision #428), held to the shared gates — tokens only, both
 * reduced-motion channels — plus its own: the spark burst never takes a pointer and disappears, and the
 * settle stops with `transform: none`, under the OS setting and the in-app switch alike.
 */
const SHEETS = readSheets(new URL("./", import.meta.url)).filter((s) =>
	s.name === "basket-button.css"
);

registerCommonGates({ label: "basket button styles", sheets: SHEETS });

const flat = SHEETS[0]?.css.replace(/\s+/g, " ") ?? "";

function reduceBlock(): string {
	const open = flat.indexOf("@media (prefers-reduced-motion: reduce) {");
	assert(open >= 0, "the sheet has a prefers-reduced-motion: reduce block");
	return flat.slice(open, flat.indexOf(":root[data-motion", open));
}

Deno.test("basket button: the sheet exists", () => {
	assert(SHEETS.length === 1, "basket-button.css is read");
});

Deno.test("basket button: the burst never takes a pointer", () => {
	assert(/\.bkb__burst \{[^}]*pointer-events: none/.test(flat));
});

Deno.test("basket button: both channels hide the burst and stop every spark", () => {
	assert(/\.bkb__burst \{ display: none; \}/.test(reduceBlock()), "OS channel hides the burst");
	assert(
		/display: none/.test(reducedTwin(flat, ".bkb__burst") ?? ""),
		"in-app channel hides the burst",
	);
	assert(
		/animation: none/.test(reducedTwin(flat, ".bkb__spark") ?? ""),
		"in-app channel stops sparks",
	);
});

Deno.test("basket button: both channels drop the settle to the final state", () => {
	assert(/\.bkb\[data-settle\] \{ animation: none; transform: none; \}/.test(reduceBlock()));
	const twin = reducedTwin(flat, ".bkb[data-settle]") ?? "";
	assert(/animation: none/.test(twin) && /transform: none/.test(twin));
});
