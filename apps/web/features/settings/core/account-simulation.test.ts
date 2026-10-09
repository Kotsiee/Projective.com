import { assertEquals, assertStrictEquals } from "@std/assert";
import type { SettingsSectionDataOf } from "@projective/types/settings";
import { simulatedAccountData } from "./account-simulation.ts";

const NOW = new Date(Date.UTC(2026, 9, 8));

const REAL: SettingsSectionDataOf<"account"> = {
	section: "account",
	identity: { firstName: "Juno", lastName: "Reyes", username: "juno", dob: "1994-05-02" },
	emails: [],
	handlePolicy: {
		handle: "juno",
		remaining: 2,
		windowEndsAt: null,
		lockedUntil: null,
		lastChangedAt: null,
		totalChanges: 0,
	},
	lifecycle: null,
	connected: null,
};

Deno.test("account simulation — auto passes the real reads through untouched", () => {
	assertStrictEquals(simulatedAccountData("auto", REAL, NOW), REAL);
});

Deno.test("account simulation — the handle positions substitute the policy only", () => {
	const window = simulatedAccountData("handle-window", REAL, NOW);
	assertEquals(window.handlePolicy?.remaining, 1);
	assertEquals(window.handlePolicy?.windowEndsAt, "2026-10-10T00:00:00.000Z");
	const locked = simulatedAccountData("handle-locked", REAL, NOW);
	assertEquals(locked.handlePolicy?.remaining, 0);
	assertEquals(locked.handlePolicy?.handle, "juno");
	assertStrictEquals(locked.lifecycle, null);
});

Deno.test("account simulation — the removal positions schedule against a set-up seller", () => {
	const removal = simulatedAccountData("removal-scheduled", REAL, NOW);
	assertEquals(removal.lifecycle?.isFreelancer, false);
	assertEquals(removal.lifecycle?.freelancerRemoval?.scheduledFor, "2027-01-01T00:00:00.000Z");
	const deletion = simulatedAccountData("deletion-scheduled", REAL, NOW);
	assertEquals(deletion.lifecycle?.accountDeletion?.scope, "account");
});
