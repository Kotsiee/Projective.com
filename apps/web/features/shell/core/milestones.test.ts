import { assertEquals } from "@std/assert";
import { markOf, milestoneReached } from "./milestones.ts";

const none = { stamp: "none", complete: false } as const;

Deno.test("milestones — a first sighting sets the baseline and celebrates nothing", () => {
	assertEquals(milestoneReached(null, { stamp: "vault_verified", complete: true }), null);
});

Deno.test("milestones — a raised stamp is celebrated as the new stamp", () => {
	assertEquals(milestoneReached(none, { stamp: "id_verified", complete: false }), "id_verified");
	assertEquals(
		milestoneReached({ stamp: "id_verified", complete: false }, {
			stamp: "vault_verified",
			complete: false,
		}),
		"vault_verified",
	);
});

Deno.test("milestones — a stamp raise outranks setup reaching 100%", () => {
	assertEquals(
		milestoneReached(none, { stamp: "vault_verified", complete: true }),
		"vault_verified",
	);
});

Deno.test("milestones — setup reaching 100% is celebrated once", () => {
	assertEquals(milestoneReached(none, { stamp: "none", complete: true }), "setup_complete");
	assertEquals(
		milestoneReached({ stamp: "none", complete: true }, { stamp: "none", complete: true }),
		null,
	);
});

Deno.test("milestones — a lowered stamp or setup is never celebrated", () => {
	assertEquals(
		milestoneReached({ stamp: "vault_verified", complete: true }, {
			stamp: "id_verified",
			complete: false,
		}),
		null,
	);
});

Deno.test("markOf — complete exactly at 100", () => {
	const base = {
		handle: "juno",
		seller: true,
		verificationStamp: "id_verified" as const,
		hours: null,
		standing: null,
	};
	assertEquals(
		markOf({ ...base, progress: { score: 100, completedKeys: [], nextSuggestedAction: null } }),
		{ stamp: "id_verified", complete: true },
	);
	assertEquals(
		markOf({
			...base,
			progress: { score: 80, completedKeys: [], nextSuggestedAction: "publish_hours" },
		}),
		{ stamp: "id_verified", complete: false },
	);
});
