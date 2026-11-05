import { z } from "zod";
import {
	type ProviderAuthConfig,
	ProviderAuthConfigSchema,
	type ProviderKind,
} from "@projective/types/integrations";
import { serverEnv } from "../../core/env.ts";
import { usableSecret } from "../sessions/presence/adapter.ts";

/**
 * oauth — the provider's half of a connection's consent (providers spec §7.1): the authorize URL, the
 * token endpoint, the linked account's identity and revocation. What a provider differs on is data in
 * `providers.auth_config`, so the only vendor names here are which env pair each slug consents with.
 *
 * No token leaves through an error: {@link OAuthError} carries the provider's status and error code
 * and nothing else, because the callers log it and store it where a client reads it (`last_error`).
 */

const TIMEOUT_MS = 15_000;

// #region Flow

/** A provider's OAuth client, configured and well formed. */
interface OAuthClient {
	clientId: string;
	clientSecret: string;
}

/** Everything one provider's calls need. */
export interface OAuthFlow {
	slug: string;
	/** `{tenant}` already filled. */
	config: ProviderAuthConfig;
	client: OAuthClient;
	redirectUri: string;
}

function oauthClient(slug: string): OAuthClient | null {
	const env = serverEnv();
	const google = [env.googleIntegrationClientId, env.googleIntegrationClientSecret];
	const microsoft = [env.microsoftIntegrationClientId, env.microsoftIntegrationClientSecret];
	const pairs: Record<string, (string | undefined)[]> = {
		google,
		google_drive: google,
		outlook: microsoft,
		onedrive: microsoft,
		zoom: [env.zoomClientId, env.zoomClientSecret],
		dropbox: [env.dropboxClientId, env.dropboxClientSecret],
		frameio: [env.frameioClientId, env.frameioClientSecret],
	};
	const [clientId, clientSecret] = (pairs[slug] ?? []).map(usableSecret);
	return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/**
 * The flow for a provider, or `null` while this environment cannot run it: no well-formed client, or
 * no `auth_config` (only `google`, `outlook` and `zoom` are seeded one).
 */
export function oauthFlow(slug: string, authConfig: unknown): OAuthFlow | null {
	const client = oauthClient(slug);
	const parsed = ProviderAuthConfigSchema.safeParse(authConfig);
	if (!client || !parsed.success) return null;
	const env = serverEnv();
	const tenant = (url: string) =>
		url.replace("{tenant}", encodeURIComponent(env.microsoftIntegrationTenant));
	return {
		slug,
		config: {
			...parsed.data,
			authorize_url: tenant(parsed.data.authorize_url),
			token_url: tenant(parsed.data.token_url),
		},
		client,
		redirectUri: `${env.appUrl}/api/integrations/callback`,
	};
}

// #endregion

// #region Errors

/** A provider refused or could not be read. The code is theirs (`invalid_grant`) or ours, never a token. */
export class OAuthError extends Error {
	constructor(slug: string, status: number, readonly code: string) {
		super(`${slug} answered ${status}: ${code}`);
		this.name = "OAuthError";
	}
}

// #endregion

// #region Consent

const base64Url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** 32 random bytes as base64url: a `state` or a PKCE verifier. */
export function randomToken(): string {
	return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** The scopes a consent for `kinds` asks for: what no capability owns, plus what those kinds need. */
export function scopesFor(
	config: ProviderAuthConfig,
	defaultScopes: string[],
	kinds: ProviderKind[],
): string[] {
	const perKind = config.kind_scopes ?? {};
	const owned = new Set(Object.values(perKind).flat());
	const wanted = new Set(kinds.flatMap((kind) => perKind[kind] ?? []));
	return defaultScopes.filter((scope) => !owned.has(scope) || wanted.has(scope));
}

/** The capabilities a grant really covers: a person may untick a scope on the consent screen. */
export function grantedKindsOf(
	config: ProviderAuthConfig,
	requested: ProviderKind[],
	grantedScopes: string[],
): ProviderKind[] {
	const perKind = config.kind_scopes ?? {};
	return requested.filter((kind) =>
		(perKind[kind] ?? []).every((scope) => grantedScopes.includes(scope))
	);
}

/** The URL of the provider's consent screen. */
export async function authorizeUrl(
	flow: OAuthFlow,
	consent: { state: string; scopes: string[]; verifier: string | null },
): Promise<string> {
	const url = new URL(flow.config.authorize_url);
	url.search = new URLSearchParams({
		...flow.config.authorize_params,
		response_type: "code",
		client_id: flow.client.clientId,
		redirect_uri: flow.redirectUri,
		...(flow.config.send_scopes === false ? {} : { scope: consent.scopes.join(" ") }),
		state: consent.state,
		...(consent.verifier
			? {
				code_challenge: base64Url(
					new Uint8Array(
						await crypto.subtle.digest("SHA-256", new TextEncoder().encode(consent.verifier)),
					),
				),
				code_challenge_method: "S256",
			}
			: {}),
	}).toString();
	return url.href;
}

// #endregion

// #region Token endpoint

const TokenSetSchema = z.object({
	access_token: z.string().min(1),
	refresh_token: z.string().min(1).optional(),
	expires_in: z.coerce.number().positive().optional(),
	refresh_token_expires_in: z.coerce.number().positive().optional(),
	/** Space-separated. Absent means exactly what was asked for (RFC 6749 §5.1). */
	scope: z.string().optional(),
});

/** A token endpoint's answer. The fields are plaintext credentials: seal them, never log them. */
export type TokenSet = z.infer<typeof TokenSetSchema>;

const basicAuth = ({ clientId, clientSecret }: OAuthClient) =>
	`Basic ${btoa(`${clientId}:${clientSecret}`)}`;

async function tokenRequest(flow: OAuthFlow, grant: Record<string, string>): Promise<TokenSet> {
	const body = new URLSearchParams(grant);
	const headers = new Headers({
		accept: "application/json",
		"content-type": "application/x-www-form-urlencoded",
	});
	if (flow.config.token_auth === "basic") headers.set("authorization", basicAuth(flow.client));
	else {
		body.set("client_id", flow.client.clientId);
		body.set("client_secret", flow.client.clientSecret);
	}
	const res = await fetch(flow.config.token_url, {
		method: "POST",
		headers,
		body,
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	const json = await res.json().catch(() => null) as { error?: unknown } | null;
	if (!res.ok) {
		throw new OAuthError(
			flow.slug,
			res.status,
			typeof json?.error === "string" ? json.error : "token_refused",
		);
	}
	const parsed = TokenSetSchema.safeParse(json);
	if (!parsed.success) throw new OAuthError(flow.slug, res.status, "malformed_token_response");
	return parsed.data;
}

/** Redeem an authorization code. */
export function exchangeCode(
	flow: OAuthFlow,
	code: string,
	verifier: string | null,
): Promise<TokenSet> {
	return tokenRequest(flow, {
		grant_type: "authorization_code",
		code,
		redirect_uri: flow.redirectUri,
		...(verifier ? { code_verifier: verifier } : {}),
	});
}

/** Spend a refresh token. Graph and Zoom answer a new one and void the old. */
export function refreshGrant(flow: OAuthFlow, refreshToken: string): Promise<TokenSet> {
	return tokenRequest(flow, { grant_type: "refresh_token", refresh_token: refreshToken });
}

/** An instant `seconds` from now, as the `timestamptz` a definer stores. */
export function expiryIn(seconds: number | undefined): string | null {
	return seconds === undefined ? null : new Date(Date.now() + seconds * 1000).toISOString();
}

// #endregion

// #region Identity

/** Which account at the far end granted this, from the provider's own account of it. */
export async function readIdentity(
	flow: OAuthFlow,
	accessToken: string,
): Promise<{ id: string; label: string | null }> {
	const res = await fetch(flow.config.identity_url, {
		headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!res.ok) {
		await res.body?.cancel();
		throw new OAuthError(flow.slug, res.status, "identity_unreadable");
	}
	const body = await res.json().catch(() => null) as Record<string, unknown> | null;
	const id = body?.[flow.config.identity_id_field];
	if ((typeof id !== "string" && typeof id !== "number") || id === "") {
		throw new OAuthError(flow.slug, res.status, "identity_unreadable");
	}
	const label = flow.config.identity_label_fields
		.map((field) => body?.[field])
		.find((value) => typeof value === "string" && value.length > 0);
	return { id: String(id), label: (label as string | undefined) ?? null };
}

// #endregion

// #region Revocation

/**
 * Revoke a grant at the provider, best effort: it never throws, because the callers have already
 * dropped the credential on our side. Tries each token until one is accepted, since a refresh token
 * ends the whole grant and an expired access token may not be accepted at all.
 *
 * A provider with no `revoke_url` is skipped. Microsoft has no per-grant revoke endpoint: the only
 * call ends every session the person has, so a grant lapses when its tokens do, or when they remove
 * the app from their account.
 */
export async function revokeGrant(flow: OAuthFlow, tokens: (string | null)[]): Promise<void> {
	const { revoke_url: revokeUrl } = flow.config;
	if (!revokeUrl) return;
	const headers: HeadersInit = flow.config.token_auth === "basic"
		? { authorization: basicAuth(flow.client) }
		: {};
	for (const token of tokens) {
		if (!token) continue;
		try {
			const url = `${revokeUrl}?token=${encodeURIComponent(token)}`;
			const res = await fetch(url, {
				method: "POST",
				headers,
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			await res.body?.cancel();
			if (res.ok) return;
		} catch (error) {
			console.error(`[integrations:revoke] ${flow.slug}`, error instanceof Error ? error.name : "");
		}
	}
}

// #endregion
