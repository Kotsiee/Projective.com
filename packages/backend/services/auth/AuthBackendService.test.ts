import { assertEquals } from "@std/assert";
import { AuthBackendService, pickUsernameMatch, usernameCandidates } from "./AuthBackendService.ts";

/**
 * The username → account resolution behind a password sign-in. The lookup is a service-role read
 * that a unit test cannot issue, so the two pure halves are pinned directly: which spellings are
 * asked for, and which returned row wins.
 */

// #region usernameCandidates
Deno.test("usernameCandidates asks for the value as typed and lowercased, once each", () => {
	assertEquals(usernameCandidates("Ada_L"), ["Ada_L", "ada_l"]);
	assertEquals(usernameCandidates("ada_l"), ["ada_l"]);
});
// #endregion

// #region pickUsernameMatch
Deno.test("pickUsernameMatch prefers the row spelt exactly as typed", () => {
	const rows = [
		{ user_id: "u-lower", username: "ada" },
		{ user_id: "u-exact", username: "Ada" },
	];
	assertEquals(pickUsernameMatch("Ada", rows)?.user_id, "u-exact");
});

Deno.test("pickUsernameMatch falls back to the canonical lowercase row", () => {
	const rows = [{ user_id: "u-lower", username: "ada" }];
	assertEquals(pickUsernameMatch("ADA", rows)?.user_id, "u-lower");
});

Deno.test("pickUsernameMatch is null when nothing matches", () => {
	assertEquals(pickUsernameMatch("ada", []), null);
	assertEquals(pickUsernameMatch("ada", [{ user_id: "x", username: "adam" }]), null);
});
// #endregion

// #region The stub branch — reachable with the gate off, and identifier-agnostic
Deno.test("authenticate (stub) accepts an email or a username identically", async () => {
	// The master mock switch ANDs every live gate off, whatever the shell's AUTH_BACKEND_LIVE says.
	const prior = Deno.env.get("USE_MOCKS");
	Deno.env.set("USE_MOCKS", "true");
	try {
		for (const identifier of ["ada@example.com", "ada"]) {
			const result = await AuthBackendService.authenticate({
				identifier,
				password: "hunter22",
				redirectTo: "/projects",
			});
			assertEquals(result.ok, true);
			assertEquals(result.data?.redirectTo, "/projects");
			assertEquals(result.data?.requiresVerification, false);
			assertEquals(result.data?.email, undefined);
		}
	} finally {
		if (prior === undefined) Deno.env.delete("USE_MOCKS");
		else Deno.env.set("USE_MOCKS", prior);
	}
});
// #endregion
