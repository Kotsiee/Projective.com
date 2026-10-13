import {
	type EscrowLockStatus,
	type FundingNextAction,
	type FundingRollup,
	type FundingState,
	type FundingStatus,
	formatMoney,
	type InboundPaymentStatus,
	isSettledPaymentStatus,
} from "@projective/types/finance";
import { TicketStatus } from "@projective/types/projects";

/**
 * funding-state — THE derivation of a ticket's payment & work-start state (`PRODUCT_MANAGEMENT.md`
 * §3.6, root CLAUDE.md §8 Decisions #165–#167): is the money held, and may work start?
 *
 * Pure, and the only one: the board card, the overview, the stage and project roll-ups and the card
 * payment poll all call {@link deriveFundingState}, so no two surfaces can disagree about one ticket.
 *
 * The ticket's `payment_status` is the projects-side mirror the escrow functions keep in the same
 * transaction (`escrow_funded` on a hold, `needs_funding` on a refused one), so it answers on reads
 * that cannot see `finance.escrows` (Decision #68(a)). When the escrow row IS readable it wins.
 */

// #region Inputs
/** The ticket facts the derivation reads — straight off `projects.tickets` (+ the stage's price). */
export interface FundingTicketInput {
	status: TicketStatus;
	/** `projects.tickets.payment_status`, as stored. */
	paymentStatus: string;
	/** The purchasing gate: a title-only ticket can be neither priced for sale nor claimed. */
	hasDescription: boolean;
	/** What the hold takes: `COALESCE(tickets.unit_price_cents, project_stages.unit_price_cents)`. */
	amountMinor: number | null;
	currency: string;
	/**
	 * Paid for ahead of any claim: a PREPAID escrow is held and the claim binds its payee (Decision #197),
	 * so the ticket is Funded. Live reads see it as `escrow_funded`; the stub corpus sets this flag.
	 */
	paidAhead?: boolean;
}

/** The `projects.tickets` columns {@link fundingTicketOf} reads — every live read selects these. */
export interface FundingTicketRow {
	status: string | null;
	payment_status: string | null;
	text_description: string | null;
	unit_price_cents: number | string | null;
}

/** Postgres numerics arrive as strings through PostgREST. */
function minorOf(value: number | string | null | undefined): number | null {
	const n = typeof value === "string" ? Number(value) : value;
	return typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * One ticket row onto {@link FundingTicketInput}: the amount is what `fn_hold_ticket_escrow` takes —
 * the ticket's own rate, else its current stage's.
 */
export function fundingTicketOf(
	row: FundingTicketRow,
	stagePriceMinor: number | string | null | undefined,
	currency: string,
): FundingTicketInput {
	const status = TicketStatus.safeParse(row.status);
	return {
		status: status.success ? status.data : "backlog",
		paymentStatus: row.payment_status ?? "unpaid",
		hasDescription: (row.text_description ?? "").trim().length > 0,
		amountMinor: minorOf(row.unit_price_cents) ?? minorOf(stagePriceMinor),
		currency,
	};
}

/** The ticket's newest `finance.escrows` row, when the read can see it. */
export interface FundingEscrowInput {
	/** `finance.escrows.status`: `funded` · `held` · `released` · `refunded` · `disputed`. */
	status: string;
	amountMinor: number;
	currency: string;
}

/** The newest `escrow_lock` card payment for the ticket (or its stage), when there is one. */
export interface FundingPaymentInput {
	status: InboundPaymentStatus;
	lockStatus: EscrowLockStatus;
	lockError: string | null;
	failureReason: string | null;
}
// #endregion

// #region Derivation
/** The statuses in which somebody is working — entering one needs a held escrow (the DB gate). */
const WORK: ReadonlySet<TicketStatus> = new Set(["claimed", "in_progress", "in_review"]);

/** A dispute is a hold on the funds, not a state of this machine (§3.6 rule 4). */
const HELD_ESCROW: ReadonlySet<string> = new Set(["funded", "held", "disputed"]);

/** Resolve one ticket's funding state. Precedence: terminal money → held work → card payment → unfunded. */
export function deriveFundingState(
	ticket: FundingTicketInput,
	escrow: FundingEscrowInput | null = null,
	payment: FundingPaymentInput | null = null,
): FundingStatus {
	const amountMinor = escrow?.amountMinor ?? (ticket.amountMinor && ticket.amountMinor > 0 ? ticket.amountMinor : null);
	const currency = (escrow?.currency ?? ticket.currency).toUpperCase();
	const status = (
		state: FundingState,
		nextAction: FundingNextAction,
		reason: string | null = null,
	): FundingStatus => ({
		state,
		amountMinor,
		currency,
		amountLabel: amountMinor === null ? null : formatMoney(amountMinor, currency),
		canStart: state === "funded",
		nextAction,
		reason,
	});

	if (escrow?.status === "released" || ticket.paymentStatus === "released") return status("released", "none");
	// A refunded escrow on a ticket that was re-pooled is history: the ticket reads from its new facts.
	if (ticket.paymentStatus === "refunded" || (escrow?.status === "refunded" && ticket.status === "cancelled")) {
		return status("refunded", "none");
	}

	const held = escrow
		? HELD_ESCROW.has(escrow.status)
		: ticket.paymentStatus === "escrow_funded" || ticket.paidAhead === true;
	if (held) {
		if (ticket.status === "in_review") return status("in_review", "review");
		if (ticket.status === "in_progress") return status("in_progress", "submit");
		if (ticket.status === "completed") return status("released", "none");
		return status("funded", "start_work");
	}

	if (payment) {
		if (payment.status === "requires_payment" || payment.status === "processing") {
			return status("processing", "await_payment", "A card payment is being confirmed.");
		}
		if (payment.status === "failed") {
			return status("failed", "retry_payment", payment.failureReason ?? "The card payment didn't go through.");
		}
		if (isSettledPaymentStatus(payment.status) && payment.lockStatus === "failed") {
			return status(
				"failed",
				"retry_payment",
				payment.lockError ?? "The payment arrived but the escrow couldn't be held; the money is in the wallet.",
			);
		}
		if (isSettledPaymentStatus(payment.status) && payment.lockStatus === "pending") {
			return status("processing", "await_payment", "The payment arrived and the escrow is being held.");
		}
		// `canceled` (abandoned) and a lock that funded other tickets fall through to the ticket's own facts.
	}

	if (ticket.status === "completed" || ticket.status === "cancelled") return status("draft", "none");
	const fundAction: FundingNextAction = amountMinor === null ? "set_price" : "fund";
	// Work without a hold predates the gate; it is owed exactly what a refused hold is.
	if (ticket.paymentStatus === "needs_funding" || WORK.has(ticket.status)) {
		return status(
			"needs_funding",
			fundAction,
			amountMinor === null
				? "Price this ticket so its escrow can be held; work can't start until it is."
				: "The escrow couldn't be held, so work can't start until the ticket is funded.",
		);
	}
	if (!ticket.hasDescription) {
		return status("draft", "describe", "Add a description so this ticket can be funded and claimed.");
	}
	return status("draft", fundAction, amountMinor === null ? "Price this ticket so it can be funded." : null);
}
// #endregion

// #region Billing facts
/** The states in which an escrow is held — where "auto-funded" can describe how it got there. */
const HELD_STATES: ReadonlySet<FundingState> = new Set(["funded", "in_progress", "in_review"]);

/**
 * Overlay the business-billing facts on a derived state (PRODUCT_SPEC §Escrow, Wallets & Finance #4):
 * `autoFunded` when the held escrow came from the From-wallet queue, and `invoiceOn` when a released
 * escrow will be listed on the business's next monthly invoice — released inside the open billing
 * period, so not yet invoiced. Never changes the state itself.
 */
export function withBillingFacts(
	f: FundingStatus,
	facts: { autoFunded: boolean; releasedAt: string | null; invoicePeriod: { start: Date; end: Date } | null },
): FundingStatus {
	const autoFunded = facts.autoFunded && HELD_STATES.has(f.state);
	const released = facts.releasedAt ? Date.parse(facts.releasedAt) : NaN;
	const invoiceOn = f.state === "released" && facts.invoicePeriod && released >= facts.invoicePeriod.start.getTime()
		? INVOICE_DATE.format(facts.invoicePeriod.end)
		: null;
	return autoFunded || invoiceOn ? { ...f, autoFunded, invoiceOn } : f;
}

const INVOICE_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
// #endregion

// #region Card payment poll
/**
 * Where one escrow-lock card payment leaves its ticket, from the payment alone — what the poll answers
 * while the browser waits on the webhook. A settled, locked payment is a held escrow (Funded); one the
 * payer abandoned (`canceled`) is back to Needs funding, the §3.6 edge it leaves by.
 */
export function paymentFundingState(payment: {
	status: InboundPaymentStatus;
	lockStatus: EscrowLockStatus;
	lockError: string | null;
	failureReason: string | null;
	amountCents: number;
	currency: string;
}): FundingStatus {
	const locked = isSettledPaymentStatus(payment.status) && payment.lockStatus === "locked";
	return deriveFundingState(
		{
			status: "todo",
			paymentStatus: "needs_funding",
			hasDescription: true,
			amountMinor: payment.amountCents,
			currency: payment.currency,
		},
		locked ? { status: "held", amountMinor: payment.amountCents, currency: payment.currency } : null,
		payment,
	);
}
// #endregion

// #region Roll-up
/** Which ticket state a stage or project leads with: what needs somebody's attention first. */
const ATTENTION: readonly FundingState[] = [
	"failed",
	"needs_funding",
	"processing",
	"funded",
	"in_review",
	"in_progress",
	"draft",
	"released",
	"refunded",
];

/**
 * A stage's or a project's funding: the most urgent state among its tickets, with the amount summed
 * over the tickets in that state. `null` when there are no tickets to roll up.
 */
export function rollupFundingState(statuses: readonly FundingStatus[]): FundingRollup | null {
	const state = ATTENTION.find((s) => statuses.some((f) => f.state === s));
	if (!state) return null;
	const inState = statuses.filter((f) => f.state === state);
	const lead = inState[0];
	const priced = inState.filter((f) => f.amountMinor !== null);
	const amountMinor = priced.length > 0 ? priced.reduce((sum, f) => sum + (f.amountMinor ?? 0), 0) : null;
	return {
		...lead,
		amountMinor,
		amountLabel: amountMinor === null ? null : formatMoney(amountMinor, lead.currency),
		tickets: inState.length,
	};
}
// #endregion
