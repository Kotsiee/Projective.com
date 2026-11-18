import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	encodeLandingSim,
	isLandingSimActive,
	type LandingSim,
	NO_LANDING_SIM,
	parseLandingSim,
	serviceSideAccess,
} from "./landing-sim.ts";

Deno.test("a simulation round-trips through its cookie value", () => {
	const cases: LandingSim[] = [
		{ access: "prospect", status: null, side: null },
		{ access: null, status: "draft", side: null },
		{ access: "participant", status: "completed", side: null },
		{ access: null, status: null, side: "client" },
		{ access: null, status: "active", side: "provider" },
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
	assertEquals(parseLandingSim("access=admin&status=draft"), {
		access: null,
		status: "draft",
		side: null,
	});
	assertEquals(parseLandingSim("access=owner&status=deleted"), {
		access: "owner",
		status: null,
		side: null,
	});
	assertEquals(parseLandingSim("status=archived"), {
		access: null,
		status: "archived",
		side: null,
	});
	assertEquals(parseLandingSim("side=seller"), NO_LANDING_SIM);
	assertEquals(parseLandingSim("garbage"), NO_LANDING_SIM);
});

Deno.test("any axis alone makes the simulation active", () => {
	assert(isLandingSimActive({ access: "owner", status: null, side: null }));
	assert(isLandingSimActive({ access: null, status: "on_hold", side: null }));
	assert(isLandingSimActive({ access: null, status: null, side: "provider" }));
});

Deno.test("a service side stands its client on the owner side and its provider as the configurer", () => {
	const client = { ...NO_LANDING_SIM, side: "client" as const };
	const provider = { ...NO_LANDING_SIM, side: "provider" as const };
	assertEquals(serviceSideAccess(client, true), { access: "owner", canConfigure: false });
	assertEquals(serviceSideAccess(provider, true), { access: "participant", canConfigure: true });
	assertEquals(serviceSideAccess(client, false), null, "a brief has no service side");
	assertEquals(serviceSideAccess(NO_LANDING_SIM, true), null);
});
