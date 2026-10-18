import type {
	CheckoutBlocker,
	CheckoutBusinessGate,
	PurchaseOwnerType,
} from "@projective/types/finance";
import { SpendApprovalRefSchema } from "@projective/types/finance";
import {
	BUSINESS_NOT_ACTIVE_REASON,
	type BusinessAuthorityReason,
} from "@projective/types/workspace";
import { AGE_RESTRICTED, isAgeRestricted } from "../../core/age-gate.ts";
import { spendGateReason } from "../../core/spend-gate.ts";

/**
 * checkout-refusal — how a database refusal at Pay becomes a checkout blocker, so the surface explains
 * a refusal the same way whether the app's pre-flight or the database caught it.
 *
 * A business refusal carries its `gate` (Decision #243): the business screens word it from their one
 * refusal map and offer its way forward — "Request approval" bound to the basket for `needs_approval`
 * / `over_limit`, the verification path for `kyb_required`, nothing for a draft or archived business.
 * Pure: no I/O, so every mapping is unit-tested.
 */

// #region SQLSTATE map
/**
 * The blocker a wallet-order refusal maps to, by the SQLSTATE `finance.place_wallet_order` /
 * `finance.place_on_account_order` raise. `55000` is deliberately absent: only its
 * `business_not_active:` form is a checkout refusal ({@link refusalBlocker}); any other `55000` is a
 * fault, not a sentence for a buyer.
 */
export const BLOCKER_FOR_SQLSTATE: Readonly<Record<string, CheckoutBlocker["code"]>> = {
	"42501": "not_authorised",
	PK403: "verification_required",
	PC409: "price_changed",
	PB404: "price_changed",
	PD422: "missing_email",
	PU422: "unavailable_item",
	PS501: "no_provider",
	PF402: "insufficient_funds",
	PA403: "spend_limit",
	PM403: "not_authorised",
};

/** The SQLSTATE a draft or archived business's door refuses with (`org.fn_assert_business_active`). */
const NOT_ACTIVE_SQLSTATE = "55000";
// #endregion

// #region Mapping
/** The parts of a PostgREST error a checkout refusal reads. */
export interface CheckoutRefusalError {
	code?: string;
	message: string;
	details?: string | null;
}

// `kyb_required: …` · `over_limit: …` · `needs_approval: …` · `business_not_active: …` — always lower
// case, so a sentence that merely opens with a capitalised word and a colon keeps it.
const PREFIX = /^(?:ERROR:\s*)?([a-z_]+):\s*/;

function prefixOf(message: string): string | null {
	return PREFIX.exec(message)?.[1] ?? null;
}

/** The refusal's own sentence, its sub-code prefix removed and its first letter raised. */
function sentenceOf(message: string): string {
	const sentence = message.replace(PREFIX, "").replace(/\s+/g, " ").trim();
	return sentence
		? `${sentence[0].toUpperCase()}${sentence.slice(1)}`.slice(0, 200)
		: "That didn't go through.";
}

/**
 * The business gate behind a refusal, or `undefined`. A PA403 names its gate in its prefix (a team's
 * un-prefixed PA403 is not the business gate). A PK403 is KYB when it says so, and — on a business
 * basket — when it says nothing, because `place_wallet_order` raises its early KYB refusal un-prefixed;
 * a PK403 with any other prefix (`missing_permission:`) is the authority check's, not KYB.
 */
function gateOf(
	error: CheckoutRefusalError,
	ownerType: PurchaseOwnerType,
): CheckoutBusinessGate | undefined {
	if (error.code === "PA403") return spendGateReason(error) ?? undefined;
	if (error.code === "PK403") {
		const prefix = prefixOf(error.message);
		if (prefix === "kyb_required") return "kyb_required";
		if (prefix === null && ownerType === "business") return "kyb_required";
	}
	return undefined;
}

/**
 * The blocker a wallet-order refusal becomes, under the code the caller mapped it to. The spend gate
 * raises `<sub_code>: <sentence>`; the reader sees the sentence. A `spend_limit` refusal carries the
 * ref an approval must be filed against — the one the redeemer named in its DETAIL, else this basket —
 * so the surface can offer "Request approval" bound to this charge.
 */
export function orderRefusal(
	code: CheckoutBlocker["code"],
	error: CheckoutRefusalError,
	basketId: string,
	ownerType: PurchaseOwnerType,
): CheckoutBlocker {
	if (isAgeRestricted(error)) return { code, message: AGE_RESTRICTED.message, itemId: null };
	const message = sentenceOf(error.message);
	const gate = gateOf(error, ownerType);
	if (code !== "spend_limit") return { code, message, itemId: null, ...(gate ? { gate } : {}) };
	let detail: unknown = null;
	try {
		detail = error.details ? JSON.parse(error.details) : null;
	} catch {
		detail = null;
	}
	const named = SpendApprovalRefSchema.safeParse({
		refTable: (detail as { ref_table?: unknown } | null)?.ref_table,
		refId: (detail as { ref_id?: unknown } | null)?.ref_id,
	});
	return {
		code,
		message,
		itemId: null,
		approvalRef: named.success ? named.data : { refTable: "baskets", refId: basketId },
		...(gate ? { gate } : {}),
	};
}

/**
 * The blocker any refusal from a payment function becomes, or `null` when it is not a refusal a
 * buyer can act on (the caller then throws, and the route answers 503). A draft or archived business's
 * `55000 business_not_active:` is `not_authorised` with the `business_not_active` gate (Decision #236
 * flag (e), #243); any other `55000` stays a fault.
 */
export function refusalBlocker(
	error: CheckoutRefusalError,
	basketId: string,
	ownerType: PurchaseOwnerType,
	fallback?: CheckoutBlocker["code"],
): CheckoutBlocker | null {
	if (error.code === NOT_ACTIVE_SQLSTATE) {
		if (prefixOf(error.message) !== BUSINESS_NOT_ACTIVE_REASON) return null;
		return {
			code: "not_authorised",
			message: sentenceOf(error.message),
			itemId: null,
			gate: "business_not_active",
		};
	}
	const code = BLOCKER_FOR_SQLSTATE[error.code ?? ""] ?? fallback;
	return code ? orderRefusal(code, error, basketId, ownerType) : null;
}

/**
 * A business-authority refusal (BB2) as a blocker: `not_authorised`, and the `purchase` gate when the
 * missing right is the purchasing one — the only authority a checkout asks for.
 */
export function authorityBlocker(
	reason: BusinessAuthorityReason,
	message: string,
): CheckoutBlocker {
	return {
		code: "not_authorised",
		message: message.slice(0, 200),
		itemId: null,
		...(reason === "purchase" ? { gate: "purchase" as const } : {}),
	};
}
// #endregion
