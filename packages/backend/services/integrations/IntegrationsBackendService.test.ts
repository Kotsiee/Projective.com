/**
 * The connector runtime through a faked `fetch` that answers as PostgREST and as each provider: the
 * consent handshake, refresh with rotation, `invalid_grant`, revocation, channel renewal and the one
 * webhook. What the definers do with these calls is `supabase/probes/integrations_runtime.sql`.
 */
import { assert, assertEquals, assertFalse, assertMatch, assertStringIncludes } from "@std/assert";
import type {
	ConnectionSecretRow,
	ProviderKind,
	SealedSecret,
} from "@projective/types/integrations";
import type { ReadActor } from "../read-actor.ts";
import { hmacSha256Hex } from "../sessions/presence/adapter.ts";
import { IntegrationsBackendService as Service } from "./IntegrationsBackendService.ts";
import { seal, unseal } from "./token-vault.ts";

// #region Kit
const ADA: ReadActor = {
	userId: "950d68d1-8777-4bbe-ae59-3343e3e7f858",
	contextId: "",
	contextType: "personal",
	accessToken: "ada-jwt",
} as ReadActor;
const MALLORY: ReadActor = { ...ADA, userId: "b1000000-0000-4000-8000-000000000001" };
const CONNECTION = "c0a8012e-0000-4000-8000-000000000001";
const ZOOM_SECRET = "zoom-webhook-secret";
const CALLBACK = "https://app.example.test/api/integrations/callback";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
const FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned.readonly";
const MEET_CREATE_SCOPE = "https://www.googleapis.com/auth/meetings.space.created";
const MEET_READ_SCOPE = "https://www.googleapis.com/auth/meetings.space.readonly";
const GOOGLE_SCOPES = [
	"openid",
	"email",
	FREEBUSY_SCOPE,
	CALENDAR_SCOPE,
	MEET_CREATE_SCOPE,
	MEET_READ_SCOPE,
];

const AUTH_CONFIG: Record<string, unknown> = {
	google: {
		authorize_url: "https://accounts.google.com/o/oauth2/v2/auth",
		token_url: "https://oauth2.googleapis.com/token",
		revoke_url: "https://oauth2.googleapis.com/revoke",
		pkce: true,
		authorize_params: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
		identity_url: "https://openidconnect.googleapis.com/v1/userinfo",
		identity_id_field: "sub",
		identity_label_fields: ["email"],
		kind_scopes: {
			freebusy: [FREEBUSY_SCOPE],
			calendar: [CALENDAR_SCOPE],
			conferencing: [MEET_CREATE_SCOPE, MEET_READ_SCOPE],
		},
	},
	outlook: {
		authorize_url: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
		token_url: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
		pkce: true,
		identity_url: "https://graph.microsoft.com/v1.0/me",
		identity_id_field: "id",
		identity_label_fields: ["mail", "userPrincipalName"],
	},
	zoom: {
		authorize_url: "https://zoom.us/oauth/authorize",
		token_url: "https://zoom.us/oauth/token",
		revoke_url: "https://zoom.us/oauth/revoke",
		pkce: true,
		token_auth: "basic",
		identity_url: "https://api.zoom.us/v2/users/me",
		identity_id_field: "id",
		identity_label_fields: ["email"],
	},
};

function providerRow(slug: string, overrides: Record<string, unknown> = {}) {
	return {
		slug,
		label: slug.toUpperCase(),
		category: "calendar",
		capabilities: ["calendar", "freebusy", "conferencing"],
		auth_scheme: "oauth2",
		is_enabled: true,
		is_beta: false,
		broker: "direct",
		supports_webhooks: true,
		default_scopes: slug === "google" ? GOOGLE_SCOPES : ["offline_access"],
		docs_url: null,
		icon_url: null,
		sort_order: 100,
		created_at: "2026-10-01T00:00:00.000Z",
		auth_config: AUTH_CONFIG[slug] ?? {},
		...overrides,
	};
}

interface Call {
	host: string;
	/** `<schema>.<table>`, `<schema>.rpc.<function>`, or a provider's path. */
	name: string;
	method: string;
	url: URL;
	headers: Headers;
	text: string;
	// deno-lint-ignore no-explicit-any
	json: any;
}

class DbError {
	constructor(readonly message: string) {}
}

type DbRoute = (call: Call) => unknown;
type ProviderRoute = (call: Call) => Response;

const ENV: Record<string, string | undefined> = {
	USE_MOCKS: undefined,
	VITE_USE_MOCKS: undefined,
	INTEGRATIONS_BACKEND_LIVE: "true",
	SUPABASE_URL: "http://postgrest.fake",
	SUPABASE_ANON_KEY: "XXXX-XXXX",
	SUPABASE_SERVICE_ROLE_KEY: "XXXX-XXXX",
	ENCRYPTION_KEY: "ab".repeat(32),
	APP_URL: "https://app.example.test",
	GOOGLE_INTEGRATION_CLIENT_ID: "google-client",
	GOOGLE_INTEGRATION_CLIENT_SECRET: "google-secret",
	MICROSOFT_INTEGRATION_CLIENT_ID: "ms-client",
	MICROSOFT_INTEGRATION_CLIENT_SECRET: "ms-secret",
	MICROSOFT_INTEGRATION_TENANT: undefined,
	ZOOM_CLIENT_ID: "zoom-client",
	ZOOM_CLIENT_SECRET: "zoom-secret",
	ZOOM_WEBHOOK_SECRET: ZOOM_SECRET,
};

const json = (payload: unknown, status = 200) =>
	new Response(JSON.stringify(payload), {
		status,
		headers: { "content-type": "application/json" },
	});

/** Run `body` against a fake network; every call it made comes back in `calls`, in order. */
async function world(
	routes: { db?: Record<string, DbRoute>; provider?: ProviderRoute; env?: typeof ENV },
	body: (calls: Call[]) => Promise<void>,
) {
	const calls: Call[] = [];
	const env = { ...ENV, ...routes.env };
	const saved = Object.keys(env).map((name) => [name, Deno.env.get(name)] as const);
	const apply = (name: string, value: string | undefined) =>
		value === undefined ? Deno.env.delete(name) : Deno.env.set(name, value);
	for (const [name, value] of Object.entries(env)) apply(name, value);

	const realFetch = globalThis.fetch;
	globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		const text = await request.text();
		const isDb = url.host === "postgrest.fake";
		const path = url.pathname.replace(/^\/rest\/v1\//, "");
		const schema = request.headers.get("accept-profile") ?? request.headers.get("content-profile");
		const name = isDb ? `${schema}.${path.replace("/", ".")}` : url.pathname;
		const parsed = text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : null;
		const call: Call = {
			host: url.host,
			name,
			method: request.method,
			url,
			headers: request.headers,
			text,
			json: parsed,
		};
		calls.push(call);
		if (!isDb) return (routes.provider ?? (() => json({ error: "unrouted" }, 500)))(call);

		const route = routes.db?.[name];
		if (!route) throw new Error(`unrouted database call: ${request.method} ${name}`);
		const answer = route(call);
		if (answer instanceof DbError) return json({ message: answer.message, code: "XX000" }, 500);
		if ((request.headers.get("accept") ?? "").includes("vnd.pgrst.object")) {
			const rows = Array.isArray(answer) ? answer : [answer];
			if (rows.length !== 1) {
				return json({
					code: "PGRST116",
					message: "JSON object requested, multiple (or no) rows returned",
					details: `The result contains ${rows.length} rows`,
					hint: null,
				}, 406);
			}
			return json(rows[0]);
		}
		return json(answer);
	};

	try {
		await body(calls);
	} finally {
		globalThis.fetch = realFetch;
		for (const [name, value] of saved) apply(name, value);
	}
}

const named = (calls: Call[], name: string) => calls.filter((c) => c.name === name);
const providers = (slug: string): DbRoute => () => [providerRow(slug)];

async function s256(verifier: string) {
	const digest = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
	);
	return btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_")
		.replace(/=+$/, "");
}

function consentRow(overrides: Record<string, unknown> = {}) {
	return {
		user_id: ADA.userId,
		provider_slug: "google",
		code_verifier: "the-verifier",
		requested_kinds: ["calendar", "freebusy", "conferencing"] satisfies ProviderKind[],
		return_to: "/calendar",
		...overrides,
	};
}

/** A provider answering the code exchange and the identity read. */
function googleAnswers(tokenBody: Record<string, unknown> = {}): ProviderRoute {
	return (call) => {
		if (call.url.pathname === "/token") {
			return json({
				access_token: "access-1",
				refresh_token: "refresh-1",
				expires_in: 3600,
				scope: GOOGLE_SCOPES.join(" "),
				...tokenBody,
			});
		}
		if (call.url.pathname === "/v1/userinfo") {
			return json({ sub: "g-123", email: "ada@example.com" });
		}
		return json({});
	};
}

/** The connection row `v_my_connections` projects. */
function connectionRow(providerSlug: string) {
	return {
		id: CONNECTION,
		user_id: ADA.userId,
		provider_slug: providerSlug,
		provider_label: providerSlug,
		provider_category: "calendar",
		provider_capabilities: ["calendar"],
		status: "active",
		granted_kinds: ["calendar"],
		granted_scopes: [],
		sync_direction: "inbound",
		external_account_id: "g-123",
		external_account_label: null,
		config: null,
		token_expires_at: null,
		last_synced_at: null,
		last_error: null,
		error_count: 0,
		connected_at: null,
		revoked_at: null,
		created_at: "2026-10-01T00:00:00.000Z",
		updated_at: "2026-10-01T00:00:00.000Z",
	};
}

async function secretRow(tokens: Parameters<typeof seal>[1]): Promise<ConnectionSecretRow> {
	return {
		...await seal(CONNECTION, tokens),
		connection_id: CONNECTION,
		token_type: "bearer",
		access_token_expires_at: null,
		refresh_token_expires_at: "2027-01-01T00:00:00.000Z",
		encryption_alg: "aes-256-gcm",
		rotated_at: null,
		created_at: "2026-10-01T00:00:00.000Z",
		updated_at: "2026-10-01T00:00:00.000Z",
	};
}
// #endregion

// #region Starting a consent
Deno.test("start: the consent is opened under the caller's JWT, with PKCE and only the asked-for scopes", () =>
	world({
		db: {
			"integrations.providers": providers("google"),
			"integrations.rpc.fn_open_consent": () => "2026-11-04T12:10:00.000Z",
		},
	}, async (calls) => {
		const res = await Service.startConnection(
			{ providerSlug: "google", kinds: ["freebusy"], returnTo: "/calendar?view=week" },
			ADA,
		);
		assert(res.ok, res.message);
		const [open] = named(calls, "integrations.rpc.fn_open_consent");
		assertEquals(open.headers.get("authorization"), "Bearer ada-jwt");
		assertEquals(open.json.p_provider_slug, "google");
		assertEquals(open.json.p_requested_kinds, ["freebusy"]);
		assertEquals(open.json.p_return_to, "/calendar?view=week");
		assertEquals(open.json.p_state.length, 43);

		const url = new URL(res.data!.authorizeUrl);
		const q = url.searchParams;
		assertEquals(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
		assertEquals(q.get("client_id"), "google-client");
		assertEquals(q.get("redirect_uri"), CALLBACK);
		assertEquals(q.get("state"), open.json.p_state);
		assertEquals(q.get("response_type"), "code");
		assertEquals(q.get("code_challenge_method"), "S256");
		assertEquals(q.get("code_challenge"), await s256(open.json.p_code_verifier));
		assertEquals(q.get("scope"), `openid email ${FREEBUSY_SCOPE}`);
		assertEquals(q.get("access_type"), "offline");
		assertEquals(q.get("prompt"), "consent");
		assertEquals(q.get("include_granted_scopes"), "true");
		assertEquals(res.data!.expiresAt, "2026-11-04T12:10:00.000Z");
	}));

Deno.test("start: Zoom's consent names no scopes, because Zoom refuses them in the URL", () =>
	world({
		db: {
			"integrations.providers": () => [
				providerRow("zoom", { auth_config: { ...AUTH_CONFIG.zoom as object, send_scopes: false } }),
			],
			"integrations.rpc.fn_open_consent": () => "2026-11-04T12:10:00.000Z",
		},
	}, async () => {
		const res = await Service.startConnection({ providerSlug: "zoom" }, ADA);
		assertEquals(new URL(res.data!.authorizeUrl).searchParams.has("scope"), false);
	}));

Deno.test("connections: a provider is offered only where it can really be connected", () =>
	world({
		env: { ZOOM_CLIENT_ID: undefined, GOOGLE_INTEGRATION_CLIENT_SECRET: "XXXX-XXXX" },
		db: {
			"integrations.providers": () => [
				providerRow("zoom"),
				providerRow("google"),
				providerRow("outlook"),
				providerRow("dropbox", { auth_config: {} }),
				providerRow("s3", { auth_scheme: "aws_sigv4" }),
				providerRow("apple", { auth_scheme: "app_password", is_enabled: false }),
			],
			"integrations.v_my_connections": () => [],
		},
	}, async () => {
		const res = await Service.connections(ADA);
		assertEquals(
			res.data!.providers.filter((p) => p.isEnabled).map((p) => p.slug),
			["outlook", "s3"],
		);
	}));

Deno.test("connections: with the gate off nothing can be started, so no OAuth provider is offered", () =>
	world({
		env: { INTEGRATIONS_BACKEND_LIVE: "false" },
		db: {
			"integrations.providers": () => [providerRow("zoom")],
			"integrations.v_my_connections": () => [],
		},
	}, async () => {
		assertEquals((await Service.connections(ADA)).data?.providers[0].isEnabled, false);
	}));

Deno.test("start: Microsoft's {tenant} is filled from the env, common by default", () =>
	world({
		db: {
			"integrations.providers": providers("outlook"),
			"integrations.rpc.fn_open_consent": () => "2026-11-04T12:10:00.000Z",
		},
	}, async () => {
		const res = await Service.startConnection({ providerSlug: "outlook" }, ADA);
		assertMatch(res.data!.authorizeUrl, /^https:\/\/login\.microsoftonline\.com\/common\/oauth2/);
	}));

Deno.test("start: refused in words, and nothing is written", async () => {
	const refusal = (
		input: Parameters<typeof Service.startConnection>[0],
		row: Record<string, unknown> | null,
		env: typeof ENV = {},
	) =>
		world({
			env,
			db: { "integrations.providers": () => (row ? [row] : []) },
		}, async (calls) => {
			const res = await Service.startConnection(input, ADA);
			assertFalse(res.ok);
			assertEquals(named(calls, "integrations.rpc.fn_open_consent").length, 0);
			refused.push(res.status);
		});
	const refused: number[] = [];
	const google = providerRow("google");
	await refusal({ providerSlug: "nope" }, null);
	await refusal({ providerSlug: "google" }, providerRow("google", { is_enabled: false }));
	await refusal({ providerSlug: "s3" }, providerRow("s3", { auth_scheme: "aws_sigv4" }));
	await refusal({ providerSlug: "google" }, google, { INTEGRATIONS_BACKEND_LIVE: "false" });
	await refusal({ providerSlug: "google" }, google, { GOOGLE_INTEGRATION_CLIENT_ID: "XXXX-XXXX" });
	await refusal({ providerSlug: "calendly" }, providerRow("calendly"));
	await refusal({ providerSlug: "google", kinds: ["storage"] }, google);
	assertEquals(refused, [404, 409, 422, 503, 503, 503, 422]);
	refused.length = 0;
	for (const returnTo of ["https://evil.example", "//evil.example", "/\\evil.example", "/a\nb"]) {
		await refusal({ providerSlug: "google", returnTo }, google);
	}
	assertEquals(refused, [422, 422, 422, 422]);
});
// #endregion

// #region Completing a consent
Deno.test("callback: the state is spent, the code exchanged, and the tokens reach the definer sealed", () =>
	world({
		provider: googleAnswers(),
		db: {
			"integrations.consent_states": () => [consentRow()],
			"integrations.providers": providers("google"),
			"integrations.rpc.fn_store_connection": (call) => call.json.p_connection_id,
		},
	}, async (calls) => {
		const res = await Service.completeConnection({ state: "s".repeat(43), code: "the-code" }, ADA);
		assert(res.ok, res.message);
		assertEquals(res.data!.returnTo, "/calendar");

		const names = calls.map((c) => c.name);
		assert(
			names.indexOf("/token") < names.indexOf("integrations.rpc.fn_store_connection"),
			"the exchange happens before any connection write",
		);
		const [consume] = named(calls, "integrations.consent_states");
		assertEquals(consume.method, "PATCH");
		assertEquals(consume.url.searchParams.get("consumed_at"), "is.null");
		assertMatch(consume.url.searchParams.get("expires_at")!, /^gt\./);

		const form = new URLSearchParams(named(calls, "/token")[0].text);
		assertEquals(form.get("grant_type"), "authorization_code");
		assertEquals(form.get("code"), "the-code");
		assertEquals(form.get("code_verifier"), "the-verifier");
		assertEquals(form.get("redirect_uri"), CALLBACK);
		assertEquals(form.get("client_secret"), "google-secret");

		const [store] = named(calls, "integrations.rpc.fn_store_connection");
		assertEquals(store.json.p_user_id, ADA.userId);
		assertEquals(store.json.p_external_account_id, "g-123");
		assertEquals(store.json.p_external_account_label, "ada@example.com");
		assertEquals(store.json.p_granted_kinds, ["calendar", "freebusy", "conferencing"]);
		assertFalse(store.text.includes("access-1"), "no plaintext access token leaves the service");
		assertFalse(store.text.includes("refresh-1"), "no plaintext refresh token leaves the service");
		const secret = store.json.p_secret as SealedSecret;
		assertEquals(await unseal(store.json.p_connection_id, secret, "access_token"), "access-1");
		assertEquals(await unseal(store.json.p_connection_id, secret, "refresh_token"), "refresh-1");
	}));

Deno.test("callback: an already-linked account is re-sealed under its existing connection id", () =>
	world({
		provider: googleAnswers(),
		db: {
			"integrations.consent_states": () => [consentRow()],
			"integrations.providers": providers("google"),
			"integrations.rpc.fn_store_connection": () => CONNECTION,
		},
	}, async (calls) => {
		const res = await Service.completeConnection({ state: "s".repeat(43), code: "the-code" }, ADA);
		assertEquals(res.data!.connectionId, CONNECTION);
		const stores = named(calls, "integrations.rpc.fn_store_connection");
		assertEquals(stores.length, 2);
		assertEquals(stores[1].json.p_connection_id, CONNECTION);
		assertEquals(await unseal(CONNECTION, stores[1].json.p_secret, "access_token"), "access-1");
	}));

Deno.test("callback: a spent, unknown or expired state is refused before any provider call", () =>
	world({
		db: { "integrations.consent_states": () => [] },
	}, async (calls) => {
		const res = await Service.completeConnection({ state: "s".repeat(43), code: "the-code" }, ADA);
		assertEquals(res.status, 400);
		assertEquals(res.details?.returnTo, null);
		assertEquals(named(calls, "/token").length, 0);
	}));

Deno.test("callback: a browser signed in as someone else cannot finish another person's consent", () =>
	world({
		provider: googleAnswers(),
		db: { "integrations.consent_states": () => [consentRow()] },
	}, async (calls) => {
		const res = await Service.completeConnection(
			{ state: "s".repeat(43), code: "the-code" },
			MALLORY,
		);
		assertEquals(res.status, 400);
		assertEquals(named(calls, "/token").length, 0);
	}));

Deno.test("callback: a declined consent spends the state and still returns where it started", () =>
	world({
		db: { "integrations.consent_states": () => [consentRow()] },
	}, async (calls) => {
		const res = await Service.completeConnection({ state: "s".repeat(43), code: null }, ADA);
		assertFalse(res.ok);
		assertEquals(res.details?.returnTo, "/calendar");
		assertEquals(named(calls, "integrations.consent_states").length, 1);
		assertEquals(named(calls, "/token").length, 0);
	}));

Deno.test("callback: when the store fails, the fresh grant is revoked at the provider", () =>
	world({
		provider: googleAnswers(),
		db: {
			"integrations.consent_states": () => [consentRow()],
			"integrations.providers": providers("google"),
			"integrations.rpc.fn_store_connection": () => new DbError("connection reset"),
		},
	}, async (calls) => {
		const res = await Service.completeConnection({ state: "s".repeat(43), code: "the-code" }, ADA);
		assertEquals(res.status, 400);
		assertEquals(res.details?.returnTo, "/calendar");
		const [revoke] = named(calls, "/revoke");
		assertEquals(revoke.url.searchParams.get("token"), "refresh-1");
	}));

Deno.test("callback: an unticked scope records a narrowed consent", () =>
	world({
		provider: googleAnswers({
			scope: `openid ${FREEBUSY_SCOPE} ${CALENDAR_SCOPE} ${MEET_CREATE_SCOPE}`,
		}),
		db: {
			"integrations.consent_states": () => [consentRow()],
			"integrations.providers": providers("google"),
			"integrations.rpc.fn_store_connection": (call) => call.json.p_connection_id,
		},
	}, async (calls) => {
		assert((await Service.completeConnection({ state: "s".repeat(43), code: "c" }, ADA)).ok);
		const [store] = named(calls, "integrations.rpc.fn_store_connection");
		assertEquals(store.json.p_granted_kinds, ["calendar", "freebusy"]);
		assertEquals(store.json.p_granted_scopes.length, 4);
	}));

Deno.test("callback: a grant covering nothing that was asked for is revoked, not stored", () =>
	world({
		provider: googleAnswers({ scope: "openid email" }),
		db: {
			"integrations.consent_states": () => [consentRow()],
			"integrations.providers": providers("google"),
		},
	}, async (calls) => {
		assertFalse((await Service.completeConnection({ state: "s".repeat(43), code: "c" }, ADA)).ok);
		assertEquals(named(calls, "integrations.rpc.fn_store_connection").length, 0);
		assertEquals(named(calls, "/revoke").length, 1);
	}));

Deno.test("callback: Zoom authenticates at the token endpoint with HTTP Basic, not the form", () =>
	world({
		provider: (call) =>
			call.url.pathname === "/oauth/token"
				? json({ access_token: "a", refresh_token: "r", expires_in: 3600 })
				: json({ id: "zoom-user", email: "ada@example.com" }),
		db: {
			"integrations.consent_states": () => [consentRow({ provider_slug: "zoom" })],
			"integrations.providers": providers("zoom"),
			"integrations.rpc.fn_store_connection": (call) => call.json.p_connection_id,
		},
	}, async (calls) => {
		const res = await Service.completeConnection({ state: "s".repeat(43), code: "c" }, ADA);
		assert(res.ok, res.message);
		const [token] = named(calls, "/oauth/token");
		assertEquals(token.headers.get("authorization"), `Basic ${btoa("zoom-client:zoom-secret")}`);
		assertFalse(token.text.includes("zoom-secret"));
		assertEquals(
			named(calls, "integrations.rpc.fn_store_connection")[0].json.p_external_account_id,
			"zoom-user",
		);
	}));
// #endregion

// #region Refresh
Deno.test("refresh: a rotated token lands in one commit, conditional on the token it replaced", () =>
	world({}, async () => {
		const secret = await secretRow({ access_token: "old-access", refresh_token: "old-refresh" });
		await world({
			provider: () =>
				json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }),
			db: {
				"integrations.rpc.fn_claim_connections_for_refresh": () => [
					{ provider_slug: "zoom", auth_config: AUTH_CONFIG.zoom, secret },
				],
				"integrations.rpc.fn_commit_refresh": () => true,
			},
		}, async (calls) => {
			const res = await Service.refreshDue(50);
			assertEquals(res.data, { claimed: 1, done: 1, expired: 0, failed: 0 });
			assertEquals(
				named(calls, "integrations.rpc.fn_claim_connections_for_refresh")[0].json.p_limit,
				50,
			);
			const form = new URLSearchParams(named(calls, "/oauth/token")[0].text);
			assertEquals(form.get("grant_type"), "refresh_token");
			assertEquals(form.get("refresh_token"), "old-refresh");

			const [commit] = named(calls, "integrations.rpc.fn_commit_refresh");
			assertEquals(commit.json.p_read_cipher, secret.refresh_token_cipher);
			const sealed = commit.json.p_secret as SealedSecret;
			assertEquals(await unseal(CONNECTION, sealed, "refresh_token"), "new-refresh");
			assertEquals(await unseal(CONNECTION, sealed, "access_token"), "new-access");
			assert(Date.parse(commit.json.p_access_expires_at) > Date.now());
		});
	}));

Deno.test("refresh: a provider that does not rotate keeps the refresh token and its expiry", () =>
	world({}, async () => {
		const secret = await secretRow({ access_token: "old-access", refresh_token: "old-refresh" });
		await world({
			provider: () => json({ access_token: "new-access", expires_in: 3600 }),
			db: {
				"integrations.rpc.fn_claim_connections_for_refresh": () => [
					{ provider_slug: "google", auth_config: AUTH_CONFIG.google, secret },
				],
				"integrations.rpc.fn_commit_refresh": () => true,
			},
		}, async (calls) => {
			await Service.refreshDue();
			const [commit] = named(calls, "integrations.rpc.fn_commit_refresh");
			assertEquals(await unseal(CONNECTION, commit.json.p_secret, "refresh_token"), "old-refresh");
			assertEquals(commit.json.p_refresh_expires_at, secret.refresh_token_expires_at);
		});
	}));

Deno.test("refresh: invalid_grant is recorded as terminal and nothing is committed", () =>
	world({}, async () => {
		const secret = await secretRow({ access_token: "a", refresh_token: "dead" });
		await world({
			provider: () => json({ error: "invalid_grant" }, 400),
			db: {
				"integrations.rpc.fn_claim_connections_for_refresh": () => [
					{ provider_slug: "google", auth_config: AUTH_CONFIG.google, secret },
				],
				"integrations.rpc.fn_record_refresh_failure": () => "expired",
			},
		}, async (calls) => {
			const res = await Service.refreshDue();
			assertEquals(res.data, { claimed: 1, done: 0, expired: 1, failed: 0 });
			const [failure] = named(calls, "integrations.rpc.fn_record_refresh_failure");
			assertEquals(failure.json.p_invalid_grant, true);
			assertEquals(failure.json.p_read_cipher, secret.refresh_token_cipher);
			assertStringIncludes(failure.json.p_detail, "invalid_grant");
			assertFalse(failure.text.includes("dead"));
		});
	}));

Deno.test("refresh: a transient failure is not terminal, and one bad row never stops the rest", () =>
	world({}, async () => {
		const secret = await secretRow({ access_token: "a", refresh_token: "r" });
		const claim = { provider_slug: "google", auth_config: AUTH_CONFIG.google, secret };
		let attempts = 0;
		await world({
			provider: () =>
				attempts++ === 0 ? json({}, 503) : json({ access_token: "new", expires_in: 3600 }),
			db: {
				"integrations.rpc.fn_claim_connections_for_refresh": () => [claim, claim],
				"integrations.rpc.fn_commit_refresh": () => true,
				"integrations.rpc.fn_record_refresh_failure": () => "active",
			},
		}, async (calls) => {
			const res = await Service.refreshDue();
			assertEquals(res.data, { claimed: 2, done: 1, expired: 0, failed: 1 });
			assertEquals(
				named(calls, "integrations.rpc.fn_record_refresh_failure")[0].json.p_invalid_grant,
				false,
			);
		});
	}));

Deno.test("refresh: a row sealed under another key fails on its row, without calling the provider", () =>
	world({}, async () => {
		const secret = await secretRow({ access_token: "a", refresh_token: "r" });
		await world({
			env: { ENCRYPTION_KEY: "cd".repeat(32) },
			db: {
				"integrations.rpc.fn_claim_connections_for_refresh": () => [
					{ provider_slug: "google", auth_config: AUTH_CONFIG.google, secret },
				],
				"integrations.rpc.fn_record_refresh_failure": () => "active",
			},
		}, async (calls) => {
			const res = await Service.refreshDue();
			assertEquals(res.data, { claimed: 1, done: 0, expired: 0, failed: 1 });
			assertEquals(calls.filter((c) => c.host !== "postgrest.fake").length, 0);
		});
	}));

Deno.test("refresh: refused while the integrations gate is off", () =>
	world({ env: { INTEGRATIONS_BACKEND_LIVE: "false" } }, async (calls) => {
		assertEquals((await Service.refreshDue()).status, 503);
		assertEquals((await Service.renewChannels()).status, 503);
		assertEquals(calls.length, 0);
	}));
// #endregion

// #region Channels
Deno.test("channels: a Graph subscription is extended in place and Graph's expiry is stored", () =>
	world({}, async () => {
		const secret = await secretRow({ access_token: "the-access" });
		const channel = {
			id: "d0000000-0000-4000-8000-000000000001",
			connection_id: CONNECTION,
			provider_slug: "outlook",
			resource: "calendar:primary",
			external_channel_id: "graph-sub",
			external_resource_id: null,
			verification_token: "state",
			callback_url: "https://app.example.test/api/integrations/webhooks/outlook",
		};
		await world({
			provider: () => json({ expirationDateTime: "2026-11-07T00:00:00Z" }),
			db: {
				"integrations.rpc.fn_claim_channels_for_renewal": () => [{ channel, secret }],
				"integrations.rpc.fn_record_channel_renewal": () => true,
			},
		}, async (calls) => {
			const res = await Service.renewChannels();
			assertEquals(res.data, { claimed: 1, done: 1, expired: 0, failed: 0 });
			const [patch] = named(calls, "/v1.0/subscriptions/graph-sub");
			assertEquals(patch.method, "PATCH");
			assertEquals(patch.headers.get("authorization"), "Bearer the-access");
			const [recorded] = named(calls, "integrations.rpc.fn_record_channel_renewal");
			assertEquals(recorded.json.p_renewed, true);
			assertEquals(recorded.json.p_expires_at, "2026-11-07T00:00:00.000Z");
			assertEquals(recorded.json.p_external_channel_id, "graph-sub");
		});
	}));

Deno.test("channels: a Google channel is replaced and the old one stopped", () =>
	world({}, async () => {
		const secret = await secretRow({ access_token: "the-access" });
		const channel = {
			id: "d0000000-0000-4000-8000-000000000002",
			connection_id: CONNECTION,
			provider_slug: "google",
			resource: "calendar:primary",
			external_channel_id: "old-channel",
			external_resource_id: "old-resource",
			verification_token: "the-token",
			callback_url: "https://app.example.test/api/integrations/webhooks/google",
		};
		await world({
			provider: (call) =>
				call.url.pathname.endsWith("/watch")
					? json({ id: "new-channel", resourceId: "new-resource", expiration: "1893456000000" })
					: json({}),
			db: {
				"integrations.rpc.fn_claim_channels_for_renewal": () => [{ channel, secret }],
				"integrations.rpc.fn_record_channel_renewal": () => true,
			},
		}, async (calls) => {
			assertEquals((await Service.renewChannels()).data?.done, 1);
			const [watch] = named(calls, "/calendar/v3/calendars/primary/events/watch");
			assertEquals(watch.json.token, "the-token");
			assertEquals(watch.json.address, channel.callback_url);
			assertEquals(named(calls, "/calendar/v3/channels/stop")[0].json.id, "old-channel");
			const [recorded] = named(calls, "integrations.rpc.fn_record_channel_renewal");
			assertEquals(recorded.json.p_external_channel_id, "new-channel");
			assertEquals(recorded.json.p_external_resource_id, "new-resource");
		});
	}));

Deno.test("channels: a subscription Graph dropped is opened again on the same row", () =>
	world({}, async () => {
		const secret = await secretRow({ access_token: "the-access" });
		const channel = {
			id: "d0000000-0000-4000-8000-000000000004",
			connection_id: CONNECTION,
			provider_slug: "outlook",
			resource: "calendar:primary",
			external_channel_id: "gone-sub",
			external_resource_id: null,
			verification_token: "state",
			callback_url: "https://app.example.test/api/integrations/webhooks/outlook",
		};
		await world({
			provider: (call) =>
				call.method === "PATCH"
					? json({}, 404)
					: json({ id: "new-sub", expirationDateTime: "2026-11-07T00:00:00Z" }),
			db: {
				"integrations.rpc.fn_claim_channels_for_renewal": () => [{ channel, secret }],
				"integrations.rpc.fn_record_channel_renewal": () => true,
			},
		}, async (calls) => {
			assertEquals((await Service.renewChannels()).data?.done, 1);
			assertEquals(named(calls, "/v1.0/subscriptions")[0].json.clientState, "state");
			assertEquals(
				named(calls, "integrations.rpc.fn_record_channel_renewal")[0].json.p_external_channel_id,
				"new-sub",
			);
		});
	}));

Deno.test("channels: a refused renewal is counted on its row", () =>
	world({}, async () => {
		const secret = await secretRow({ access_token: "the-access" });
		const channel = {
			id: "d0000000-0000-4000-8000-000000000003",
			connection_id: CONNECTION,
			provider_slug: "outlook",
			resource: "calendar:primary",
			external_channel_id: "graph-sub",
			external_resource_id: null,
			verification_token: "state",
			callback_url: null,
		};
		await world({
			provider: () => json({}, 403),
			db: {
				"integrations.rpc.fn_claim_channels_for_renewal": () => [{ channel, secret }],
				"integrations.rpc.fn_record_channel_renewal": () => false,
			},
		}, async (calls) => {
			assertEquals((await Service.renewChannels()).data?.failed, 1);
			assertEquals(
				named(calls, "integrations.rpc.fn_record_channel_renewal")[0].json.p_renewed,
				false,
			);
		});
	}));
// #endregion

// #region Revocation
Deno.test("revoke: the definer closes the connection first, then the provider is told", () =>
	world({}, async () => {
		const secret = await secretRow({ access_token: "the-access", refresh_token: "the-refresh" });
		await world({
			provider: () => json({}),
			db: {
				"integrations.v_my_connections": () => [connectionRow("google")],
				"integrations.providers": providers("google"),
				"integrations.connection_secrets": () => [secret],
				"integrations.rpc.fn_revoke_connection": () => true,
			},
		}, async (calls) => {
			const res = await Service.revokeConnection({ connectionId: CONNECTION }, ADA);
			assertEquals(res.data, { revoked: true });
			const names = calls.map((c) => c.name);
			assert(names.indexOf("integrations.rpc.fn_revoke_connection") < names.indexOf("/revoke"));
			assertEquals(named(calls, "/revoke")[0].url.searchParams.get("token"), "the-refresh");
			assertEquals(
				named(calls, "integrations.rpc.fn_revoke_connection")[0].json.p_connection_id,
				CONNECTION,
			);
			assertFalse(calls.some((c) => c.method === "DELETE"), "only the definer removes the secret");
		});
	}));

Deno.test("revoke: push channels stop and the Projective calendar goes, after the door, before the grant", () =>
	world({}, async () => {
		const secret = await secretRow({ access_token: "the-access", refresh_token: "the-refresh" });
		const channel = {
			provider_slug: "google",
			external_channel_id: "channel-1",
			external_resource_id: "resource-1",
		};
		await world({
			provider: () => json({}),
			db: {
				"integrations.v_my_connections": () => [
					{ ...connectionRow("google"), config: { outbound_calendar_id: "out-cal" } },
				],
				"integrations.providers": providers("google"),
				"integrations.connection_secrets": () => [secret],
				"integrations.webhook_subscriptions": () => [channel],
				"integrations.rpc.fn_claim_connection_token": () => ({
					provider_slug: "google",
					auth_config: {},
					secret,
					refresh: false,
				}),
				"integrations.rpc.fn_revoke_connection": () => true,
			},
		}, async (calls) => {
			assert((await Service.revokeConnection({ connectionId: CONNECTION }, ADA)).ok);
			const names = calls.map((c) => c.name);
			const door = names.indexOf("integrations.rpc.fn_revoke_connection");
			const stop = names.indexOf("/calendar/v3/channels/stop");
			const calendar = names.indexOf("/calendar/v3/calendars/out-cal");
			const grant = names.indexOf("/revoke");
			assert(door >= 0 && door < stop && door < calendar, "the door goes first");
			assert(stop < grant && calendar < grant, "the grant has to outlive the calls that need it");
			assertEquals(named(calls, "/calendar/v3/channels/stop")[0].json, {
				id: "channel-1",
				resourceId: "resource-1",
			});
			assertEquals(named(calls, "/calendar/v3/calendars/out-cal")[0].method, "DELETE");
		});
	}));

Deno.test("revoke: a provider that will not close anything still leaves the connection closed", () =>
	world({}, async () => {
		const secret = await secretRow({ access_token: "the-access", refresh_token: "the-refresh" });
		await world({
			provider: () => json({}, 500),
			db: {
				"integrations.v_my_connections": () => [
					{ ...connectionRow("outlook"), config: { outbound_calendar_id: "out-cal" } },
				],
				"integrations.providers": providers("outlook"),
				"integrations.connection_secrets": () => [secret],
				"integrations.webhook_subscriptions": () => [
					{ provider_slug: "outlook", external_channel_id: "sub-1", external_resource_id: null },
				],
				"integrations.rpc.fn_claim_connection_token": () => ({
					provider_slug: "outlook",
					auth_config: {},
					secret,
					refresh: false,
				}),
				"integrations.rpc.fn_revoke_connection": () => true,
			},
		}, async (calls) => {
			assertEquals(
				(await Service.revokeConnection({ connectionId: CONNECTION }, ADA)).data,
				{ revoked: true },
			);
			assertEquals(named(calls, "/v1.0/subscriptions/sub-1")[0].method, "DELETE");
			assertEquals(named(calls, "/v1.0/me/calendars/out-cal")[0].method, "DELETE");
		});
	}));

Deno.test("revoke: a provider that refuses the first token gets the other, and a refusal changes nothing", () =>
	world({}, async () => {
		const secret = await secretRow({ access_token: "the-access", refresh_token: "the-refresh" });
		await world({
			provider: () => json({}, 400),
			db: {
				"integrations.v_my_connections": () => [connectionRow("zoom")],
				"integrations.providers": providers("zoom"),
				"integrations.connection_secrets": () => [secret],
				"integrations.rpc.fn_revoke_connection": () => true,
			},
		}, async (calls) => {
			const res = await Service.revokeConnection({ connectionId: CONNECTION }, ADA);
			assert(res.ok);
			const tried = named(calls, "/oauth/revoke");
			assertEquals(tried.map((c) => c.url.searchParams.get("token")), [
				"the-refresh",
				"the-access",
			]);
			assertEquals(
				tried[0].headers.get("authorization"),
				`Basic ${btoa("zoom-client:zoom-secret")}`,
			);
		});
	}));

Deno.test("revoke: Microsoft has no per-grant endpoint, so nothing is called", () =>
	world({}, async () => {
		const secret = await secretRow({ access_token: "a", refresh_token: "r" });
		await world({
			db: {
				"integrations.v_my_connections": () => [connectionRow("outlook")],
				"integrations.providers": providers("outlook"),
				"integrations.connection_secrets": () => [secret],
				"integrations.rpc.fn_revoke_connection": () => true,
			},
		}, async (calls) => {
			assert((await Service.revokeConnection({ connectionId: CONNECTION }, ADA)).ok);
			assertEquals(calls.filter((c) => c.host !== "postgrest.fake").length, 0);
		});
	}));

Deno.test("revoke: a row that will not open still closes the connection", () =>
	world({
		provider: () => json({}),
		db: {
			"integrations.v_my_connections": () => [connectionRow("google")],
			"integrations.providers": providers("google"),
			"integrations.connection_secrets": () => [],
			"integrations.rpc.fn_revoke_connection": () => true,
		},
	}, async (calls) => {
		assert((await Service.revokeConnection({ connectionId: CONNECTION }, ADA)).ok);
		assertEquals(named(calls, "/revoke").length, 0);
	}));

Deno.test("revoke: someone else's connection answers 404, and a closed one writes nothing", async () => {
	await world({
		db: { "integrations.v_my_connections": () => [] },
	}, async (calls) => {
		assertEquals((await Service.revokeConnection({ connectionId: CONNECTION }, ADA)).status, 404);
		assertEquals(named(calls, "integrations.rpc.fn_revoke_connection").length, 0);
	});
	await world({
		db: {
			"integrations.v_my_connections": () => [{ ...connectionRow("google"), status: "revoked" }],
		},
	}, async (calls) => {
		assertEquals((await Service.revokeConnection({ connectionId: CONNECTION }, ADA)).data, {
			revoked: false,
		});
		assertEquals(named(calls, "integrations.rpc.fn_revoke_connection").length, 0);
	});
});
// #endregion

// #region Webhooks
const NOW_MS = Date.parse("2026-11-04T12:00:00.000Z");
const NOW_S = Math.floor(NOW_MS / 1000);
const WEBHOOK_URL = new URL("https://app.example.test/api/integrations/webhooks/zoom");

async function zoomDelivery(body: unknown, secret = ZOOM_SECRET, timestamp = NOW_S) {
	const raw = JSON.stringify(body);
	return {
		raw,
		headers: new Headers({
			"x-zm-request-timestamp": String(timestamp),
			"x-zm-signature": `v0=${await hmacSha256Hex(secret, `v0:${timestamp}:${raw}`)}`,
		}),
	};
}

const JOINED = {
	event: "meeting.participant_joined",
	event_ts: 1762257600000,
	payload: {
		object: {
			id: "9999",
			uuid: "room-uuid",
			participant: {
				participant_uuid: "p-1",
				email: "ada@example.com",
				join_time: "2026-11-04T11:59:00Z",
			},
		},
	},
};

function zoomCall(delivery: { raw: string; headers: Headers }) {
	return Service.handleWebhook("zoom", delivery.raw, delivery.headers, WEBHOOK_URL, NOW_MS);
}

/** The delivery ledger as the definer keeps it: one row per id, the effect only on the first. */
function presenceDoor() {
	const claimed = new Set<string>();
	const effects: string[] = [];
	return {
		effects,
		route: ((call) => {
			if (claimed.has(call.json.p_event_key)) return { outcome: "replayed" };
			claimed.add(call.json.p_event_key);
			effects.push(call.json.p_event_key);
			return { outcome: "recorded" };
		}) as DbRoute,
	};
}

Deno.test("webhook: a bad signature is refused before anything touches the database", () =>
	world({}, async (calls) => {
		const forged = await zoomDelivery(JOINED, "not-the-secret");
		assertEquals((await zoomCall(forged)).status, 400);
		const stale = await zoomDelivery(JOINED, ZOOM_SECRET, NOW_S - 301);
		assertEquals((await zoomCall(stale)).status, 400);
		assertEquals(calls.length, 0, "no delivery row, no read");
	}));

Deno.test("webhook: the Zoom handshake is answered only on a signed delivery", () =>
	world({}, async (calls) => {
		const body = { event: "endpoint.url_validation", payload: { plainToken: "plain" } };
		const signed = await zoomCall(await zoomDelivery(body));
		assertEquals(signed.data?.challenge, {
			plainToken: "plain",
			encryptedToken: await hmacSha256Hex(ZOOM_SECRET, "plain"),
		});
		const forged = await zoomCall(await zoomDelivery(body, "not-the-secret"));
		assertEquals(forged.status, 400);
		assertEquals(forged.data, undefined);
		assertEquals(calls.length, 0);
	}));

Deno.test("webhook: a presence delivery records once, and a replay is a 2xx no-op", async () => {
	const door = presenceDoor();
	await world({
		db: { "integrations.rpc.fn_record_presence_delivery": door.route },
	}, async (calls) => {
		const delivery = await zoomDelivery(JOINED);
		const first = await zoomCall(delivery);
		const replay = await zoomCall(delivery);
		assertEquals(first.status, 200);
		assertEquals(first.data?.outcomes, ["recorded"]);
		assertEquals(replay.status, 200);
		assertEquals(replay.data?.outcomes, ["replayed"]);
		assertEquals(door.effects.length, 1);
		const [call] = named(calls, "integrations.rpc.fn_record_presence_delivery");
		assertEquals(call.json.p_provider, "zoom");
		assertEquals(call.json.p_meeting_id, "9999");
		assertEquals(call.json.p_action, "joined");
		assertEquals(call.json.p_email, "ada@example.com");
	});
});

Deno.test("webhook: a host is known by their Zoom account, a guest by their registration", async () => {
	const door = presenceDoor();
	const with_ = (participant: Record<string, unknown>, event = JOINED.event, event_ts = JOINED.event_ts) =>
		zoomDelivery({
			...JOINED,
			event,
			event_ts,
			payload: { object: { ...JOINED.payload.object, host_id: "zoom-host", participant } },
		});
	await world(
		{ db: { "integrations.rpc.fn_record_presence_delivery": door.route } },
		async (calls) => {
			await zoomCall(
				await with_({ id: "zoom-host", user_id: 1, join_time: "2026-11-04T11:59:00Z" }),
			);
			await zoomCall(
				await with_({
					registrant_id: "reg-1",
					participant_uuid: "p-2",
					join_time: "2026-11-04T12:00:00Z",
				}),
			);
			await zoomCall(
				await with_({ participant_uuid: "p-3" }, "meeting.participant_jbh_waiting", 1762257600001),
			);
			await zoomCall(
				await with_(
					{ participant_uuid: "p-4" },
					"meeting.participant_joined_waiting_room",
					1762257600002,
				),
			);
			const [host, guest, waiting, inWaitingRoom] = named(
				calls,
				"integrations.rpc.fn_record_presence_delivery",
			);
			assertEquals(host.json.p_account_id, "zoom-host");
			assertEquals(host.json.p_participant_key, "zoom-host");
			assertEquals(guest.json.p_account_id, null);
			assertEquals(guest.json.p_registrant_id, "reg-1");
			assertEquals(guest.json.p_participant_key, "reg-1");
			assertEquals(waiting.json.p_action, "waiting");
			assertEquals(inWaitingRoom.json.p_action, "waiting");
		},
	);
});

Deno.test("accessToken: a live token comes straight back", () =>
	world({}, async () => {
		const secret = await secretRow({ access_token: "live", refresh_token: "r" });
		await world({
			db: {
				"integrations.rpc.fn_claim_connection_token": () => ({
					provider_slug: "zoom",
					auth_config: AUTH_CONFIG.zoom,
					refresh: false,
					secret,
				}),
			},
		}, async () => {
			assertEquals(await Service.accessToken(CONNECTION), "live");
		});
	}));

Deno.test("accessToken: an expiring token is refreshed through the same commit as the job", () =>
	world({}, async () => {
		const secret = await secretRow({ access_token: "old", refresh_token: "r" });
		const fresh = await secretRow({ access_token: "new", refresh_token: "r2" });
		await world({
			provider: () => json({ access_token: "new", refresh_token: "r2", expires_in: 3600 }),
			db: {
				"integrations.rpc.fn_claim_connection_token": () => ({
					provider_slug: "zoom",
					auth_config: AUTH_CONFIG.zoom,
					refresh: true,
					secret,
				}),
				"integrations.rpc.fn_commit_refresh": () => true,
				"integrations.connection_secrets": () => fresh,
			},
		}, async (calls) => {
			assertEquals(await Service.accessToken(CONNECTION), "new");
			assertEquals(named(calls, "integrations.rpc.fn_commit_refresh").length, 1);
		});
	}));

Deno.test("accessToken: gone, or being refreshed elsewhere, gives no token", () =>
	world({
		db: { "integrations.rpc.fn_claim_connection_token": () => ({ busy: true }) },
	}, async () => {
		assertEquals(await Service.accessToken(CONNECTION), null);
	}));

Deno.test("webhook: an event nobody handles is acknowledged, a failed write asks for redelivery", () =>
	world({
		db: {
			"integrations.rpc.fn_record_presence_delivery": () => new DbError("connection reset"),
		},
	}, async () => {
		const ignored = await zoomCall(await zoomDelivery({ event: "meeting.created" }));
		assertEquals(ignored.status, 200);
		assertEquals(ignored.data?.outcomes, []);
		assertEquals((await zoomCall(await zoomDelivery(JOINED))).status, 503);
	}));

Deno.test("webhook: an unset secret refuses everything, and an unknown provider is a 404", () =>
	world({ env: { ZOOM_WEBHOOK_SECRET: "XXXX-XXXX" } }, async () => {
		const delivery = await zoomDelivery(JOINED);
		assertEquals((await zoomCall(delivery)).status, 503);
		for (const provider of ["nope", "constructor"]) {
			const res = await Service.handleWebhook(provider, "{}", new Headers(), WEBHOOK_URL, NOW_MS);
			assertEquals(res.status, 404, provider);
		}
	}));

Deno.test("webhook: app_deauthorized revokes through the definer, carrying its delivery id", () =>
	world({
		db: { "integrations.rpc.fn_deauthorize_connection": () => 1 },
	}, async (calls) => {
		const body = {
			event: "app_deauthorized",
			event_ts: 1762257600000,
			payload: { account_id: "acc", user_id: "zoom-user", client_id: "zoom-client" },
		};
		assertEquals((await zoomCall(await zoomDelivery(body))).status, 200);
		const [call] = named(calls, "integrations.rpc.fn_deauthorize_connection");
		assertEquals(call.json.p_provider_slug, "zoom");
		assertEquals(call.json.p_external_account_id, "zoom-user");
		assertEquals(call.json.p_delivery_id, "app_deauthorized:zoom-user:1762257600000");
	}));

Deno.test("webhook: a forged app_deauthorized revokes nothing", () =>
	world({}, async (calls) => {
		const body = { event: "app_deauthorized", payload: { user_id: "zoom-user" } };
		assertEquals((await zoomCall(await zoomDelivery(body, "not-the-secret"))).status, 400);
		assertEquals(calls.length, 0);
	}));

Deno.test("webhook: a Google push verifies against its channel's stored token, in the row's provider", () =>
	world({
		db: {
			"integrations.webhook_subscriptions": (call) =>
				call.url.searchParams.get("external_channel_id") === "eq.known"
					? [{ verification_token: "channel-token" }]
					: [],
			"integrations.rpc.fn_mark_calendar_due": () => true,
		},
	}, async (calls) => {
		const push = (channel: string, token: string) =>
			Service.handleWebhook(
				"google",
				"",
				new Headers({ "x-goog-channel-id": channel, "x-goog-channel-token": token }),
				WEBHOOK_URL,
				NOW_MS,
			);
		assertEquals((await push("unknown", "channel-token")).status, 400);
		assertEquals((await push("known", "wrong")).status, 400);
		const verified = await push("known", "channel-token");
		assertEquals(verified.status, 200);
		assertEquals(verified.data?.outcomes, []);
		const [read] = named(calls, "integrations.webhook_subscriptions");
		assertEquals(read.url.searchParams.get("provider_slug"), "eq.google");
		assertEquals(read.url.searchParams.get("status"), "in.(active,expiring)");
		const marked = named(calls, "integrations.rpc.fn_mark_calendar_due");
		assertEquals(marked.length, 1, "only the verified push marks anything");
		assertEquals(marked[0].json, { p_provider_slug: "google", p_channel: "known", p_renew: false });
		assertEquals(calls.filter((c) => c.host !== "postgrest.fake").length, 0, "the job reads, not the webhook");
	}));

Deno.test("webhook: Graph's validationToken is echoed unsigned; its notifications need the clientState", () =>
	world({
		db: {
			"integrations.webhook_subscriptions": () => [{ verification_token: "client-state" }],
			"integrations.rpc.fn_mark_calendar_due": () => true,
		},
	}, async (calls) => {
		const url = new URL(`${WEBHOOK_URL.href}?validationToken=echo%20me`);
		const handshake = await Service.handleWebhook("outlook", "", new Headers(), url, NOW_MS);
		assertEquals(handshake.data?.handshake, "echo me");
		assertEquals(calls.length, 0, "the handshake touches nothing");

		const notify = (clientState: string) =>
			Service.handleWebhook(
				"outlook",
				JSON.stringify({ value: [{ subscriptionId: "sub-1", clientState }] }),
				new Headers(),
				WEBHOOK_URL,
				NOW_MS,
			);
		assertEquals((await notify("wrong")).status, 400);
		assertEquals((await notify("client-state")).status, 200);
		assertEquals(
			(await Service.handleWebhook("outlook", "{}", new Headers(), WEBHOOK_URL, NOW_MS)).status,
			400,
		);
	}));

Deno.test("webhook: a Graph batch is judged per subscription, so one bad secret spoils only itself", () =>
	world({
		db: {
			"integrations.webhook_subscriptions": (call) =>
				call.url.searchParams.get("external_channel_id") === "eq.sub-1"
					? [{ verification_token: "state-1" }]
					: [{ verification_token: "state-2" }],
			"integrations.rpc.fn_mark_calendar_due": () => true,
		},
	}, async (calls) => {
		const deliver = (value: unknown[]) =>
			Service.handleWebhook("outlook", JSON.stringify({ value }), new Headers(), WEBHOOK_URL, NOW_MS);

		const both = await deliver([
			{ subscriptionId: "sub-1", clientState: "state-1" },
			{ subscriptionId: "sub-2", clientState: "state-2" },
			{ subscriptionId: "sub-1", clientState: "state-1" },
		]);
		assertEquals(both.status, 200);
		assertEquals(
			named(calls, "integrations.rpc.fn_mark_calendar_due").map((c) => c.json.p_channel),
			["sub-1", "sub-2"],
			"each calendar is marked due once",
		);

		calls.length = 0;
		const partly = await deliver([
			{ subscriptionId: "sub-1", clientState: "state-1" },
			{ subscriptionId: "sub-2", clientState: "forged" },
		]);
		assertEquals(partly.status, 200);
		assertEquals(
			named(calls, "integrations.rpc.fn_mark_calendar_due").map((c) => c.json.p_channel),
			["sub-1"],
		);

		assertEquals((await deliver([{ subscriptionId: "sub-2", clientState: "forged" }])).status, 400);
	}));

Deno.test("webhook: a lifecycle notice brings the renewal forward, and a missed one only reads again", () =>
	world({
		db: {
			"integrations.webhook_subscriptions": () => [{ verification_token: "client-state" }],
			"integrations.rpc.fn_mark_calendar_due": () => true,
		},
	}, async (calls) => {
		const notice = (lifecycleEvent: string) =>
			Service.handleWebhook(
				"outlook",
				JSON.stringify({
					value: [{ subscriptionId: "sub-1", clientState: "client-state", lifecycleEvent }],
				}),
				new Headers(),
				WEBHOOK_URL,
				NOW_MS,
			);
		await notice("reauthorizationRequired");
		await notice("subscriptionRemoved");
		await notice("missed");
		assertEquals(
			named(calls, "integrations.rpc.fn_mark_calendar_due").map((c) => c.json.p_renew),
			[true, true, false],
		);
	}));

Deno.test("webhook: a failed mark asks for a redelivery", () =>
	world({
		db: {
			"integrations.webhook_subscriptions": () => [{ verification_token: "t" }],
			"integrations.rpc.fn_mark_calendar_due": () => new DbError("down"),
		},
	}, async () => {
		const res = await Service.handleWebhook(
			"google",
			"",
			new Headers({ "x-goog-channel-id": "c", "x-goog-channel-token": "t" }),
			WEBHOOK_URL,
			NOW_MS,
		);
		assertEquals(res.status, 503);
	}));
// #endregion

// #region Publishing
Deno.test("publishing: only the caller's own connection, and only one granted the calendar", async () => {
	const input = { connectionId: CONNECTION, syncDirection: "bidirectional" } as const;
	await world({ db: { "integrations.v_my_connections": () => [] } }, async (calls) => {
		assertEquals((await Service.setSyncDirection(input, ADA)).status, 404);
		assertEquals(named(calls, "integrations.rpc.fn_set_sync_direction").length, 0);
	});
	await world({
		db: {
			"integrations.v_my_connections": () => [{ ...connectionRow("google"), granted_kinds: ["freebusy"] }],
		},
	}, async (calls) => {
		assertEquals((await Service.setSyncDirection(input, ADA)).status, 409);
		assertEquals(named(calls, "integrations.rpc.fn_set_sync_direction").length, 0);
	});
	await world({
		db: {
			"integrations.v_my_connections": () => [connectionRow("google")],
			"integrations.rpc.fn_set_sync_direction": () => true,
		},
	}, async (calls) => {
		assertEquals((await Service.setSyncDirection(input, ADA)).data, { changed: true });
		assertEquals(
			named(calls, "integrations.rpc.fn_set_sync_direction")[0].json.p_direction,
			"bidirectional",
		);
	});
});

Deno.test("publishing: turning it off needs no write scope, so a narrowed grant can still stop", () =>
	world({
		db: {
			"integrations.v_my_connections": () => [{ ...connectionRow("google"), granted_kinds: ["freebusy"] }],
			"integrations.rpc.fn_set_sync_direction": () => true,
		},
	}, async () => {
		const res = await Service.setSyncDirection(
			{ connectionId: CONNECTION, syncDirection: "inbound" },
			ADA,
		);
		assertEquals(res.data, { changed: true });
	}));
// #endregion

// #region Browsing
const DRIVE_FOLDER = "application/vnd.google-apps.folder";

function driveRow() {
	return {
		...connectionRow("google_drive"),
		provider_label: "Google Drive",
		provider_category: "storage",
		provider_capabilities: ["storage", "docs"],
		granted_kinds: ["storage", "docs"],
	};
}

async function driveClaim() {
	const secret = await secretRow({ access_token: "drive-token", refresh_token: "r" });
	return { provider_slug: "google_drive", auth_config: {}, secret };
}

Deno.test("browse: one level arrives through the adapter, carrying the connection's own token", () =>
	world({}, async () => {
		const claim = await driveClaim();
		await world({
			db: {
				"integrations.v_my_connections": () => [driveRow()],
				"integrations.rpc.fn_claim_connection_token": () => claim,
			},
			provider: () =>
				json({
					nextPageToken: "more",
					files: [
						{ id: "F1", name: "Briefs", mimeType: DRIVE_FOLDER },
						{ id: "P1", name: "logo.png", mimeType: "image/png", size: "5" },
					],
				}),
		}, async (calls) => {
			const res = await Service.browse({ connectionId: CONNECTION, folderId: "F0" }, ADA);
			assert(res.ok, res.message);
			assertEquals(res.data?.folders.map((f) => f.externalFolderId), ["F1"]);
			assertEquals(res.data?.entries.map((e) => e.name), ["logo.png"]);
			assertEquals(res.data?.nextCursor, "more");
			const [list] = named(calls, "/drive/v3/files");
			assertEquals(list.headers.get("authorization"), "Bearer drive-token");
			assertStringIncludes(list.url.searchParams.get("q") ?? "", "'F0' in parents");
			assertFalse(JSON.stringify(res).includes("drive-token"));
		});
	}));

Deno.test("browse: a grant the provider refuses asks for a reconnect, in words", () =>
	world({}, async () => {
		const claim = await driveClaim();
		await world({
			db: {
				"integrations.v_my_connections": () => [driveRow()],
				"integrations.rpc.fn_claim_connection_token": () => claim,
			},
			provider: () => json({ error: { code: 401 } }, 401),
		}, async () => {
			const res = await Service.browse({ connectionId: CONNECTION }, ADA);
			assertEquals(res.status, 409);
			assertEquals(res.message, "Google Drive needs reconnecting.");
		});
	}));

Deno.test("browse: a Google project without the Drive API blames neither the account nor the grant", () =>
	world({}, async () => {
		const claim = await driveClaim();
		await world({
			db: {
				"integrations.v_my_connections": () => [driveRow()],
				"integrations.rpc.fn_claim_connection_token": () => claim,
			},
			provider: () =>
				json({
					error: {
						code: 403,
						status: "PERMISSION_DENIED",
						errors: [{ domain: "usageLimits", reason: "accessNotConfigured" }],
						details: [{ reason: "SERVICE_DISABLED" }],
					},
				}, 403),
		}, async () => {
			const res = await Service.browse({ connectionId: CONNECTION }, ADA);
			assertEquals(res.status, 503);
			assertEquals(res.message, "Browsing Google Drive isn't available in this environment yet.");
		});
	}));

Deno.test("browse: with the gate off no token is claimed and no provider is called", () =>
	world({
		env: { INTEGRATIONS_BACKEND_LIVE: undefined },
		db: { "integrations.v_my_connections": () => [driveRow()] },
	}, async (calls) => {
		const res = await Service.browse({ connectionId: CONNECTION }, ADA);
		assertEquals(res.status, 503);
		assertEquals(named(calls, "integrations.rpc.fn_claim_connection_token").length, 0);
		assertEquals(named(calls, "/drive/v3/files").length, 0);
	}));

Deno.test("browse: a connection for calendars only is refused before any token is read", () =>
	world({
		db: { "integrations.v_my_connections": () => [connectionRow("google")] },
	}, async (calls) => {
		const res = await Service.browse({ connectionId: CONNECTION }, ADA);
		assertEquals(res.status, 403);
		assertEquals(named(calls, "integrations.rpc.fn_claim_connection_token").length, 0);
	}));

Deno.test("browseLocation: the trail names each level on the first page, and only there", () =>
	world({}, async () => {
		const claim = await driveClaim();
		await world({
			db: {
				"integrations.v_my_connections": () => [driveRow()],
				"integrations.rpc.fn_claim_connection_token": () => claim,
			},
			provider: (call) =>
				call.url.pathname === "/drive/v3/files" ? json({ files: [] }) : json({
					id: call.url.pathname.split("/").at(-1),
					name: "Named",
					mimeType: DRIVE_FOLDER,
				}),
		}, async (calls) => {
			const input = { connectionId: CONNECTION, folderIds: ["F1", "F2"], limit: 10 };
			const first = await Service.browseLocation({ ...input, cursor: null }, ADA);
			assertEquals(first.data?.connection.providerLabel, "Google Drive");
			assertEquals(first.data?.trail.map((f) => f.id), ["F1", "F2"]);
			assertStringIncludes(
				named(calls, "/drive/v3/files")[0].url.searchParams.get("q") ?? "",
				"'F2'",
			);

			const before = calls.length;
			const later = await Service.browseLocation({ ...input, cursor: "tok" }, ADA);
			assertEquals(later.data?.trail, []);
			assertEquals(calls.slice(before).filter((c) => c.host !== "postgrest.fake").length, 1);
		});
	}));

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

/** Drive's answer for a file's thumbnail facts, and the picture host's for its bytes. */
function pictured(
	link: string | null,
	host: () => Response = () => new Response(PNG_BYTES),
): ProviderRoute {
	return (call) =>
		call.host === "www.googleapis.com"
			? json(link ? { hasThumbnail: true, thumbnailLink: link } : { hasThumbnail: false })
			: host();
}

Deno.test("thumbnail: the picture comes back as sniffed bytes, read under the caller's own connection", () =>
	world({}, async () => {
		const claim = await driveClaim();
		await world({
			db: {
				"integrations.v_my_connections": () => [driveRow()],
				"integrations.rpc.fn_claim_connection_token": () => claim,
			},
			provider: pictured("https://lh3.googleusercontent.com/drive-storage/T=s220"),
		}, async (calls) => {
			const res = await Service.thumbnail({ connectionId: CONNECTION, id: "P1" }, ADA);
			assert(res.ok, res.message);
			assertEquals(res.data?.contentType, "image/png");
			assertEquals(res.data?.bytes, PNG_BYTES);
			const [facts] = named(calls, "/drive/v3/files/P1");
			assertEquals(facts.headers.get("authorization"), "Bearer drive-token");
			const [host] = calls.filter((c) => c.host === "lh3.googleusercontent.com");
			assertEquals(host.url.pathname, "/drive-storage/T=s512");
		});
	}));

Deno.test("thumbnail: a file Drive cannot picture is a 404, with no picture request", () =>
	world({}, async () => {
		const claim = await driveClaim();
		await world({
			db: {
				"integrations.v_my_connections": () => [driveRow()],
				"integrations.rpc.fn_claim_connection_token": () => claim,
			},
			provider: pictured(null),
		}, async (calls) => {
			const res = await Service.thumbnail({ connectionId: CONNECTION, id: "Z1" }, ADA);
			assertEquals(res.status, 404);
			assertEquals(calls.filter((c) => c.host.endsWith("googleusercontent.com")).length, 0);
		});
	}));

Deno.test("thumbnail: someone else's connection is a 404, and no token is claimed", () =>
	world({
		db: { "integrations.v_my_connections": () => [] },
	}, async (calls) => {
		const res = await Service.thumbnail({ connectionId: CONNECTION, id: "P1" }, MALLORY);
		assertEquals(res.status, 404);
		assertEquals(named(calls, "integrations.rpc.fn_claim_connection_token").length, 0);
	}));

Deno.test("thumbnail: a picture address off Google's hosts is a 502 that names no address", () =>
	world({}, async () => {
		const claim = await driveClaim();
		await world({
			db: {
				"integrations.v_my_connections": () => [driveRow()],
				"integrations.rpc.fn_claim_connection_token": () => claim,
			},
			provider: pictured("https://evil.example/steal?token=x"),
		}, async (calls) => {
			const res = await Service.thumbnail({ connectionId: CONNECTION, id: "P1" }, ADA);
			assertEquals(res.status, 502);
			assertEquals(res.message?.includes("evil.example"), false);
			assertEquals(calls.filter((c) => c.host === "evil.example").length, 0);
		});
	}));

Deno.test("thumbnail: signed out is a 401 before anything is read", () =>
	world({}, async (calls) => {
		const signedOut: ReadActor = { ...ADA, userId: "", accessToken: "" };
		const res = await Service.thumbnail({ connectionId: CONNECTION, id: "P1" }, signedOut);
		assertEquals(res.status, 401);
		assertEquals(calls.length, 0);
	}));
// #endregion

// #region Shared Google grant
Deno.test("revoke: Drive leaves the shared Google grant alone while Calendar still needs it", () =>
	world({}, async () => {
		const secret = await secretRow({ access_token: "a", refresh_token: "r" });
		const calendar = { ...connectionRow("google"), id: "c0a8012e-0000-4000-8000-000000000002" };
		await world({
			provider: () => json({}),
			db: {
				"integrations.v_my_connections": (call) =>
					call.url.searchParams.has("id") ? [driveRow()] : [driveRow(), calendar],
				"integrations.providers":
					() => [providerRow("google_drive", { auth_config: AUTH_CONFIG.google })],
				"integrations.connection_secrets": () => [secret],
				"integrations.rpc.fn_revoke_connection": () => true,
			},
		}, async (calls) => {
			const res = await Service.revokeConnection({ connectionId: CONNECTION }, ADA);
			assertEquals(res.data, { revoked: true });
			assertEquals(named(calls, "/revoke").length, 0);
		});
	}));

Deno.test("revoke: Drive revokes at Google when nothing else shares the grant", () =>
	world({}, async () => {
		const secret = await secretRow({ access_token: "a", refresh_token: "r" });
		await world({
			provider: () => json({}),
			db: {
				"integrations.v_my_connections": () => [driveRow()],
				"integrations.providers":
					() => [providerRow("google_drive", { auth_config: AUTH_CONFIG.google })],
				"integrations.connection_secrets": () => [secret],
				"integrations.rpc.fn_revoke_connection": () => true,
			},
		}, async (calls) => {
			await Service.revokeConnection({ connectionId: CONNECTION }, ADA);
			assertEquals(named(calls, "/revoke")[0].url.searchParams.get("token"), "r");
		});
	}));
// #endregion

// #region Cron bearer
Deno.test("cron: only the exact bearer authorises, and an unset or short secret authorises nothing", () =>
	world({ env: { INTEGRATIONS_CRON_SECRET: "c".repeat(32) } }, async () => {
		assert(Service.isCronAuthorised(`Bearer ${"c".repeat(32)}`));
		assertFalse(Service.isCronAuthorised(`Bearer ${"d".repeat(32)}`));
		assertFalse(Service.isCronAuthorised(null));
		await world({ env: { INTEGRATIONS_CRON_SECRET: "short" } }, () => {
			assertFalse(Service.isCronAuthorised("Bearer short"));
			return Promise.resolve();
		});
	}));
// #endregion
