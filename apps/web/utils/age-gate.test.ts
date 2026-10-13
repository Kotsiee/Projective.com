import { assert, assertEquals } from "@std/assert";
import {
	AGE_RESTRICTED_REASON,
	GUEST_CONTEXT,
	RESTRICTED_REFUSAL,
	type UserContext,
} from "@projective/types/auth";
import { isRestrictedRequest, refuseIfRestricted } from "./age-gate.ts";

const adult: UserContext = { ...GUEST_CONTEXT, role: "member", userId: "u1", restricted: false };
const minor: UserContext = { ...adult, restricted: true };

function request(cookie?: string): Request {
	return new Request("http://localhost/api/checkout/create", cookie ? { headers: { cookie } } : {});
}

function withEnv(value: string | undefined, run: () => void | Promise<void>) {
	return async () => {
		const prior = Deno.env.get("DENO_ENV");
		if (value === undefined) Deno.env.delete("DENO_ENV");
		else Deno.env.set("DENO_ENV", value);
		try {
			await run();
		} finally {
			if (prior === undefined) Deno.env.delete("DENO_ENV");
			else Deno.env.set("DENO_ENV", prior);
		}
	};
}

Deno.test(
	"age gate: a restricted token is refused with the shared 403 copy",
	withEnv("production", async () => {
		const response = refuseIfRestricted(request(), minor);
		assert(response);
		assertEquals(response.status, 403);
		const body = await response.json();
		assertEquals(body.message, RESTRICTED_REFUSAL);
		assertEquals(body.details.reason, AGE_RESTRICTED_REASON);
		assertEquals(refuseIfRestricted(request(), adult), null);
		assertEquals(refuseIfRestricted(request(), undefined), null);
	}),
);

Deno.test(
	"age gate: the switcher cookie overrides the token in development, both ways",
	withEnv("development", () => {
		assert(isRestrictedRequest(request("pj.dev.age=minor"), adult));
		assertEquals(isRestrictedRequest(request("pj.dev.age=adult"), minor), false);
		assert(isRestrictedRequest(request("pj.dev.age=maybe"), minor), "an unknown value is ignored");
	}),
);

Deno.test(
	"age gate: an unset DENO_ENV is development, as the backend reads it",
	withEnv(undefined, () => {
		assert(isRestrictedRequest(request("pj.dev.age=minor"), adult));
	}),
);

Deno.test(
	"age gate: production ignores the switcher cookie",
	withEnv("production", () => {
		assertEquals(isRestrictedRequest(request("pj.dev.age=minor"), adult), false);
		assert(isRestrictedRequest(request("pj.dev.age=adult"), minor));
	}),
);
