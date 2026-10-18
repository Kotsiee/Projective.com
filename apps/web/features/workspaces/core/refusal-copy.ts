import type { BusinessAuthorityReason } from "@projective/types/workspace";
import type { SpendGateReason } from "@projective/types/finance";

/**
 * refusal-copy — the ONE map from a business refusal code to what a member reads (BU6 step 4,
 * Decision #243): the sentence, the label of the control that is its way forward, and what to ask
 * for when the member holds no such control.
 *
 * Every business surface words its refusals from here — the checkout's needs-approval flow, the
 * console's Overview and Finance branches, the Verification module — so one refusal reads as one
 * sentence wherever it is met. The codes are the database's: the business-authority reasons
 * (`hire`, `purchase`, `manage_projects`, `not_funder` — Decision #237), the spend gate's
 * (`kyb_required`, `over_limit`, `needs_approval` — #240), `business_not_active` (#236) and the plan
 * gate's `entitlement` (#230 (e)); `pool_short` is the pooled wallet holding less than an order needs
 * (#230 (c)), which the database refuses as a balance, not as a gate.
 *
 * A LEAF on purpose: type-only imports, no registry, no glyphs, no stylesheet — a checkout island
 * imports it without pulling the console into its bundle, and `deno test` can load it.
 */

// #region Codes
/** Every business refusal code this map words. */
export const BUSINESS_REFUSAL_CODES = [
	"hire",
	"purchase",
	"manage_projects",
	"not_funder",
	"kyb_required",
	"over_limit",
	"needs_approval",
	"business_not_active",
	"entitlement",
	"pool_short",
] as const satisfies readonly (
	| BusinessAuthorityReason
	| SpendGateReason
	| "business_not_active"
	| "entitlement"
	| "pool_short"
)[];

/** A business refusal code. */
export type BusinessRefusalCode = (typeof BUSINESS_REFUSAL_CODES)[number];

/** Whether a string is a business refusal code this map words. */
export function isBusinessRefusalCode(code: string): code is BusinessRefusalCode {
	return (BUSINESS_REFUSAL_CODES as readonly string[]).includes(code);
}
// #endregion

// #region Context
/**
 * What a refusal's sentence may name. Every field is optional: a sentence missing one reads in its
 * general form rather than printing a gap. Figures arrive server-formatted (`MoneyView.display`).
 */
export interface BusinessRefusalContext {
	/** The business's name. */
	business?: string | null;
	/** Who can approve the member's spend, owner first. */
	approvers?: readonly string[];
	/** What is left of the member's envelope (`"$1,700.00"`). */
	remaining?: string | null;
	/** The envelope's window as a phrase (`"this month"`). */
	period?: string | null;
	/** By how much the pooled wallet falls short of the order (`"$120.00"`). */
	shortfall?: string | null;
	/** The business's KYB state (`pending`, `rejected`, …). */
	kybStatus?: string | null;
	/**
	 * Whether the reader manages the business's members (the owner): the one who adds an approver, so
	 * "ask the owner" would send them to themselves.
	 */
	managesMembers?: boolean;
}

/** One refusal's words. */
export interface RefusalCopy {
	/** What happened, in one plain sentence. */
	sentence(ctx: BusinessRefusalContext): string;
	/** The label of the control that is the way forward, or `null` when there is no control. */
	action: ((ctx: BusinessRefusalContext) => string) | null;
	/** What a member who holds no such control should ask for, and of whom. */
	ask(ctx: BusinessRefusalContext): string;
}
// #endregion

// #region Helpers
function nameOf(ctx: BusinessRefusalContext): string | null {
	const name = ctx.business?.trim();
	return name ? name : null;
}

/** "Helia Finance's" · "Atlas Labs'" — the possessive of a name, without a doubled s. */
export function possessive(name: string): string {
	return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

/**
 * The approvers as a phrase: "Priya Raman" · "Priya Raman or Hannah Cole" · "A, B or C" ·
 * "A, B or 3 others". Empty when there are none.
 */
export function approverList(names: readonly string[] | undefined): string {
	const list = (names ?? []).map((n) => n.trim()).filter(Boolean);
	if (list.length <= 1) return list[0] ?? "";
	if (list.length <= 3) return `${list.slice(0, -1).join(", ")} or ${list[list.length - 1]}`;
	return `${list.slice(0, 2).join(", ")} or ${list.length - 2} others`;
}

/**
 * Nobody but the reader can decide their request — and nobody approves their own. The owner is told
 * where to add an approver; everyone else, to ask the owner for one.
 */
const NO_APPROVER = (ctx: BusinessRefusalContext): string => {
	const name = nameOf(ctx) ?? "this business";
	return ctx.managesMembers
		? `Nobody else at ${name} can approve spending yet. Give a member approval rights in Members.`
		: `Nobody else at ${name} can approve spending yet. Ask the owner to add an approver.`;
};
// #endregion

// #region The map
/** Every business refusal, worded once (Decision #243). */
export const BUSINESS_REFUSAL_COPY: Readonly<Record<BusinessRefusalCode, RefusalCopy>> = {
	hire: {
		sentence: (ctx) => {
			const name = nameOf(ctx);
			return name
				? `You need the hiring permission at ${name} to do that.`
				: "You need the business's hiring permission to do that.";
		},
		action: null,
		ask: () => "Ask the owner or an admin for the hiring permission.",
	},
	purchase: {
		sentence: (ctx) => {
			const name = nameOf(ctx);
			return name
				? `You need the purchasing permission at ${name} to buy with its wallet.`
				: "You need the business's purchasing permission to buy with its wallet.";
		},
		action: null,
		ask: () => "Ask the owner or an admin for the purchasing permission.",
	},
	manage_projects: {
		sentence: (ctx) => {
			const name = nameOf(ctx);
			return name
				? `You need the project permission at ${name} to start a project billed to it.`
				: "You need the business's project permission to start a project billed to it.";
		},
		action: null,
		ask: () => "Ask the owner or an admin for the project permission.",
	},
	not_funder: {
		sentence: (ctx) => {
			const name = nameOf(ctx);
			return name
				? `Only a member who can spend from ${possessive(name)} wallet can fund this.`
				: "Only a member who can spend from the client's wallet can fund this.";
		},
		action: null,
		ask: () => "Ask someone who can spend from the wallet to fund it.",
	},
	kyb_required: {
		sentence: (ctx) => {
			const name = nameOf(ctx);
			if (ctx.kybStatus === "pending") {
				return `${
					name ? possessive(name) : "This business's"
				} verification is still in review. You can pay once it clears.`;
			}
			if (ctx.kybStatus === "rejected" || ctx.kybStatus === "expired") {
				return `${
					name ? possessive(name) : "This business's"
				} verification needs attention before its wallet can pay for anything.`;
			}
			return `${
				name ?? "This business"
			} needs to be verified before its wallet can pay for anything.`;
		},
		action: (ctx) => {
			if (ctx.kybStatus === "pending") return "See verification";
			const name = nameOf(ctx);
			return name ? `Verify ${name}` : "Verify the business";
		},
		ask: () => "Ask the owner to verify the business.",
	},
	over_limit: {
		sentence: (ctx) => {
			const remaining = ctx.remaining?.trim();
			if (remaining) {
				const period = ctx.period?.trim();
				return `This order is over your spending limit. You have ${remaining} left${
					period ? ` ${period}` : ""
				}.`;
			}
			const name = nameOf(ctx);
			return `This order is over your spending limit at ${name ?? "this business"}.`;
		},
		action: () => "Request approval",
		ask: NO_APPROVER,
	},
	needs_approval: {
		sentence: (ctx) => {
			const who = approverList(ctx.approvers);
			return who
				? `This order needs approval from ${who}.`
				: "This order needs approval before it can be placed.";
		},
		action: () => "Request approval",
		ask: NO_APPROVER,
	},
	business_not_active: {
		sentence: (ctx) =>
			`${nameOf(ctx) ?? "This business"} isn't active, so it can't buy, hire or pay yet.`,
		action: null,
		ask: () => "Ask the owner to publish or restore it in the business settings.",
	},
	entitlement: {
		sentence: (ctx) =>
			`That's part of Business Pro, which ${nameOf(ctx) ?? "this business"} isn't on.`,
		action: () => "See plans",
		ask: () => "Ask the owner about upgrading to Business Pro.",
	},
	pool_short: {
		sentence: (ctx) => {
			const name = nameOf(ctx);
			const wallet = name ? `${possessive(name)} wallet` : "The business wallet";
			const shortfall = ctx.shortfall?.trim();
			return shortfall
				? `${wallet} is ${shortfall} short for this order.`
				: `${wallet} doesn't hold enough for this order.`;
		},
		action: () => "Add money",
		ask: () => "Ask someone who can add money to top up the business wallet.",
	},
};
// #endregion

// #region Spend requests
/** The states of a member's own spend request, as the checkout words them. */
export type SpendRequestCopyState =
	| "pending"
	| "approved"
	| "approvedShort"
	| "declined"
	| "expired";

/** What a spend-request sentence may name. */
export interface SpendRequestCopyContext {
	/** Who can decide it, owner first. */
	approvers?: readonly string[];
	/** Who approved or declined it. */
	decidedBy?: string | null;
	/** The amount the request was filed for (`"$24.00"`). */
	amount?: string | null;
	/** What the order totals now (`"$48.00"`). */
	total?: string | null;
}

/** The label of the control that re-reads a pending request. */
export const CHECK_AGAIN_LABEL = "Check again";

/** A member's own spend request, worded once (Decision #243). */
export const SPEND_REQUEST_COPY: Readonly<
	Record<SpendRequestCopyState, (ctx: SpendRequestCopyContext) => string>
> = {
	pending: (ctx) => {
		const who = approverList(ctx.approvers);
		return who ? `Waiting for approval from ${who}.` : "Waiting for approval.";
	},
	approved: (ctx) => {
		const by = ctx.decidedBy?.trim();
		return `Approved${by ? ` by ${by}` : ""}. Placing this order uses the approval.`;
	},
	approvedShort: (ctx) => {
		const amount = ctx.amount?.trim();
		const total = ctx.total?.trim();
		return amount && total
			? `The approval covers ${amount}, but this order is now ${total}.`
			: "The approval no longer covers this order.";
	},
	declined: (ctx) => {
		const by = ctx.decidedBy?.trim();
		return by ? `${by} declined your last request.` : "Your last request was declined.";
	},
	expired: () => "Your last request expired before it was used.",
};
// #endregion
