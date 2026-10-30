/**
 * styles.gate.test — the auth stylesheets' merge gates (IW-D1–D5), held as a test.
 *
 * Reads every sheet in `apps/web/features/auth/styles/` (the full-screen frame, the controls it shares
 * with the sign-in prompt, and the prompt) and fails, naming `file:line`, on anything the IW-D sweep
 * removed coming back. The common gates come from `utils/css-gate.testing.ts`; auth sanctions no
 * exception to any of them. The gates below are this surface's own: the deleted glass passport card
 * stays deleted, hover never lifts a card, and the hero's progress is never an inline style.
 */
import { assert } from "@std/assert";
import {
	assertNone,
	blocks,
	offencesIn,
	readFeatureTsx,
	readSheets,
	registerCommonGates,
	within,
} from "@web/utils/css-gate.testing.ts";

// #region Sources
const STYLES_DIR = new URL("./", import.meta.url);
const FEATURE_DIR = new URL("../", import.meta.url);

const SHEETS = readSheets(STYLES_DIR);
const offences = offencesIn(SHEETS);
// #endregion

// #region The IW-D gates
Deno.test("auth styles: the sheets were found", () => {
	assert(SHEETS.length >= 3, `expected the three auth sheets, read ${SHEETS.length}`);
});

registerCommonGates({ label: "auth styles", sheets: SHEETS });

Deno.test("auth styles: movement is never hover or selection feedback", () => {
	// Press feedback is `transform: scale()` (§3.12); a hover or a selected state is a tonal step or a
	// ring. Keyframes may still travel — that is an entrance, not feedback.
	assertNone(
		offences(
			/\btranslate(X|Y|3d)?\(/,
			(sheet, index) => !within(blocks(sheet.css, /@keyframes\s[^{]*\{/g), index),
		),
		"translate() outside @keyframes — use a tonal step, a ring, or a press scale:",
	);
});

Deno.test("auth styles: the glass passport card stays deleted (IW-D4)", () => {
	assertNone(offences(/\.passport\b|\.passport__/), "a deleted dead selector is back:");
	const files = readFeatureTsx(FEATURE_DIR)
		.filter((file) =>
			/PassportCard|class="passport/.test(file.src) || file.name.endsWith("PassportCard.tsx")
		)
		.map((file) => file.name);
	assertNone(files, "PassportCard is back:");
});

Deno.test("auth styles: no component writes an inline style (IW-D5)", () => {
	const inline = readFeatureTsx(FEATURE_DIR)
		.filter((file) => /\bstyle=\{/.test(file.src))
		.map((file) => file.name);
	assertNone(
		inline,
		"inline style — drive it from a class, a data-* attribute or an SVG attribute:",
	);
});
// #endregion
