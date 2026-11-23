import {
	PROMO_CODE_PATTERN,
	type PromoKind,
	type SavePromoCode,
	type SellerPromoCode,
} from "@projective/types/finance";

/**
 * promotions-model — the pure half of the console's Promotions view (MARKETPLACE CK2, Decision #485):
 * the facts a code's row states as MetaLine text, and the create form's draft and its checks. The
 * database re-checks every term (`finance.save_promo_code`); these checks only say so sooner.
 */

// #region Row facts
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** `20% off` / `12.5% off`; a fixed code's figure is its MoneyView, so `null` here. */
export function percentLabel(code: Pick<SellerPromoCode, "kind" | "valueBp">): string | null {
	if (code.kind !== "percent" || code.valueBp === null) return null;
	return `${Number((code.valueBp / 100).toFixed(2))}% off`;
}

/** `3 of 50 redeemed` / `3 redeemed` (no cap). */
export function redeemedLabel(
	code: Pick<SellerPromoCode, "redemptionCount" | "maxRedemptions">,
): string {
	return code.maxRedemptions === null
		? `${code.redemptionCount} redeemed`
		: `${code.redemptionCount} of ${code.maxRedemptions} redeemed`;
}

/** `Expires 30 Nov 2026` / `Expired 3 Nov 2026` / `No expiry`. */
export function expiryLabel(code: Pick<SellerPromoCode, "expiresAt">, nowMs: number): string {
	if (!code.expiresAt) return "No expiry";
	const at = Date.parse(code.expiresAt);
	return `${at <= nowMs ? "Expired" : "Expires"} ${DAY.format(new Date(at))}`;
}

/** `All your products` / `1 listing` / `3 listings`. */
export function scopeLabel(code: Pick<SellerPromoCode, "listings">): string {
	if (code.listings === null) return "All your products";
	return code.listings.length === 1 ? "1 listing" : `${code.listings.length} listings`;
}

/** `Once per account` / `2 per account` / `No per-account limit`. */
export function perAccountLabel(code: Pick<SellerPromoCode, "maxRedemptionsPerAccount">): string {
	const n = code.maxRedemptionsPerAccount;
	if (n === null) return "No per-account limit";
	return n === 1 ? "Once per account" : `${n} per account`;
}

/** `Archived 23 Nov 2026`. */
export function archivedLabel(code: Pick<SellerPromoCode, "archivedAt">): string | null {
	return code.archivedAt ? `Archived ${DAY.format(new Date(code.archivedAt))}` : null;
}

/** The live codes, then the archived ones, in the order the database answered. */
export function splitCodes(codes: readonly SellerPromoCode[]): {
	live: SellerPromoCode[];
	archived: SellerPromoCode[];
} {
	return {
		live: codes.filter((c) => c.archivedAt === null),
		archived: codes.filter((c) => c.archivedAt !== null),
	};
}
// #endregion

// #region Create form
/** What the create form holds while it is being filled in. */
export interface PromoDraft {
	code: string;
	label: string;
	kind: PromoKind;
	/** Whole percent, for a percentage code. */
	percent: number | null;
	/** Major units as typed, for a fixed code (`5`, `12.50`). */
	amount: number | null;
	currency: string;
	/** `null` is every product listing; otherwise the chosen slugs. */
	listings: string[] | null;
	expiresOn: Date | null;
	maxRedemptions: number | null;
	/** `null` is no per-account limit. */
	perAccount: number | null;
}

/** A fresh draft: 10% off every product, once per account, priced in the seller's currency. */
export function freshPromoDraft(currency: string): PromoDraft {
	return {
		code: "",
		label: "",
		kind: "percent",
		percent: 10,
		amount: null,
		currency,
		listings: null,
		expiresOn: null,
		maxRedemptions: null,
		perAccount: 1,
	};
}

/** Minor units per major unit for a currency (JPY 1, GBP 100), from the platform's own formatter. */
function minorPerMajor(currency: string): number {
	try {
		const digits = new Intl.NumberFormat("en", { style: "currency", currency })
			.resolvedOptions().maximumFractionDigits ?? 2;
		return 10 ** digits;
	} catch {
		return 100;
	}
}

/** The draft as the API's input, or the field errors that stop it. An expiry ends that day. */
export function draftToPromoInput(
	draft: PromoDraft,
	nowMs: number,
): { ok: true; input: SavePromoCode } | { ok: false; errors: Record<string, string> } {
	const errors: Record<string, string> = {};
	const code = draft.code.trim().toUpperCase();
	if (!PROMO_CODE_PATTERN.test(code)) errors.code = "Use 4 to 40 letters, digits or hyphens.";
	const label = draft.label.trim();
	if (!label) errors.label = "Name the code.";
	if (
		draft.kind === "percent" && (draft.percent === null || draft.percent < 1 || draft.percent > 100)
	) {
		errors.percent = "Choose 1% to 100%.";
	}
	const amountMinor = draft.amount === null
		? null
		: Math.round(draft.amount * minorPerMajor(draft.currency));
	if (draft.kind === "flat" && (amountMinor === null || amountMinor < 1)) {
		errors.amountMinor = "Give the amount off.";
	}
	if (draft.listings !== null && draft.listings.length === 0) {
		errors.listings = "Choose at least one listing, or all of them.";
	}
	let expiresAt: string | null = null;
	if (draft.expiresOn) {
		const end = new Date(draft.expiresOn);
		end.setHours(23, 59, 59, 0);
		if (end.getTime() <= nowMs) errors.expiresAt = "Choose a day from today on.";
		expiresAt = end.toISOString();
	}
	if (Object.keys(errors).length) return { ok: false, errors };
	return {
		ok: true,
		input: {
			code,
			label,
			kind: draft.kind,
			...(draft.kind === "percent"
				? { percent: Math.round(draft.percent!) }
				: { amountMinor: amountMinor!, currency: draft.currency }),
			...(draft.listings ? { listings: draft.listings } : {}),
			expiresAt,
			maxRedemptions: draft.maxRedemptions === null ? null : Math.round(draft.maxRedemptions),
			perAccount: draft.perAccount === null ? null : Math.round(draft.perAccount),
		},
	};
}
// #endregion
