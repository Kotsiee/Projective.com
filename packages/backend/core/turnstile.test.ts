import { assertEquals } from "@std/assert";
import {
	isTurnstileTestKey,
	resolveTurnstileKeys,
	TURNSTILE_TEST_KEYS,
	type TurnstileVerifyInput,
	verifyTurnstile,
} from "./turnstile.ts";

const NOW = Date.parse("2026-11-18T12:00:00.000Z");
const REAL_SITE = "0x4AAAAAAAreal-site";
const REAL_SECRET = "0x4AAAAAAAreal-secret";

function replying(
	body: unknown,
	status = 200,
): { fetchImpl: typeof fetch; sent: URLSearchParams[] } {
	const sent: URLSearchParams[] = [];
	const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) => {
		sent.push(init?.body as URLSearchParams);
		return Promise.resolve(new Response(JSON.stringify(body), { status }));
	}) as typeof fetch;
	return { fetchImpl, sent };
}

function input(overrides: Partial<TurnstileVerifyInput>): TurnstileVerifyInput {
	return {
		token: "token-abc",
		secretKey: REAL_SECRET,
		action: "join",
		remoteIp: "203.0.113.7",
		allowedHostnames: ["projective.com"],
		development: false,
		nowMs: NOW,
		...overrides,
	};
}

const REAL_PASS = {
	success: true,
	hostname: "projective.com",
	action: "join",
	challenge_ts: "2026-11-18T11:58:30.000Z",
};

Deno.test("Cloudflare's test keys are recognised, real keys are not", () => {
	for (
		const key of [
			...Object.values(TURNSTILE_TEST_KEYS.site),
			...Object.values(TURNSTILE_TEST_KEYS.secret),
		]
	) {
		assertEquals(isTurnstileTestKey(key), true, key);
	}
	assertEquals(isTurnstileTestKey(REAL_SITE), false);
	assertEquals(isTurnstileTestKey("XXXX-XXXX"), false);
});

Deno.test("the environment pair is used as given in development", () => {
	assertEquals(
		resolveTurnstileKeys({
			siteKey: REAL_SITE,
			secretKey: REAL_SECRET,
			development: true,
			override: null,
		}),
		{ siteKey: REAL_SITE, secretKey: REAL_SECRET },
	);
});

Deno.test("the placeholder counts as no key", () => {
	assertEquals(
		resolveTurnstileKeys({
			siteKey: "XXXX-XXXX",
			secretKey: "XXXX-XXXX",
			development: true,
			override: null,
		}),
		{ siteKey: null, secretKey: null },
	);
});

Deno.test("test keys count as absent outside development", () => {
	const keys = {
		siteKey: TURNSTILE_TEST_KEYS.site.pass,
		secretKey: TURNSTILE_TEST_KEYS.secret.pass,
		override: null,
	};
	assertEquals(resolveTurnstileKeys({ ...keys, development: false }), {
		siteKey: null,
		secretKey: null,
	});
	assertEquals(resolveTurnstileKeys({ ...keys, development: true }), {
		siteKey: TURNSTILE_TEST_KEYS.site.pass,
		secretKey: TURNSTILE_TEST_KEYS.secret.pass,
	});
});

Deno.test("the dev override swaps in the matching test pair, in development only", () => {
	const env = { siteKey: REAL_SITE, secretKey: REAL_SECRET };
	assertEquals(resolveTurnstileKeys({ ...env, development: true, override: "fail" }), {
		siteKey: TURNSTILE_TEST_KEYS.site.fail,
		secretKey: TURNSTILE_TEST_KEYS.secret.fail,
	});
	assertEquals(resolveTurnstileKeys({ ...env, development: true, override: "interactive" }), {
		siteKey: TURNSTILE_TEST_KEYS.site.interactive,
		secretKey: TURNSTILE_TEST_KEYS.secret.pass,
	});
	assertEquals(resolveTurnstileKeys({ ...env, development: false, override: "pass" }), env);
});

Deno.test("no secret skips the check in development and refuses elsewhere", async () => {
	assertEquals(await verifyTurnstile(input({ secretKey: null, development: true })), {
		ok: true,
		skipped: true,
	});
	assertEquals(await verifyTurnstile(input({ secretKey: null })), {
		ok: false,
		reason: "unconfigured",
	});
});

Deno.test("a missing token is refused without calling Cloudflare", async () => {
	const { fetchImpl, sent } = replying(REAL_PASS);
	assertEquals(await verifyTurnstile(input({ token: "  ", fetchImpl })), {
		ok: false,
		reason: "missing",
	});
	assertEquals(sent.length, 0);
});

Deno.test("a real pass on the right hostname and action is accepted", async () => {
	const { fetchImpl, sent } = replying(REAL_PASS);
	assertEquals(await verifyTurnstile(input({ fetchImpl })), { ok: true, skipped: false });
	assertEquals(sent[0].get("secret"), REAL_SECRET);
	assertEquals(sent[0].get("response"), "token-abc");
	assertEquals(sent[0].get("remoteip"), "203.0.113.7");
	assertEquals(sent[0].get("idempotency_key")?.length, 36);
});

Deno.test("a pass for another hostname, action or an old challenge is refused", async () => {
	for (
		const reply of [
			{ ...REAL_PASS, hostname: "evil.example" },
			{ ...REAL_PASS, action: "login" },
			{ ...REAL_PASS, challenge_ts: "2026-11-18T11:54:00.000Z" },
			{ ...REAL_PASS, challenge_ts: undefined },
			{ ...REAL_PASS, success: false },
		]
	) {
		const { fetchImpl } = replying(reply);
		assertEquals(await verifyTurnstile(input({ fetchImpl })), { ok: false, reason: "refused" });
	}
});

Deno.test("a test-key pass is accepted only in development", async () => {
	const reply = {
		success: true,
		hostname: "example.com",
		challenge_ts: "2026-11-18T11:59:00.000Z",
		metadata: { result_with_testing_key: true },
	};
	assertEquals(
		await verifyTurnstile(input({ fetchImpl: replying(reply).fetchImpl, development: true })),
		{ ok: true, skipped: false },
	);
	assertEquals(await verifyTurnstile(input({ fetchImpl: replying(reply).fetchImpl })), {
		ok: false,
		reason: "refused",
	});
});

Deno.test("Cloudflare failing or unreachable is unavailable, not refused", async () => {
	assertEquals(await verifyTurnstile(input({ fetchImpl: replying({}, 500).fetchImpl })), {
		ok: false,
		reason: "unavailable",
	});
	const throwing = (() => Promise.reject(new TypeError("offline"))) as typeof fetch;
	assertEquals(await verifyTurnstile(input({ fetchImpl: throwing })), {
		ok: false,
		reason: "unavailable",
	});
});
