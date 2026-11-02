import type { CheckoutResponse } from "../types/results.ts";
import { apiFetch } from "@web/utils/api-client.ts";
import { BACKGROUND_HEADER } from "@web/utils/offline.ts";

/**
 * Checkout transport primitives — the `fetch` helpers the thin {@link BasketService},
 * {@link CheckoutService} and {@link CardsService} compose over. Reads are GETs; every mutation is a
 * JSON body on POST / PATCH / DELETE, matching the verbs the `/api/basket/*`, `/api/cards/*` and
 * `/api/checkout/*` routes already publish.
 *
 * Any network or parse failure degrades to a soft `{ ok: false, message }` rather than throwing, so
 * islands stay dumb and a failed read is a value a surface can RENDER — the wallet's hardest-won lesson
 * was that `if (res.ok) { … }` with no else leaves stale money on screen indefinitely.
 *
 * Requests go through {@link apiFetch}, so an access token that expires mid-purchase is silently
 * refreshed and the call retried, rather than dumping a buyer at `/login` with a basket they thought
 * they had paid for (Decision #46).
 */

/** The verbs the checkout API exposes for a JSON-bodied mutation. */
type MutationMethod = "POST" | "PATCH" | "DELETE";

/** How a checkout read is made. */
export interface CheckoutReadOptions {
	/**
	 * A read the buyer did not ask for — the shell badge's mount-time read, a re-read after another
	 * region's write. Sent as background work, so a dead session fails it softly instead of bouncing
	 * the page to `/login` (Decision #374).
	 */
	background?: boolean;
}

/** GET a checkout endpoint, folding the response into a soft {@link CheckoutResponse}. */
export async function getCheckout<T>(
	path: string,
	options: CheckoutReadOptions = {},
): Promise<CheckoutResponse<T>> {
	try {
		const headers: Record<string, string> = { accept: "application/json" };
		if (options.background) headers[BACKGROUND_HEADER] = "1";
		const res = await apiFetch(path, { headers });
		const body = await res.json().catch(() => null);
		if (body && typeof body.ok === "boolean") return body as CheckoutResponse<T>;
		return { ok: false, message: "Unexpected response from the basket service." };
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}

/** Send a JSON body to a checkout endpoint, folding the response into a soft {@link CheckoutResponse}. */
export async function sendCheckout<T>(
	method: MutationMethod,
	path: string,
	payload: unknown,
): Promise<CheckoutResponse<T>> {
	try {
		const res = await apiFetch(path, {
			method,
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify(payload),
		});
		const body = await res.json().catch(() => null);
		if (body && typeof body.ok === "boolean") return body as CheckoutResponse<T>;
		return { ok: false, message: "Unexpected response from the basket service." };
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}

/** POST JSON to a checkout endpoint. */
export function postCheckout<T>(path: string, payload: unknown): Promise<CheckoutResponse<T>> {
	return sendCheckout<T>("POST", path, payload);
}

/** PATCH JSON to a checkout endpoint. */
export function patchCheckout<T>(path: string, payload: unknown): Promise<CheckoutResponse<T>> {
	return sendCheckout<T>("PATCH", path, payload);
}

/** DELETE with a JSON body (the basket-line removal shape the route accepts). */
export function deleteCheckout<T>(path: string, payload: unknown): Promise<CheckoutResponse<T>> {
	return sendCheckout<T>("DELETE", path, payload);
}
