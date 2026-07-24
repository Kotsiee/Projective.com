import type { WalletResult } from "../types/results.ts";
import { apiFetch } from "@web/utils/api-client.ts";

/**
 * Wallet transport primitives — the `fetch` helpers the thin {@link WalletService} composes over. Reads
 * are GETs; mutations (the action modals) are JSON POSTs. Any network/parse failure degrades to a soft
 * `{ ok: false, message }` rather than throwing, so islands stay dumb (mirrors `catalogue/core/api.ts`).
 *
 * Requests go through {@link apiFetch}, so an expired access token on a `/api/wallet/*` call is silently
 * refreshed and retried (or routed to `/login` with the current path preserved) instead of surfacing as a
 * bare failure or a surprise logout (Decision #46) — important on a money surface where a lost session
 * mid-action must not silently drop a mutation.
 */

/** GET a wallet endpoint, folding the response into a soft {@link WalletResult}. */
export async function getWallet<T>(path: string): Promise<WalletResult<T>> {
	try {
		const res = await apiFetch(path, { headers: { accept: "application/json" } });
		const body = await res.json().catch(() => null);
		if (body && typeof body.ok === "boolean") return body as WalletResult<T>;
		return { ok: false, message: "Unexpected response from the wallet service." };
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}

/** POST JSON to a wallet endpoint, folding the response into a soft {@link WalletResult}. */
export async function postWallet<T>(path: string, payload: unknown): Promise<WalletResult<T>> {
	try {
		const res = await apiFetch(path, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify(payload),
		});
		const body = await res.json().catch(() => null);
		if (body && typeof body.ok === "boolean") return body as WalletResult<T>;
		return { ok: false, message: "Unexpected response from the wallet service." };
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}
