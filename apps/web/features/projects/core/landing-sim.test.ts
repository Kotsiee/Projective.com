import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	encodeLandingSim,
	isLandingSimActive,
	type LandingSim,
	NO_LANDING_SIM,
	parseLandingSim,
} from "./landing-sim.ts";

Deno.test("a simulation round-trips through its cookie value", () => {
	const cases: LandingSim[] = [
		{ access: "prospect", status: null },
		{ access: null, status: "draft" },
		{ access: "participant", status: "completed" },
	];
	for (const sim of cases) {
		const raw = encodeLandingSim(sim);
		assert(raw !== null);
		assertEquals(parseLandingSim(raw), sim);
	}
});

Deno.test("simulating nothing has one spelling: no cookie at all", () => {
	assertEquals(encodeLandingSim(NO_LANDING_SIM), null);
	assertEquals(parseLandingSim(undefined), NO_LANDING_SIM);
	assertEquals(parseLandingSim(""), NO_LANDING_SIM);
	assertFalse(isLandingSimActive(NO_LANDING_SIM));
});

Deno.test("an unrecognised value is ignored axis by axis, never trusted", () => {
	// A hand-edited cookie must not be able to invent an access level the type does not have.
	assertEquals(parseLandingSim("access=admin&status=draft"), { access: null, status: "draft" });
	assertEquals(parseLandingSim("access=owner&status=archived"), { access: "owner", status: null });
	assertEquals(parseLandingSim("garbage"), NO_LANDING_SIM);
});

Deno.test("either axis alone makes the simulation active", () => {
	assert(isLandingSimActive({ access: "owner", status: null }));
	assert(isLandingSimActive({ access: null, status: "on_hold" }));
});
