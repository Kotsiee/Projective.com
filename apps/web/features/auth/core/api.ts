import type { AuthResult } from "../types/mod.ts";

/**
 * postAuth — the single client→server call the auth islands make. Islands stay "dumb" (no DB): they
 * POST JSON to an internal `/api/auth/*` route and act on the {@link AuthResult}. Network / parse
 * failures degrade to a friendly, retryable error rather than throwing into the island.
 */
export async function postAuth(path: string, body: unknown): Promise<AuthResult> {
	try {
		const res = await fetch(path, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		const data = await res.json().catch(() => null);
		if (data && typeof data === "object") return data as AuthResult;
		return { ok: false, message: "Unexpected response from the server. Please try again." };
	} catch {
		return { ok: false, message: "Network error — check your connection and try again." };
	}
}

/**
 * getAuth — a GET counterpart to {@link postAuth} for read-only status polls (e.g. `/verify`'s
 * verification-status listener). Same dumb-island contract: it returns an {@link AuthResult} and
 * degrades network/parse failures to a soft, retryable `ok: false` rather than throwing.
 */
export async function getAuth(path: string): Promise<AuthResult> {
	try {
		const res = await fetch(path, { headers: { accept: "application/json" } });
		const data = await res.json().catch(() => null);
		if (data && typeof data === "object") return data as AuthResult;
		return { ok: false, message: "Unexpected response from the server. Please try again." };
	} catch {
		return { ok: false, message: "Network error — check your connection and try again." };
	}
}
