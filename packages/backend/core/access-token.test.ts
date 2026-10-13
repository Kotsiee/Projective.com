import { assertEquals } from "@std/assert";
import { create } from "djwt";
import {
	type AccessTokenVerdict,
	createAccessTokenVerifier,
	EXP_LEEWAY_SECONDS,
	JWKS_MIN_REFETCH_MS,
	JWKS_TTL_MS,
	jwksUrlFor,
} from "./access-token.ts";

// #region Harness
const JWKS_URL = "https://project.example.test/auth/v1/.well-known/jwks.json";
const SECRET = "legacy-jwt-secret-with-at-least-32-characters";

async function ecKey(kid: string) {
	const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	]);
	const jwk = {
		...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
		kid,
		alg: "ES256",
		use: "sig",
	};
	return { kid, privateKey: pair.privateKey, jwk };
}

async function rsaKey(kid: string) {
	const pair = await crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	);
	const jwk = {
		...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
		kid,
		alg: "RS256",
		use: "sig",
	};
	return { kid, privateKey: pair.privateKey, jwk };
}

const hmacKey = await crypto.subtle.importKey(
	"raw",
	new TextEncoder().encode(SECRET),
	{ name: "HMAC", hash: "SHA-256" },
	false,
	["sign"],
);

const EC = await ecKey("ec-1");
const RSA = await rsaKey("rsa-1");

function seconds(offset = 0): number {
	return Math.floor(Date.now() / 1000) + offset;
}

const SESSION = { sub: "u-alice", aud: "authenticated", role: "authenticated" };

function es256(claims: Record<string, unknown>, key = EC): Promise<string> {
	return create({ alg: "ES256", typ: "JWT", kid: key.kid }, claims, key.privateKey);
}

function hs256(claims: Record<string, unknown>): Promise<string> {
	return create({ alg: "HS256", typ: "JWT" }, claims, hmacKey);
}

function base64Url(text: string): string {
	return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A JWKS endpoint whose key set and availability a test can change, counting its fetches. */
function jwksServer(initial: object[]) {
	const server = { keys: initial, down: false, fetches: 0 };
	const fetchJwks = (url: string) => {
		server.fetches++;
		assertEquals(url, JWKS_URL);
		if (server.down) return Promise.reject(new TypeError("connection refused"));
		return Promise.resolve(Response.json({ keys: server.keys }));
	};
	return { server, fetchJwks };
}

function reason(verdict: AccessTokenVerdict): string {
	return verdict.status === "invalid" ? verdict.reason : verdict.status;
}
// #endregion

// #region Signatures
Deno.test("access-token: ES256 and RS256 tokens verify against the JWKS", async () => {
	const { fetchJwks } = jwksServer([EC.jwk, RSA.jwk]);
	const verifier = createAccessTokenVerifier({ jwksUrl: JWKS_URL, fetchJwks });
	const exp = seconds(3600);

	const ec = await verifier.verify(await es256({ ...SESSION, exp }));
	assertEquals(ec.status, "valid");
	if (ec.status === "valid") assertEquals(ec.payload.sub, "u-alice");

	const rsa = await create(
		{ alg: "RS256", typ: "JWT", kid: RSA.kid },
		{ ...SESSION, exp },
		RSA.privateKey,
	);
	assertEquals((await verifier.verify(rsa)).status, "valid");
});

Deno.test("access-token: HS256 verifies with the legacy secret, and only with it", async () => {
	const token = await hs256({ ...SESSION, exp: seconds(3600) });
	assertEquals(
		(await createAccessTokenVerifier({ hsSecret: SECRET }).verify(token)).status,
		"valid",
	);
	assertEquals(
		reason(await createAccessTokenVerifier({ hsSecret: "another-secret" }).verify(token)),
		"signature",
	);
	assertEquals(reason(await createAccessTokenVerifier({}).verify(token)), "unconfigured");
	assertEquals(
		reason(await createAccessTokenVerifier({ hsSecret: "XXXX-XXXX" }).verify(token)),
		"unconfigured",
	);
});

Deno.test("access-token: a rewritten payload fails the signature", async () => {
	const { fetchJwks } = jwksServer([EC.jwk]);
	const verifier = createAccessTokenVerifier({ jwksUrl: JWKS_URL, fetchJwks });
	const [header, , signature] = (await es256({ ...SESSION, exp: seconds(3600) })).split(".");
	const forged = base64Url(JSON.stringify({ ...SESSION, sub: "u-mallory", exp: seconds(3600) }));
	assertEquals(reason(await verifier.verify(`${header}.${forged}.${signature}`)), "signature");
});

Deno.test("access-token: a key from another project fails the signature", async () => {
	const { fetchJwks } = jwksServer([EC.jwk]);
	const verifier = createAccessTokenVerifier({ jwksUrl: JWKS_URL, fetchJwks });
	const impostor = await ecKey(EC.kid);
	assertEquals(
		reason(await verifier.verify(await es256({ ...SESSION, exp: seconds(3600) }, impostor))),
		"signature",
	);
});

Deno.test("access-token: alg none, unknown algs and garbage are refused before any key is fetched", async () => {
	const { server, fetchJwks } = jwksServer([EC.jwk]);
	const verifier = createAccessTokenVerifier({ jwksUrl: JWKS_URL, hsSecret: SECRET, fetchJwks });
	const body = base64Url(JSON.stringify({ ...SESSION, exp: seconds(3600) }));
	assertEquals(
		reason(await verifier.verify(`${base64Url('{"alg":"none","typ":"JWT"}')}.${body}.`)),
		"unsupported_alg",
	);
	assertEquals(
		reason(await verifier.verify(`${base64Url('{"alg":"ES512","typ":"JWT"}')}.${body}.x`)),
		"unsupported_alg",
	);
	assertEquals(reason(await verifier.verify("opaque-session-value")), "malformed");
	assertEquals(reason(await verifier.verify("a.b.c")), "malformed");
	assertEquals(server.fetches, 0);
});

Deno.test("access-token: an HS256 token signed with the public key is not checked against the JWKS", async () => {
	const { fetchJwks } = jwksServer([EC.jwk]);
	const verifier = createAccessTokenVerifier({ jwksUrl: JWKS_URL, fetchJwks });
	const publicKeyAsSecret = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(JSON.stringify(EC.jwk)),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const token = await create({ alg: "HS256", typ: "JWT", kid: EC.kid }, {
		...SESSION,
		exp: seconds(3600),
	}, publicKeyAsSecret);
	assertEquals(reason(await verifier.verify(token)), "unconfigured");
});
// #endregion

// #region Claims
Deno.test("access-token: expiry is enforced with a small leeway", async () => {
	const { fetchJwks } = jwksServer([EC.jwk]);
	const verifier = createAccessTokenVerifier({ jwksUrl: JWKS_URL, fetchJwks });
	assertEquals(
		reason(await verifier.verify(await es256({ ...SESSION, exp: seconds(-3600) }))),
		"expired",
	);
	assertEquals(
		(await verifier.verify(await es256({ ...SESSION, exp: seconds(5 - EXP_LEEWAY_SECONDS) })))
			.status,
		"valid",
	);
	assertEquals(reason(await verifier.verify(await es256({ ...SESSION }))), "malformed");
});

Deno.test("access-token: a project-signed JWT that is not a user session is refused (the legacy anon key)", async () => {
	const verifier = createAccessTokenVerifier({ hsSecret: SECRET });
	const anonKey = await hs256({ iss: "supabase", role: "anon", exp: seconds(10 * 365 * 86400) });
	assertEquals(reason(await verifier.verify(anonKey)), "not_a_session");
	const noSubject = await hs256({ aud: "authenticated", exp: seconds(3600) });
	assertEquals(reason(await verifier.verify(noSubject)), "not_a_session");
	const listAudience = await hs256({ sub: "u-alice", aud: ["authenticated"], exp: seconds(3600) });
	assertEquals((await verifier.verify(listAudience)).status, "valid");
});
// #endregion

// #region JWKS cache
Deno.test("access-token: the JWKS is fetched once and reused until it goes stale", async () => {
	let clock = 1_000_000;
	const { server, fetchJwks } = jwksServer([EC.jwk]);
	const verifier = createAccessTokenVerifier({ jwksUrl: JWKS_URL, fetchJwks, now: () => clock });
	const token = await es256({ ...SESSION, exp: seconds(3600) });

	await Promise.all([verifier.verify(token), verifier.verify(token), verifier.verify(token)]);
	assertEquals(server.fetches, 1);
	clock += JWKS_TTL_MS + 1;
	assertEquals((await verifier.verify(token)).status, "valid");
	assertEquals(server.fetches, 2);
});

Deno.test("access-token: a rotated-in key is picked up; made-up kids cost one fetch per window", async () => {
	let clock = 1_000_000;
	const { server, fetchJwks } = jwksServer([EC.jwk]);
	const verifier = createAccessTokenVerifier({ jwksUrl: JWKS_URL, fetchJwks, now: () => clock });
	await verifier.verify(await es256({ ...SESSION, exp: seconds(3600) }));
	assertEquals(server.fetches, 1);

	const rotated = await ecKey("ec-2");
	server.keys = [EC.jwk, rotated.jwk];
	clock += JWKS_MIN_REFETCH_MS + 1;
	assertEquals(
		(await verifier.verify(await es256({ ...SESSION, exp: seconds(3600) }, rotated))).status,
		"valid",
	);
	assertEquals(server.fetches, 2);

	for (const kid of ["made-up-1", "made-up-2", "made-up-3"]) {
		const stranger = await ecKey(kid);
		assertEquals(
			reason(await verifier.verify(await es256({ ...SESSION, exp: seconds(3600) }, stranger))),
			"unknown_key",
		);
	}
	assertEquals(server.fetches, 2);
});

Deno.test("access-token: no keys ever obtained is an outage, not a verdict", async () => {
	const { server, fetchJwks } = jwksServer([EC.jwk]);
	server.down = true;
	const verifier = createAccessTokenVerifier({ jwksUrl: JWKS_URL, fetchJwks });
	assertEquals(
		(await verifier.verify(await es256({ ...SESSION, exp: seconds(3600) }))).status,
		"unavailable",
	);
});

Deno.test("access-token: a failed refetch keeps serving the keys already held", async () => {
	let clock = 1_000_000;
	const { server, fetchJwks } = jwksServer([EC.jwk]);
	const verifier = createAccessTokenVerifier({ jwksUrl: JWKS_URL, fetchJwks, now: () => clock });
	const token = await es256({ ...SESSION, exp: seconds(3600) });
	assertEquals((await verifier.verify(token)).status, "valid");
	server.down = true;
	clock += JWKS_TTL_MS + 1;
	assertEquals((await verifier.verify(token)).status, "valid");
	assertEquals(server.fetches, 2);
});

Deno.test("access-token: asymmetric tokens without a project URL are refused as unconfigured", async () => {
	const verifier = createAccessTokenVerifier({ hsSecret: SECRET });
	assertEquals(
		reason(await verifier.verify(await es256({ ...SESSION, exp: seconds(3600) }))),
		"unconfigured",
	);
	assertEquals(jwksUrlFor("https://project.example.test/"), JWKS_URL);
});
// #endregion
