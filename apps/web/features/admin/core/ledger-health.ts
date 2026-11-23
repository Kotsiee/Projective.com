import type { AlertDeliveryView, AlertsRead } from "@projective/types/ops";
import type {
	AmlRoundTripRelation,
	AmlSignalKind,
	AmlSignalsRead,
	AmlSignalView,
	ConservationCurrency,
	EscrowAge,
	EscrowAgeKind,
	LedgerConservation,
	LedgerDrift,
	LedgerSectionId,
} from "@projective/types/finance";

/**
 * ledger-health — the pure, DOM-free model behind the operator ledger page (`/admin/ledger`, FBP DB16;
 * Decision #337, ruling M2 (A)). The page is a list of sections, each filled by one
 * `LedgerHealthService` read in the controller; this names them, groups the identity's terms for
 * reading, and words the escrow-age kinds (MR7, Decision #473). Figures stay integer minor units in
 * their own currency: the island prints them with `MoneyView exact`, never converted.
 */

// #region Sections
/** One section as the controller read it: its data, or the sentence its read failed with. */
export type LedgerSectionResult =
	| { id: "conservation"; ok: true; data: LedgerConservation }
	| { id: "drift"; ok: true; data: LedgerDrift }
	| { id: "escrow_age"; ok: true; data: EscrowAge }
	| { id: "alerts"; ok: true; data: AlertsRead }
	| { id: "aml_signals"; ok: true; data: AmlSignalsRead }
	| { id: LedgerSectionId; ok: false; message: string };

/** Each section's heading and the one sentence that says what it is for. */
export const LEDGER_SECTION_COPY: Record<LedgerSectionId, { title: string; lede: string }> = {
	conservation: {
		title: "Conservation",
		lede:
			"In each currency, what came in from outside less what went back out must equal what the platform holds, plus the fees it kept, less its losses. Checked every night after the reconciliation; nothing here corrects anything.",
	},
	drift: {
		title: "Wallet drift",
		lede:
			"Wallets whose cached balance, ledger or pots disagree, and conversions whose ledger legs do not add up, as they stand now.",
	},
	escrow_age: {
		title: "Escrow age",
		lede:
			"How long held money has sat in the platform's Stripe balance, by what it is waiting on. The counsel brief on ruling M2 turns on these figures.",
	},
	alerts: {
		title: "Alerts",
		lede:
			"Every money error, a job that failed or stopped running, a webhook that keeps failing, and a nightly check gone silent reach a person within minutes: by webhook, by email and as a notice to every operator. The same problem alerts once per window.",
	},
	aml_signals: {
		title: "AML signals",
		lede:
			"Patterns the money doors recorded for the AML-ready posture: one person on both sides of an escrow, card money withdrawn soon after it came in, and withdrawals the Safety Hold refused. A signal is a fact to read, not a finding about anyone; the person never sees it, and there is nothing to act on here.",
	},
};
// #endregion

// #region Conservation
/** A currency's lifecycle status, as one toned Tag: balanced or out of balance. */
export function conservationStatus(row: { imbalanceMinor: number }): {
	label: string;
	tone: "success" | "danger";
} {
	return row.imbalanceMinor === 0
		? { label: "Balanced", tone: "success" }
		: { label: "Out of balance", tone: "danger" };
}

/** One named term of the identity, in minor units of its currency. */
export interface ConservationTerm {
	label: string;
	minor: number;
}

/** One side of the identity: its total and the terms it sums, zero terms left out. */
export interface ConservationGroup {
	label: string;
	totalMinor: number;
	terms: ConservationTerm[];
}

function group(label: string, terms: ConservationTerm[]): ConservationGroup {
	return {
		label,
		totalMinor: terms.reduce((sum, t) => sum + t.minor, 0),
		terms: terms.filter((t) => t.minor !== 0),
	};
}

/**
 * The identity's five groups for one currency, in the order the equation reads: in − out = held +
 * fees − losses. Pure; pinned by `ledger-health.test.ts`.
 */
export function conservationGroups(row: ConservationCurrency): ConservationGroup[] {
	return [
		group("In", [
			{ label: "card payments", minor: row.inCashMinor },
			{ label: "on account", minor: row.inOnAccountMinor },
			{ label: "converted in", minor: row.inFxMinor },
		]),
		group("Out", [
			{ label: "payouts", minor: row.outPayoutsMinor },
			{ label: "card refunds", minor: row.outCardRefundsMinor },
			{ label: "lost chargebacks", minor: row.outChargebacksMinor },
			{ label: "invoices paid", minor: row.outInvoicesMinor },
			{ label: "converted out", minor: row.outFxMinor },
		]),
		group("Held", [
			{ label: "wallets", minor: row.heldWalletsMinor },
			{ label: "escrow", minor: row.heldEscrowsMinor },
			{ label: "pending releases", minor: row.heldPendingMinor },
		]),
		group("Fees kept", [
			{ label: "escrow fees", minor: row.feesEscrowsMinor },
			{ label: "order commission", minor: row.feesOrdersMinor },
			{ label: "FX spread", minor: row.feesFxMinor },
		]),
		group("Losses", [
			{ label: "unrecovered chargebacks", minor: row.lossesChargebacksMinor },
			{ label: "unrecovered refunds", minor: row.lossesCardRefundsMinor },
			{ label: "platform promo codes", minor: row.lossesPromosMinor },
		]),
	];
}

/** How many of the 30-night rows are imbalances. */
export function imbalancedNights(data: LedgerConservation): number {
	return data.nights.filter((n) => !n.balanced).length;
}
// #endregion

// #region Escrow age
/** What each kind of held money is, and the clock that ends it (00001200 "Escrow age"). */
export const ESCROW_AGE_KIND_COPY: Record<EscrowAgeKind, { label: string; clock: string }> = {
	held_bound: { label: "Held for a named payee", clock: "ends at approval; no timer yet" },
	held_prepaid: { label: "Prepaid, nobody has claimed it", clock: "the prepaid TTL refunds it" },
	held_seat: { label: "Held for a session seat", clock: "released after its sitting" },
	reserved: { label: "Reserved for a later stage", clock: "no clock" },
	disputed: { label: "Frozen by a dispute", clock: "ends at the ruling" },
	pending: { label: "Released, in the pending window", clock: "the 7-day window" },
	on_hold: { label: "Pending, frozen by a dispute", clock: "ends at the ruling" },
};

/** An age in days to one decimal, as the database rounds it ("9.9 d"). */
export function daysText(days: number): string {
	return `${days.toFixed(1)} d`;
}
// #endregion

// #region Alerts
/** A delivery's lifecycle status, as one toned Tag: sent, waiting, or retrying after a failed send. */
export function alertStatus(row: Pick<AlertDeliveryView, "status" | "attempts">): {
	label: string;
	tone: "success" | "warning" | "danger";
} {
	if (row.status === "sent") return { label: "Sent", tone: "success" };
	return row.attempts > 0
		? { label: "Retrying", tone: "danger" }
		: { label: "Pending", tone: "warning" };
}

/** The group an alert names, for a person: the dead-man switch, or its short id or code. */
export function alertGroup(row: Pick<AlertDeliveryView, "fingerprint">): string {
	return row.fingerprint === "silence" ? "Dead-man switch" : row.fingerprint || "—";
}

/** A delivery's channel, as the Alerts table names it. */
export function alertChannelLabel(channel: AlertDeliveryView["channel"]): string {
	switch (channel) {
		case "webhook":
			return "Webhook";
		case "email":
			return "Email digest";
		case "in_app":
			return "Operator notice";
	}
}
// #endregion

// #region AML signals
/** What each kind of signal is, for its row. */
export const AML_KIND_LABEL: Record<AmlSignalKind, string> = {
	round_trip: "Both sides of an escrow",
	rapid_churn: "Card money withdrawn soon after",
	safety_hold: "Withdrawal held",
};

/** How the person is on both sides, in a reader's words. */
export const AML_RELATION_LABEL: Record<AmlRoundTripRelation, string> = {
	same_account: "the same account pays and is paid",
	business_seat: "the paid freelancer holds a seat on the paying business",
	team_seat: "the paying person holds a seat on the paid team",
	business_and_team_seat: "one person holds a seat on the paying business and the paid team",
};

/** A Safety Hold trigger, in a reader's words. */
const HOLD_TRIGGER_LABEL: Record<string, string> = {
	sign_in_change: "sign-in change",
	rapid_churn: "rapid churn",
	round_trip: "both sides of an escrow",
	new_account: "new account",
};

function shortDateTime(iso: string): string {
	return new Date(iso).toLocaleString("en-GB", {
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
		timeZone: "UTC",
	}) + " UTC";
}

/**
 * The one line of facts under a signal's kind: when a round trip was seen and how; how much card money
 * came in before a churn, in how many payments and inside what window; when a hold ends and what held
 * it. Figures are the minor units the island prints with `MoneyView`; this words the rest. Pure; pinned
 * by `ledger-health.test.ts`.
 */
export function amlFactsText(signal: AmlSignalView): string {
	switch (signal.kind) {
		case "round_trip":
			return `${signal.facts.event === "funding" ? "At funding" : "At release"}: ${
				AML_RELATION_LABEL[signal.facts.relation]
			}`;
		case "rapid_churn":
			return `${signal.facts.payments} card ${
				signal.facts.payments === 1 ? "payment" : "payments"
			} inside ${signal.facts.windowHours} h, the newest ${shortDateTime(signal.facts.lastInAt)}`;
		case "safety_hold":
			return `Held until ${shortDateTime(signal.facts.heldUntil)}: ${
				signal.facts.triggers.map((t) => HOLD_TRIGGER_LABEL[t] ?? t).join(", ")
			}`;
	}
}

/** Who a signal is about: their handle, or a short id when the account has none (erased). */
export function amlSubject(
	signal: Pick<AmlSignalView, "subjectUsername" | "subjectUserId">,
): string {
	return signal.subjectUsername ? `@${signal.subjectUsername}` : shortId(signal.subjectUserId);
}
// #endregion

// #region Ids
/** A uuid shortened for a table cell; the full id is the cell's title. */
export function shortId(id: string | null): string {
	return id ? id.slice(0, 8) : "—";
}
// #endregion
