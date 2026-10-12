import { assertEquals } from "@std/assert";
import { NO_DISCOVERY_SIM } from "@projective/types/explore";
import { encodeDiscoverySim, parseDiscoverySim } from "./discovery-sim.ts";

/**
 * The cookie that carries the Dev Context Switcher's discovery cold-start simulation to `/explore`'s
 * server render: it round-trips, "no simulation" has one spelling (no cookie), and nothing a hand-
 * edited cookie says can invent a value.
 */

Deno.test("a simulation round-trips through the cookie", () => {
	const sim = { viewer: "no_history", activity: "quiet" } as const;
	assertEquals(parseDiscoverySim(encodeDiscoverySim(sim)), sim);
	assertEquals(parseDiscoverySim(encodeDiscoverySim({ viewer: "no_signals", activity: "auto" })), {
		viewer: "no_signals",
		activity: "auto",
	});
});

Deno.test("no simulation is no cookie, and a missing cookie is no simulation", () => {
	assertEquals(encodeDiscoverySim(NO_DISCOVERY_SIM), null);
	assertEquals(parseDiscoverySim(undefined), NO_DISCOVERY_SIM);
	assertEquals(parseDiscoverySim(""), NO_DISCOVERY_SIM);
});

Deno.test("an unrecognised value falls back to auto, axis by axis", () => {
	assertEquals(parseDiscoverySim("viewer=admin&activity=quiet"), {
		viewer: "auto",
		activity: "quiet",
	});
	assertEquals(parseDiscoverySim("viewer=no_history&activity=loud"), {
		viewer: "no_history",
		activity: "auto",
	});
});
