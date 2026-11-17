import { assertEquals } from "@std/assert";
import type { UserContext } from "@projective/types/auth";
import { readActor } from "./api-session.ts";
import type { State } from "./state.ts";

function withDenoEnv(value: string, fn: () => void): void {
	const before = Deno.env.get("DENO_ENV");
	try {
		Deno.env.set("DENO_ENV", value);
		fn();
	} finally {
		if (before === undefined) Deno.env.delete("DENO_ENV");
		else Deno.env.set("DENO_ENV", before);
	}
}

const PERSON = { userId: "u-1", contextType: "personal", contextId: "" } as UserContext;

function ctxWith(cookie: string, userContext: UserContext | null = PERSON) {
	return {
		req: new Request("http://localhost/api/checkout/session", { headers: { cookie } }),
		state: { userContext, accessToken: "token" } as State,
	};
}

Deno.test("#436: a development build carries the FX and plan-gate overrides on the actor", () => {
	withDenoEnv("development", () => {
		const actor = readActor(ctxWith("pj.dev.fx-checkout=on; pj.dev.plan-gates=enforced"));
		assertEquals([actor.userId, actor.fxCheckoutOverride, actor.planGatesOverride], [
			"u-1",
			"on",
			"enforced",
		]);
	});
});

Deno.test("#436: production ignores every override cookie", () => {
	withDenoEnv("production", () => {
		const actor = readActor(ctxWith("pj.dev.fx-checkout=on; pj.dev.plan-gates=free"));
		assertEquals([actor.fxCheckoutOverride, actor.planGatesOverride], [undefined, undefined]);
	});
});

Deno.test("#436: an unknown value, or a guest, carries no override", () => {
	withDenoEnv("development", () => {
		assertEquals(readActor(ctxWith("pj.dev.fx-checkout=maybe")).fxCheckoutOverride, undefined);
		assertEquals(readActor(ctxWith("pj.dev.fx-checkout=off", null)).fxCheckoutOverride, undefined);
	});
});
