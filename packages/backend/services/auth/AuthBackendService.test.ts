import { assert, assertEquals } from "@std/assert";
import {
	ENTERPRISE_OWNER_MINOR_REFUSAL,
	todayIn,
	UNDER_MINIMUM_REASON,
	UNDER_MINIMUM_REFUSAL,
	USERNAME_RE,
} from "@projective/types/auth";
import { localHandleRefusal } from "@projective/types/workspace";
import {
	AuthBackendService,
	ENTERPRISE_REFUSED,
	ownerHandleCandidates,
	pickUsernameMatch,
	type ProvisionEnterpriseInput,
	usernameCandidates,
} from "./AuthBackendService.ts";

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

// #region ownerHandleCandidates
Deno.test("ownerHandleCandidates derives first-last, then the alternatives, then a random variant", () => {
	const out = ownerHandleCandidates("Ada", "Lovelace", "a1b2c3");
	assertEquals(out[0], "ada-lovelace");
	assertEquals(out[1], "ada-lovelace-hq");
	assertEquals(out.at(-1), "ada-lovelace-a1b2c3");
});

Deno.test("ownerHandleCandidates drops accents and falls back to `owner` when no Latin letter is left", () => {
	assertEquals(ownerHandleCandidates("José", "Núñez", "a1b2c3")[0], "jose-nunez");
	assertEquals(ownerHandleCandidates("王", "小明", "a1b2c3")[0], "owner");
	assertEquals(ownerHandleCandidates("12", "O'Brien", "a1b2c3")[0], "o-brien");
});

Deno.test("ownerHandleCandidates: every candidate fits the sign-up shape and the namespace rule", () => {
	const names = [["Ada", "Lovelace"], ["Bartholomew-Maximilian", "Featherstonehaugh"], ["A", "B"]];
	for (const [first, last] of names) {
		for (const handle of ownerHandleCandidates(first, last)) {
			assert(USERNAME_RE.test(handle) && localHandleRefusal(handle) === null, handle);
		}
	}
});
// #endregion

// #region The enterprise branch — live, against a fake GoTrue and PostgREST
interface FakeCall {
	method: string;
	path: string;
	body: Record<string, unknown> | null;
}

type FakeAnswer = { status?: number; json: unknown };

/** The GoTrue user the fake creates (a UUID: the pending-verification token names one). */
const OWNER_ID = "00000000-0000-4000-8000-000000000001";

const LIVE_ENV: Record<string, string> = {
	USE_MOCKS: "false",
	AUTH_BACKEND_LIVE: "true",
	SUPABASE_URL: "http://supabase.fake",
	SUPABASE_ANON_KEY: "XXXX-XXXX",
	SUPABASE_SERVICE_ROLE_KEY: "XXXX-XXXX",
};

/**
 * Run `body` with the live auth gate on and a fake at `globalThis.fetch` standing in for GoTrue and
 * PostgREST: `create` answers each `create_enterprise` call, given the owner's username in it.
 */
async function withFakeSupabase(
	create: (username: string) => FakeAnswer,
	body: (calls: FakeCall[]) => Promise<void>,
): Promise<void> {
	const calls: FakeCall[] = [];
	const realFetch = globalThis.fetch;
	const saved = Object.keys(LIVE_ENV).map((key) => [key, Deno.env.get(key)] as const);
	for (const [key, value] of Object.entries(LIVE_ENV)) Deno.env.set(key, value);
	globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		const text = await request.text();
		const call = {
			method: request.method,
			path: new URL(request.url).pathname,
			body: text ? JSON.parse(text) : null,
		};
		calls.push(call);
		const answer: FakeAnswer = call.path === "/rest/v1/rpc/create_enterprise"
			? create(usernameOf(call.body ?? {}))
			: call.path === "/auth/v1/admin/users"
			? { json: { id: OWNER_ID, email: "owner@acme.example" } }
			: { json: {} };
		return new Response(JSON.stringify(answer.json), {
			status: answer.status ?? 200,
			headers: { "content-type": "application/json" },
		});
	};
	try {
		await body(calls);
	} finally {
		globalThis.fetch = realFetch;
		for (const [key, value] of saved) {
			if (value === undefined) Deno.env.delete(key);
			else Deno.env.set(key, value);
		}
	}
}

const OWNER = { firstName: "Ada", lastName: "Lovelace", dob: "1990-03-14", timeZone: "UTC" };

function joinEnterprise(owner = OWNER) {
	const input: ProvisionEnterpriseInput = {
		type: "enterprise",
		corporateEmail: "owner@acme.example",
		password: "Correct-horse-1",
		owner,
		enterprise: {
			legalName: "Acme Ltd",
			tradingName: "",
			handle: "acme",
			registrationNumber: "",
			corporateEmail: "owner@acme.example",
			corporatePhone: "",
			website: "",
			addressLine1: "1 Acme Way",
			addressCity: "London",
			addressPostcode: "EC1A 1AA",
			addressCountry: "GB",
			employeeScale: "1-50",
			primaryIndustry: "software",
			industryOther: "",
			departments: [],
			purpose: [],
		},
		redirectTo: "/home",
	};
	return AuthBackendService.provisionAccount(input);
}

/** The owner's username a `create_enterprise` call carries. */
function usernameOf(body: Record<string, unknown>): string {
	return (body.p_payload as { owner: { username: string } }).owner.username;
}

/** The `create_enterprise` calls made, in order. */
function creates(calls: FakeCall[]) {
	return calls.filter((c) => c.path === "/rest/v1/rpc/create_enterprise").map((c) => c.body ?? {});
}

/** Whether the owner's GoTrue user was deleted again. */
function discarded(calls: FakeCall[]): boolean {
	return calls.some((c) => c.method === "DELETE" && c.path === `/auth/v1/admin/users/${OWNER_ID}`);
}

const TAKEN = {
	status: 409,
	json: { code: "23505", message: "That handle is taken.", details: null, hint: null },
};

Deno.test("enterprise (live): create_enterprise gets the owner block; a taken handle moves to the next", async () => {
	const answer = (username: string) => username === "ada-lovelace" ? TAKEN : { json: "ent-1" };
	await withFakeSupabase(answer, async (calls) => {
		const result = await joinEnterprise();
		assertEquals(result.ok, true);
		assertEquals(creates(calls).map((c) => usernameOf(c)), ["ada-lovelace", "ada-lovelace-hq"]);
		assertEquals(creates(calls)[1].p_owner, OWNER_ID);
		assertEquals((creates(calls)[1].p_payload as Record<string, unknown>).owner, {
			...OWNER,
			username: "ada-lovelace-hq",
		});
		assertEquals(discarded(calls), false);
	});
});

Deno.test("enterprise (live): every derived handle taken → refused, and the owner is deleted", async () => {
	await withFakeSupabase(() => TAKEN, async (calls) => {
		const result = await joinEnterprise();
		assertEquals(result.status, 422);
		assertEquals(result.message, ENTERPRISE_REFUSED);
		const tried = creates(calls).map((c) => usernameOf(c));
		assertEquals(tried.slice(0, 2), ["ada-lovelace", "ada-lovelace-hq"]);
		assertEquals(tried.length, ownerHandleCandidates("Ada", "Lovelace").length);
		assert(/^ada-lovelace-[0-9a-f]{6}$/.test(tried.at(-1) ?? ""), tried.at(-1));
		assertEquals(discarded(calls), true);
	});
});

Deno.test("enterprise (live): any other RPC failure is not retried, and the owner is deleted", async () => {
	const refused = {
		status: 403,
		json: { code: "PM403", message: "workspace", details: null, hint: null },
	};
	await withFakeSupabase(() => refused, async (calls) => {
		const result = await joinEnterprise();
		assertEquals(result.message, ENTERPRISE_REFUSED);
		assertEquals(creates(calls).length, 1);
		assertEquals(discarded(calls), true);
	});
});

Deno.test("enterprise: an owner under 18 is refused before anything is written", async () => {
	const yearsAgo = (years: number) => `${Number(todayIn("UTC").slice(0, 4)) - years}-01-01`;
	await withFakeSupabase(() => ({ json: "ent-1" }), async (calls) => {
		const minor = await joinEnterprise({ ...OWNER, dob: yearsAgo(16) });
		assertEquals(minor.errors?.dob, ENTERPRISE_OWNER_MINOR_REFUSAL);
		const child = await joinEnterprise({ ...OWNER, dob: yearsAgo(11) });
		assertEquals(child.errors?.dob, UNDER_MINIMUM_REFUSAL);
		assertEquals(child.details?.reason, UNDER_MINIMUM_REASON);
		assertEquals(calls.length, 0);
	});
});
// #endregion
