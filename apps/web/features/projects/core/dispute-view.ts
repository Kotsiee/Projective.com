import {
	type DisputeCase,
	type DisputeRole,
	type DisputeStatus,
	type DisputeSummary,
	formatMoney,
	isDisputeLive,
} from "@projective/types/finance";
import type { SessionSitting, SessionWorkspace } from "@projective/types/projects";

/**
 * dispute-view — the pure, DOM-free model behind a session's no-show dispute section (Decision #212).
 *
 * The server decides every fact — whether a sitting is reportable, the case's status, its deadline,
 * what a ruling moved. This module only names them for the reader (the status pill, the one-line
 * sentence under it, the deadline in UTC with the zone named, as the session panel prints its times)
 * and, in development, previews the Dev Context Switcher's `disputeState` over the real workspace.
 */

// #region Status copy
/** The lifecycle status as a pill says it. */
export function disputeStatusLabel(status: DisputeStatus): string {
	switch (status) {
		case "open":
			return "Claim open";
		case "awaiting_response":
			return "Awaiting response";
		case "under_review":
			return "Under review";
		case "resolved_release":
			return "Released";
		case "resolved_refund":
			return "Refunded";
		case "resolved_split":
			return "Split";
	}
}

/** The pill's severity: live cases warn, an auditor's queue is informational, rulings are settled. */
export function disputeStatusSeverity(
	status: DisputeStatus,
): "warning" | "info" | "success" | "secondary" {
	switch (status) {
		case "open":
		case "awaiting_response":
			return "warning";
		case "under_review":
			return "info";
		case "resolved_refund":
		case "resolved_release":
			return "success";
		case "resolved_split":
			return "secondary";
	}
}

/** A deadline or instant in UTC, zone named — the same string on the server and the hydrated island. */
export function disputeTimeLabel(iso: string | null): string | null {
	if (!iso) return null;
	const ms = Date.parse(iso);
	if (!Number.isFinite(ms)) return null;
	const d = new Date(ms);
	const month = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
	const hh = String(d.getUTCHours()).padStart(2, "0");
	const mm = String(d.getUTCMinutes()).padStart(2, "0");
	return `${d.getUTCDate()} ${month}, ${hh}:${mm} UTC`;
}

/**
 * The one sentence under the pill: what is happening and what the reader can do. `viewer` is the side
 * the reader is on (an attendee reads their own claim; the provider reads a claim against them).
 */
export function disputeSentence(
	d: Pick<DisputeSummary, "status" | "respondBy">,
	viewer: DisputeRole,
): string {
	const by = disputeTimeLabel(d.respondBy);
	const provider = viewer === "respondent";
	switch (d.status) {
		case "open":
			return provider
				? "An attendee says you did not join. The room's attendance is checked when the session ends."
				: "Your payment is held. The room's attendance is checked when the session ends.";
		case "awaiting_response":
			return provider
				? `The room's logs don't settle it. Respond with your account and any evidence${
					by ? ` by ${by}` : ""
				}, or it goes to an auditor.`
				: `The provider has been asked to respond${
					by ? ` by ${by}` : ""
				}. Your payment stays held.`;
		case "under_review":
			return "A Projective auditor is reviewing the evidence. The payment stays held until they rule.";
		case "resolved_release":
			return provider
				? "The claim was dismissed. The payment is yours."
				: "The claim was dismissed. The payment goes to the provider.";
		case "resolved_refund":
			return provider
				? "The claim was upheld. The payment was returned to the attendee."
				: "The claim was upheld. Your payment was refunded.";
		case "resolved_split":
			return "The case was settled with the payment divided between you.";
	}
}

/** The live claim on a sitting, if any (the one a sitting row shows). */
export function liveDisputeFor(
	disputes: ReadonlyArray<DisputeSummary>,
	sittingId: string | null,
): DisputeSummary | null {
	if (!sittingId) return null;
	return disputes.find((d) => d.sessionEventId === sittingId && isDisputeLive(d.status)) ?? null;
}

/** Which claims the section lists: every live one, then the most recent ruling. */
export function visibleDisputes(disputes: ReadonlyArray<DisputeSummary>): DisputeSummary[] {
	const live = disputes.filter((d) => isDisputeLive(d.status));
	const settled = disputes.filter((d) => !isDisputeLive(d.status)).slice(0, 1);
	return [...live, ...settled];
}
// #endregion

// #region Dev preview
/**
 * The Dev Context Switcher's `disputeState` (`DevDisputeState` in `@web/utils/dev-seam.ts`, the axis's SSOT),
 * restated structurally so this DOM-free model and its tests never load the DOM-reading seam.
 */
export type DisputePreviewState = "auto" | "none" | "reportable" | DisputeStatus;

/** The id a previewed case carries — the dialog renders {@link devDisputeCase} for it, never a fetch. */
export const DEV_DISPUTE_ID = "00000000-0000-4000-8000-00000000d15e";

/** A sitting to hang a previewed claim on: the claimable one, the next, or one that just ended. */
function previewSitting(ws: SessionWorkspace, now: number): SessionSitting {
	return ws.claimable ?? ws.next ?? {
		id: "00000000-0000-4000-8000-00000000d15f",
		title: "Previewed session",
		startsAt: new Date(now - 2 * 3_600_000).toISOString(),
		endsAt: new Date(now - 3_600_000).toISOString(),
		phase: "ended",
		index: 1,
		total: 1,
	};
}

/**
 * The Dev Context Switcher's `disputeState` over the real workspace: `none` clears the section,
 * `reportable` offers the Report no-show action, anything else shows one previewed claim in that status.
 * Not a derivation — the switcher names the state, this fills its shape.
 */
export function previewDisputes(
	ws: SessionWorkspace,
	state: DisputePreviewState | undefined,
	now: number,
): SessionWorkspace {
	if (!state || state === "auto") return ws;
	if (state === "none") return { ...ws, claimable: null, disputes: [] };
	const sitting = previewSitting(ws, now);
	if (state === "reportable") return { ...ws, claimable: sitting, disputes: [] };
	const resolved = !isDisputeLive(state);
	return {
		...ws,
		claimable: null,
		disputes: [{
			id: DEV_DISPUTE_ID,
			status: state,
			sessionEventId: sitting.id,
			respondBy: state === "awaiting_response"
				? new Date(now + 47 * 3_600_000).toISOString()
				: null,
			openedAt: new Date(now - 3_600_000).toISOString(),
			resolvedAt: resolved ? new Date(now - 60_000).toISOString() : null,
			mine: ws.role !== "host",
		}],
	};
}

/** The full case behind a previewed claim, with sample statements, for the dev preview only. */
export function devDisputeCase(
	summary: DisputeSummary,
	ws: SessionWorkspace,
	now: number,
): DisputeCase {
	const role: DisputeRole = ws.role === "host" ? "respondent" : "claimant";
	const sitting = previewSitting(ws, now);
	const amount = 12_000;
	const currency = "GBP";
	const live = isDisputeLive(summary.status);
	const settlement = summary.status === "resolved_split"
		? { payeeMinor: 5_700, feeMinor: 300, refundMinor: 6_000 }
		: summary.status === "resolved_refund"
		? { payeeMinor: 0, feeMinor: 0, refundMinor: amount }
		: summary.status === "resolved_release"
		? { payeeMinor: 11_400, feeMinor: 600, refundMinor: 0 }
		: null;
	return {
		id: summary.id,
		kind: "no_show",
		status: summary.status,
		role,
		reason: "The provider did not join the session.",
		openedAt: summary.openedAt,
		respondBy: summary.respondBy,
		respondedAt: summary.status === "under_review" || !live ? summary.openedAt : null,
		escalatedAt: summary.status === "under_review" || !live ? summary.openedAt : null,
		resolvedAt: summary.resolvedAt,
		resolutionNotes: live
			? null
			: "Previewed ruling: the room's logs and both statements were reviewed.",
		resolvedByOperator: !live,
		payeeShareBp: summary.status === "resolved_split" ? 5_000 : null,
		settlement: settlement
			? {
				...settlement,
				currency,
				deferred: false,
				byFact: false,
				payeeLabel: formatMoney(settlement.payeeMinor, currency),
				feeLabel: formatMoney(settlement.feeMinor, currency),
				refundLabel: formatMoney(settlement.refundMinor, currency),
			}
			: null,
		audit: summary.status === "open" ? null : {
			verdict: "ambiguous",
			presenceOutcome: "untracked",
			tracked: false,
			hostPresencePct: 0,
			claimantPresencePct: 0,
			thresholdPct: 80,
			auditedAt: summary.openedAt,
		},
		amountMinor: amount,
		currency,
		amountLabel: formatMoney(amount, currency),
		projectSlug: ws.slug,
		sitting: {
			id: sitting.id,
			slug: "ssn-preview000",
			title: sitting.title,
			startsAt: sitting.startsAt,
			endsAt: sitting.endsAt,
		},
		messages: summary.status === "open" || summary.status === "awaiting_response" ? [] : [{
			id: "00000000-0000-4000-8000-00000000d160",
			party: "respondent",
			body: "I was in the room from the start; my calendar invite and a screenshot are attached.",
			createdAt: summary.openedAt,
			mine: role === "respondent",
			files: [],
		}],
		canRespond: live,
		canEscalate: summary.status === "awaiting_response",
		canResolve: false,
	};
}
// #endregion
