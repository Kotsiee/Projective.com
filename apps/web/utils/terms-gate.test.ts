import { assert, assertEquals } from "@std/assert";
import { GUEST_CONTEXT, type UserContext } from "@projective/types/auth";
import { isTermsDueRequest } from "./terms-gate.ts";

const current: UserContext = { ...GUEST_CONTEXT, role: "member", userId: "u1" };
const due: UserContext = { ...current, termsDue: true };

function request(cookie?: string): Request {
	return new Request("http://localhost/projects", cookie ? { headers: { cookie } } : {});
}

function withEnv(value: string | undefined, run: () => void) {
	return () => {
		const prior = Deno.env.get("DENO_ENV");
		if (value === undefined) Deno.env.delete("DENO_ENV");
		else Deno.env.set("DENO_ENV", value);
		try {
			run();
		} finally {
			if (prior === undefined) Deno.env.delete("DENO_ENV");
			else Deno.env.set("DENO_ENV", prior);
		}
	};
}

Deno.test(
	"terms gate: only an explicit termsDue claim is due",
	withEnv("production", () => {
		assert(isTermsDueRequest(request(), due));
		assertEquals(isTermsDueRequest(request(), current), false);
		assertEquals(isTermsDueRequest(request(), undefined), false);
	}),
);

Deno.test(
	"terms gate: the switcher cookie overrides the token in development, both ways",
	withEnv("development", () => {
		assert(isTermsDueRequest(request("pj.dev.terms=due"), current));
		assertEquals(isTermsDueRequest(request("pj.dev.terms=current"), due), false);
		assert(isTermsDueRequest(request("pj.dev.terms=maybe"), due), "an unknown value is ignored");
	}),
);

Deno.test(
	"terms gate: production and an unset DENO_ENV ignore the switcher cookie",
	() => {
		withEnv("production", () => {
			assertEquals(isTermsDueRequest(request("pj.dev.terms=due"), current), false);
			assert(isTermsDueRequest(request("pj.dev.terms=current"), due));
		})();
		withEnv(undefined, () => {
			assertEquals(isTermsDueRequest(request("pj.dev.terms=due"), current), false);
		})();
	},
);
