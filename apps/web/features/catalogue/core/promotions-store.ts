import { batch, signal } from "@preact/signals";
import type { SavePromoCode, SellerPromoCode, SellerPromotions } from "@projective/types/finance";
import { getCatalogue, postCatalogue } from "./api.ts";
import { setConsoleUrl } from "./console-store.ts";

/**
 * promotions-store — the console Promotions view's state (MARKETPLACE CK2): the acting seller's codes
 * from `GET /api/catalogue/promotions` (team-scoped by the page path), and the two writes. Which dialog
 * is open is the address's (`?promo=`), never a signal here.
 */

/** The last read that worked; `null` before the first. */
export const promotions = signal<SellerPromotions | null>(null);
/** Why the last read failed; `null` when it did not. */
export const promotionsError = signal<string | null>(null);
/** A read is in flight. */
export const promotionsLoading = signal(false);
/** A write is in flight. */
export const promotionsBusy = signal(false);

/** Read (or re-read) the seller's codes. */
export async function loadPromotions(): Promise<void> {
	promotionsLoading.value = true;
	const out = await getCatalogue<SellerPromotions>("/api/catalogue/promotions");
	batch(() => {
		promotionsLoading.value = false;
		if (out.ok && out.data) {
			promotions.value = out.data;
			promotionsError.value = null;
		} else {
			promotionsError.value = out.message ?? "We couldn't reach your promotions just now.";
		}
	});
}

/** The outcome of a write, for the dialog to show in place. */
export type PromoWrite = { ok: true } | {
	ok: false;
	message: string;
	errors?: Record<string, string>;
};

async function write(
	path: string,
	payload: unknown,
	apply: (code: SellerPromoCode, list: SellerPromotions) => SellerPromotions,
): Promise<PromoWrite> {
	promotionsBusy.value = true;
	const out = await postCatalogue<SellerPromoCode>(path, payload);
	promotionsBusy.value = false;
	if (!out.ok || !out.data) {
		return {
			ok: false,
			message: out.message ?? "That didn't go through. Try again.",
			errors: out.errors,
		};
	}
	const code = out.data;
	batch(() => {
		const list = promotions.peek();
		if (list) promotions.value = apply(code, list);
		setConsoleUrl({ promo: undefined });
	});
	return { ok: true };
}

/** Issue a code; it joins the top of the list and the dialog closes. */
export function createPromotion(input: SavePromoCode): Promise<PromoWrite> {
	return write(
		"/api/catalogue/promotions",
		input,
		(code, list) => ({ ...list, codes: [code, ...list.codes] }),
	);
}

/** Archive a code; it moves under Archived and the dialog closes. */
export function archivePromotion(id: string): Promise<PromoWrite> {
	return write("/api/catalogue/promotions/archive", { id }, (code, list) => ({
		...list,
		codes: [
			...list.codes.filter((c) => c.id !== code.id && c.archivedAt === null),
			code,
			...list.codes.filter((c) => c.id !== code.id && c.archivedAt !== null),
		],
	}));
}
