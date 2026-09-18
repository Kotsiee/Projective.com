import { assertEquals } from "@std/assert";
import { ENTER_CHAIN_SELECTOR, resolveEnterMove } from "./enter-chain.ts";

/**
 * The ordering rule behind Enter on `/join`. The DOM half (which element is focused) needs a
 * browser; the decision of WHERE Enter goes is pure over the step's unit list and is pinned here.
 */

// #region resolveEnterMove
Deno.test("resolveEnterMove steps to the next unit", () => {
	assertEquals(resolveEnterMove(["email", "dob", "password"], "email"), {
		kind: "next",
		index: 1,
	});
});

Deno.test("resolveEnterMove skips every field of the SAME unit — a segmented date is one stop", () => {
	// day / month / year all carry the `dob` unit; Enter on any of them lands on the password.
	const units = ["email", "dob", "dob", "dob", "password", "confirm"];
	assertEquals(resolveEnterMove(units, "dob"), { kind: "next", index: 4 });
});

Deno.test("resolveEnterMove ends the chain on the last unit, however many segments it has", () => {
	assertEquals(resolveEnterMove(["first", "last", "username", "dob", "dob", "dob"], "dob"), {
		kind: "end",
	});
	assertEquals(resolveEnterMove(["only"], "only"), { kind: "end" });
});

Deno.test("resolveEnterMove leaves a target that is not in the chain alone", () => {
	assertEquals(resolveEnterMove(["email", "password"], "toggle"), { kind: "outside" });
	assertEquals(resolveEnterMove([], "email"), { kind: "outside" });
});
// #endregion

// #region The selector's shape
Deno.test("the chain selector admits inputs and select triggers, and refuses what owns Enter", () => {
	// Radios and checkboxes are picked, not stepped past; hidden/disabled/readonly never join.
	for (const refused of ['[type="hidden"]', '[type="radio"]', '[type="checkbox"]', "[disabled]"]) {
		assertEquals(
			ENTER_CHAIN_SELECTOR.includes(`:not(${refused})`),
			true,
			`the selector must exclude ${refused}`,
		);
	}
	assertEquals(ENTER_CHAIN_SELECTOR.includes(":not([readonly])"), true);
	assertEquals(ENTER_CHAIN_SELECTOR.includes("button.ui-select__trigger"), true);
});
// #endregion
