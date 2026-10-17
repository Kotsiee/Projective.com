import type { IconName } from "@ui/icons/core/paths.tsx";
import type { MetaLineEntry } from "@ui/display/core/meta-line.tsx";
import type {
	CheckoutBlocker,
	CheckoutBusinessGate,
	CheckoutResult,
	CheckoutSessionContext,
	CheckoutSpendRequest,
	PaymentProvider,
} from "@projective/types/finance";
import { workspaceHref } from "@projective/types/workspace";
import {
	BUSINESS_REFUSAL_COPY,
	type BusinessRefusalContext,
	CHECK_AGAIN_LABEL,
	SPEND_REQUEST_COPY,
} from "@features/workspaces/core/refusal-copy.ts";
import { walletIntentHref } from "@features/wallet/core/wallet-intent.ts";

/**
 * business-gate — what a business checkout says about its refusal, and the ONE way forward it offers
 * (BP2, Decision #243). A pure view-model: the payment island renders it, the unit tests pin it, and
 * the same session always yields the same view, so the server's first paint and hydration agree.
 *
 * Every sentence comes from the business refusal map (`refusal-copy.ts`). The way forward follows the
 * order the database refuses in — an inactive business, KYB, the purchasing right, the pool's balance,
 * then the spend gate — and is never a link to `/spend`: a needs-approval order is asked for HERE,
 * bound to the basket, and redeemed by the next Pay. Each view carries at most one control:
 *
 *  - `request` — tier-3 "Request approval", which opens the reason dialog;
 *  - `add_money` — tier-1 "Add money", the business wallet's top-up, returning to this checkout
 *    (Decision #230 (c) [1]: a short pool is refused, never made up from a personal card);
 *  - `verify` — tier-4 link to the business's Verification module, for a `startKyb` holder;
 *  - `check_again` — the notice's own text action, re-reading a pending request.
 *
 * A member who holds no such control reads `ask` instead: who to ask, and for what.
 */

// #region Types
/** What the gate is about. `pending` / `approved` are the member's own request for this basket. */
export type BusinessGateKind =
	| "business_not_active"
	| "kyb_required"
	| "purchase"
	| "pool_short"
	| "over_limit"
	| "needs_approval"
	| "pending"
	| "approved";

/** The one control a gate offers. */
export type BusinessGateAction =
	| { type: "request"; label: string }
	| { type: "add_money"; href: string; label: string }
	| { type: "verify"; href: string; label: string }
	| { type: "check_again"; label: string };

/** A business checkout's gate, ready to render. */
export interface BusinessGateView {
	kind: BusinessGateKind;
	icon: IconName;
	/** The refusal (or the request's state) in one plain sentence. */
	sentence: string;
	/** Facts beside it — the amount asked for, the expiry, the last request's fate. */
	meta: MetaLineEntry[];
	action: BusinessGateAction | null;
	/** What to ask for, and of whom, when the member holds no control; `null` otherwise. */
	ask: string | null;
}

/** The session facts a gate reads. */
export type GateSession = Pick<
	CheckoutSessionContext,
	"owner" | "wallet" | "spendLimit" | "businessAccount" | "blockers" | "totals" | "charge"
>;

/** Props-like input for {@link businessGateOf}. */
export interface BusinessGateInput {
	session: GateSession;
	/** The route the buyer has chosen; `null` while none is available. */
	provider: PaymentProvider | null;
	/** The last Pay attempt, whose refusal may name a gate the pre-flight could not foresee. */
	lastResult: Pick<CheckoutResult, "status" | "blockers"> | null;
	/** This checkout step's own address — where "Add money" returns to. */
	returnHref: string;
}
// #endregion

// #region Context
/**
 * The refusal map's context for this session: the business, who approves, the member's remaining
 * envelope (only when the CAP is what the order outruns — a per-transaction ceiling leaves a cap with
 * room, and "you have $17,000 left" would then explain nothing), the pool's shortfall and KYB state.
 */
export function refusalContextOf(session: GateSession): BusinessRefusalContext {
	const limit = session.spendLimit;
	const capped = limit.remaining !== null && limit.remaining.minor < session.totals.total.minor;
	return {
		business: session.owner.name,
		approvers: session.businessAccount?.approvers ?? [],
		remaining: capped ? limit.remaining?.display ?? null : null,
		period: capped ? limit.periodLabel : null,
		shortfall: session.wallet.covers ? null : session.wallet.shortfall.display,
		kybStatus: session.businessAccount?.kybStatus ?? null,
		managesMembers: session.businessAccount?.canManageMembers ?? false,
	};
}

/** Every business gate standing now: the session's blockers, then the last refused attempt's. */
function gatesOf(
	session: GateSession,
	lastResult: BusinessGateInput["lastResult"],
): Set<CheckoutBusinessGate> {
	const blockers = [
		...session.blockers,
		...(lastResult?.status === "failed" ? lastResult.blockers : []),
	];
	return new Set(blockers.flatMap((b) => (b.gate ? [b.gate] : [])));
}

const SPEND_GATES: ReadonlySet<CheckoutBusinessGate> = new Set(["over_limit", "needs_approval"]);

/** The line a previous request leaves beside a fresh refusal. */
function historyOf(request: CheckoutSpendRequest | null, total: string): MetaLineEntry[] {
	if (!request) return [];
	switch (request.state) {
		case "declined":
			return [SPEND_REQUEST_COPY.declined({ decidedBy: request.decidedBy })];
		case "expired":
			return [SPEND_REQUEST_COPY.expired({})];
		case "approved":
			return request.covers
				? []
				: [SPEND_REQUEST_COPY.approvedShort({ amount: request.amount.display, total })];
		default:
			return [];
	}
}
// #endregion

// #region The gate
/**
 * The gate a business checkout shows, or `null` when there is none — always `null` for a personal,
 * team or enterprise checkout, and for anyone not buying as a member of the business.
 */
export function businessGateOf(input: BusinessGateInput): BusinessGateView | null {
	const { session, provider, lastResult, returnHref } = input;
	const account = session.businessAccount;
	if (session.owner.ownerType !== "business" || account === null) return null;
	const ctx = refusalContextOf(session);
	const gates = gatesOf(session, lastResult);

	if (gates.has("business_not_active")) {
		const copy = BUSINESS_REFUSAL_COPY.business_not_active;
		return {
			kind: "business_not_active",
			icon: "lock",
			sentence: copy.sentence(ctx),
			meta: [],
			action: null,
			ask: copy.ask(ctx),
		};
	}

	if (
		gates.has("kyb_required") || (account.kybStatus !== null && account.kybStatus !== "verified")
	) {
		const copy = BUSINESS_REFUSAL_COPY.kyb_required;
		const href = session.owner.handle
			? workspaceHref("business", session.owner.handle, "verification")
			: null;
		const verify = account.canStartKyb && href !== null;
		return {
			kind: "kyb_required",
			icon: "shield",
			sentence: copy.sentence(ctx),
			meta: [],
			action: verify
				? { type: "verify", href, label: copy.action?.(ctx) ?? "See verification" }
				: null,
			ask: verify ? null : copy.ask(ctx),
		};
	}

	if (gates.has("purchase")) {
		const copy = BUSINESS_REFUSAL_COPY.purchase;
		return {
			kind: "purchase",
			icon: "lock",
			sentence: copy.sentence(ctx),
			meta: [],
			action: null,
			ask: copy.ask(ctx),
		};
	}

	// The database refuses the balance before the spend gate (`place_wallet_order`), so a short pool is
	// said first. A business card or the on-account route pays without the pool, so it is not short then.
	if (!session.wallet.covers && (provider === "wallet" || provider === null)) {
		const copy = BUSINESS_REFUSAL_COPY.pool_short;
		const add = account.canAddFunds;
		return {
			kind: "pool_short",
			icon: "wallet",
			sentence: copy.sentence(ctx),
			meta: [],
			action: add
				? {
					type: "add_money",
					href: walletIntentHref(`business:${session.owner.ownerId}`, "top_up", returnHref),
					label: copy.action?.(ctx) ?? "Add money",
				}
				: null,
			ask: add ? null : copy.ask(ctx),
		};
	}

	// The spend gate stands when the pre-flight says so or a refused Pay named it. A request is shown
	// only while it does: one left pending for an order that no longer needs approval holds nothing.
	const limit = session.spendLimit;
	const request = limit.request;
	const spend = limit.gate && SPEND_GATES.has(limit.gate)
		? limit.gate
		: gates.has("over_limit")
		? "over_limit"
		: gates.has("needs_approval")
		? "needs_approval"
		: null;
	if (spend !== null && request?.state === "pending") {
		return {
			kind: "pending",
			icon: "hourglass",
			sentence: SPEND_REQUEST_COPY.pending({ approvers: account.approvers }),
			meta: [{ text: request.amount.display, tabular: true }, request.expiresLabel ?? ""],
			action: { type: "check_again", label: CHECK_AGAIN_LABEL },
			ask: null,
		};
	}
	if (limit.approved && request?.state === "approved") {
		return {
			kind: "approved",
			icon: "check",
			sentence: SPEND_REQUEST_COPY.approved({ decidedBy: request.decidedBy }),
			meta: [{ text: request.amount.display, tabular: true }, request.expiresLabel ?? ""],
			action: null,
			ask: null,
		};
	}

	if (spend === "over_limit" || spend === "needs_approval") {
		const copy = BUSINESS_REFUSAL_COPY[spend];
		// Nobody else can decide it (Decision #239 flag (e)): no request nobody could approve.
		const canRequest = account.approvers.length > 0;
		return {
			kind: spend,
			icon: "shield",
			sentence: copy.sentence(ctx),
			meta: historyOf(request, (session.charge ?? session.totals.total).display),
			action: canRequest
				? { type: "request", label: copy.action?.(ctx) ?? "Request approval" }
				: null,
			ask: canRequest ? null : copy.ask(ctx),
		};
	}
	return null;
}
// #endregion

// #region Blockers the gate speaks for
const OWNS: Readonly<Record<BusinessGateKind, readonly CheckoutBusinessGate[]>> = {
	business_not_active: ["business_not_active"],
	kyb_required: ["kyb_required"],
	purchase: ["purchase"],
	pool_short: [],
	over_limit: ["over_limit", "needs_approval"],
	needs_approval: ["over_limit", "needs_approval"],
	pending: ["over_limit", "needs_approval"],
	approved: ["over_limit", "needs_approval"],
};

/**
 * Whether the gate already says what this blocker says, so the blocker list leaves it out — one
 * refusal, one wording. A short pool also speaks for the account-wide "no route" and "not enough"
 * refusals it explains.
 */
export function ownedByGate(view: BusinessGateView | null, blocker: CheckoutBlocker): boolean {
	if (!view) return false;
	if (blocker.gate) return OWNS[view.kind].includes(blocker.gate);
	return view.kind === "pool_short" && blocker.itemId === null &&
		(blocker.code === "no_provider" || blocker.code === "insufficient_funds");
}

/**
 * A blocker's sentence: the refusal map's for a business refusal — "Waiting for approval…" while the
 * member's request is pending — else the server's own.
 */
export function gatedSentence(blocker: CheckoutBlocker, session: GateSession): string {
	if (!blocker.gate || session.owner.ownerType !== "business") return blocker.message;
	const ctx = refusalContextOf(session);
	if (SPEND_GATES.has(blocker.gate) && session.spendLimit.request?.state === "pending") {
		return SPEND_REQUEST_COPY.pending({ approvers: ctx.approvers });
	}
	return BUSINESS_REFUSAL_COPY[blocker.gate].sentence(ctx);
}

/** A refused attempt as the outcome panel says it: one headline, then the reasons it does not repeat. */
export interface RefusalLines {
	headline: string;
	reasons: { blocker: CheckoutBlocker; sentence: string }[];
}

/**
 * The outcome panel's words for an attempt. When a business checkout's attempt was refused by a
 * business gate, the headline IS that refusal, worded from the map, and it leaves the reasons — the
 * server's raw sentence and the map's are never read out one after the other. Anything else keeps
 * the server's message, with every reason worded by {@link gatedSentence}.
 */
export function refusalLines(
	result: Pick<CheckoutResult, "status" | "message" | "blockers">,
	session: GateSession | null,
): RefusalLines {
	const reasons = result.blockers.map((blocker) => ({
		blocker,
		sentence: session ? gatedSentence(blocker, session) : blocker.message,
	}));
	const first = reasons[0];
	if (
		result.status !== "failed" || !first?.blocker.gate || session?.owner.ownerType !== "business"
	) {
		return { headline: result.message, reasons };
	}
	return { headline: first.sentence, reasons: reasons.slice(1) };
}

/**
 * Whether the gate's control is a FILL — Request approval (tier 3) or Add money (tier 1). The rail's
 * Buy Now then leaves the DOM, as it does while a card step is pending (DESIGN_SYSTEM §B.8.2): one
 * filled action per decision region, and a disabled amber Pay beside the way forward is a second.
 */
export function gateTakesCommit(view: BusinessGateView | null): boolean {
	return view?.action?.type === "request" || view?.action?.type === "add_money";
}
// #endregion
