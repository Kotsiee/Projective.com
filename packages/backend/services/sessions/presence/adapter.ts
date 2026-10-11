import type { PresenceEvent } from "@projective/types/projects";

/**
 * The seam between a conferencing provider's presence webhook and `projects.record_presence`
 * (Decision #171). Each provider is one adapter: it proves a delivery is the provider's own, answers
 * the provider's endpoint handshake, and reduces the provider's payload to {@link PresenceEvent}s.
 * Nothing past the adapter knows a provider's field names, so a second provider is a second file
 * registered in `presence/mod.ts` — the route, the service and the database door do not change.
 */
export interface PresenceAdapter {
	provider: PresenceEvent["provider"];
	/** The signing secret, or `undefined` while it is unset (every delivery is then refused). */
	secret(): string | undefined;
	/** Whether the raw delivery carries this provider's valid signature, inside the replay tolerance. */
	verify(raw: string, headers: Headers, secret: string, nowMs: number): Promise<boolean>;
	/**
	 * The body a provider handshake must be answered with (Zoom's URL validation), or `null` when the
	 * delivery is an ordinary event. Only ever called on a VERIFIED delivery.
	 */
	challenge(body: unknown, secret: string): Promise<Record<string, string> | null>;
	/** The presence events in a verified delivery; empty for an event this adapter does not handle. */
	parse(body: unknown): PresenceEvent[];
}

/** A configured secret: set, and not the env contract's `XXXX-XXXX` placeholder. */
export function usableSecret(value: string | undefined): string | undefined {
	const v = value?.trim();
	return v && v !== "XXXX-XXXX" ? v : undefined;
}

// #region HMAC
const encoder = new TextEncoder();

/** Lower-case hex HMAC-SHA256 of `message` under `secret` (Web Crypto, so it runs on Deno Deploy). */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
	return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compare two strings in time independent of where they first differ. */
export function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}
// #endregion
