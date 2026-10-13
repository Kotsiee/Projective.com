import type {
	DisputeCase,
	DisputeOutcome,
	DisputeQueue,
	DisputeQueueCounts,
	DisputeQueueItem,
	DisputeQueueParty,
	DisputeQueueStatus,
	OperatorDeskOverride,
} from "@projective/types/finance";
import { formatMoney } from "@projective/types/finance";
import { disputeTimeLabel } from "@features/projects/core/dispute-view.ts";

/**
 * dispute-desk — the pure, DOM-free model behind the operator dispute desk (`/admin/disputes`,
 * Decision #212). The database decides every fact: who may read the queue, its order, whether a case
 * is overdue, what a ruling moves. This module only names those facts for the operator (tabs and their
 * counts, the parties, the deadline that applies) and validates the ruling form the way the route's Zod
 * will, so the confirm is disabled exactly when the server would refuse the shape. In development it
 * also builds the Dev Context Switcher's `operatorDesk` preview. Pinned by `dispute-desk.test.ts`.
 */

// #region Tabs
/** A queue tab: one live status, or every live case. */
export type DeskTab = DisputeQueueStatus | "all";

/** The tabs in their order — the auditor's queue first. */
export const DESK_TABS: ReadonlyArray<DeskTab> = [
	"under_review",
	"awaiting_response",
	"open",
	"all",
];

/** Each tab's label. */
export const DESK_TAB_LABEL: Record<DeskTab, string> = {
	under_review: "Under review",
	awaiting_response: "Awaiting response",
	open: "Open",
	all: "All live",
};

/** A tab's count, from the server's counts over the whole live set. */
export function tabCount(tab: DeskTab, counts: DisputeQueueCounts): number {
	switch (tab) {
		case "under_review":
			return counts.underReview;
		case "awaiting_response":
			return counts.awaitingResponse;
		case "open":
			return counts.open;
		case "all":
			return counts.underReview + counts.awaitingResponse + counts.open;
	}
}

/** The cases a tab shows, in the server's order (oldest-due first). */
export function itemsFor(items: ReadonlyArray<DisputeQueueItem>, tab: DeskTab): DisputeQueueItem[] {
	return tab === "all" ? [...items] : items.filter((i) => i.status === tab);
}

/** What an empty tab says. */
export function emptyCopy(tab: DeskTab): { title: string; description: string } {
	switch (tab) {
		case "under_review":
			return {
				title: "Nothing waiting for a ruling",
				description:
					"A case arrives here when the provider responds, a party escalates, or the response deadline passes.",
			};
		case "awaiting_response":
			return {
				title: "No case is waiting on a provider",
				description:
					"These are claims the room's logs could not settle; each goes to review by its response deadline.",
			};
		case "open":
			return {
				title: "No open claims",
				description: "An open claim is checked against the room's logs when its session ends.",
			};
		case "all":
			return { title: "No live disputes", description: "Every dispute has been settled." };
	}
}
// #endregion

// #region Names and deadlines
/** A party as one name: the display name, else the handle, else the side they are on. */
export function partyLabel(party: DisputeQueueParty, fallback: string): string {
	return party.name ?? (party.handle ? `@${party.handle}` : fallback);
}

/** The case's subject line: the sitting it is about, else the engagement. */
export function caseTitle(item: Pick<DisputeQueueItem, "sitting" | "projectTitle">): string {
	return item.sitting?.title || item.projectTitle || "Dispute";
}

/** The one deadline that applies to a case, as a meta fragment. */
export function deadlineLine(
	item: Pick<DisputeQueueItem, "status" | "reviewBy" | "respondBy" | "openedAt" | "overdue">,
): string {
	if (item.status === "under_review" && item.reviewBy) {
		const at = disputeTimeLabel(item.reviewBy);
		return item.overdue ? `Ruling overdue since ${at}` : `Ruling due ${at}`;
	}
	if (item.status === "awaiting_response" && item.respondBy) {
		return `Response due ${disputeTimeLabel(item.respondBy)}`;
	}
	return `Raised ${disputeTimeLabel(item.openedAt)}`;
}

/** "2 statements · 1 file", or "No statements yet". */
export function evidenceLine(
	item: Pick<DisputeQueueItem, "statementCount" | "evidenceCount">,
): string {
	if (item.statementCount === 0) return "No statements yet";
	const s = `${item.statementCount} statement${item.statementCount === 1 ? "" : "s"}`;
	if (item.evidenceCount === 0) return s;
	return `${s} · ${item.evidenceCount} file${item.evidenceCount === 1 ? "" : "s"}`;
}

/** The sentence under an operator's case header. */
export function operatorSentence(
	d: Pick<DisputeCase, "status" | "canResolve">,
	overdue: boolean,
): string {
	if (!d.canResolve) return "This case is closed. Its ruling is final.";
	switch (d.status) {
		case "under_review":
			return overdue
				? "Past its review deadline. The payment stays held until you rule; nothing rules on its own."
				: "Waiting for a ruling. The payment stays held until you rule.";
		case "awaiting_response":
			return "The provider has not responded yet. You can rule now, or wait for the response.";
		case "open":
			return "The session's attendance check has not run yet. You can rule now, or wait for it.";
		default:
			return "This case is closed. Its ruling is final.";
	}
}
// #endregion

// #region The ruling form
/** Each outcome as the operator chooses it. */
export const OUTCOME_LABEL: Record<DisputeOutcome, string> = {
	release: "Pay the provider",
	refund: "Refund the attendee",
	split: "Split",
};

/** What each outcome does, said once under the choice. */
export const OUTCOME_HINT: Record<DisputeOutcome, string> = {
	release: "The claim is dismissed. The held payment goes to the provider, less the platform fee.",
	refund: "The claim is upheld. The whole payment goes back to the attendee.",
	split: "The provider is paid their share, less the platform fee on it; the rest is refunded.",
};

/**
 * The provider's share as basis points, from the percentage the operator typed (two decimals at most):
 * 25 → 2,500, 33.33 → 3,333. `null` when it is not a share a split can carry (1–9,999 bp).
 */
export function shareToBp(percent: number | null): number | null {
	if (percent === null || !Number.isFinite(percent)) return null;
	const bp = Math.round(percent * 100);
	return bp >= 1 && bp <= 9999 ? bp : null;
}

/**
 * Why the ruling cannot be sent yet, or `null` when it can — the same shape `DisputeResolveInputSchema`
 * enforces on the route (a split names a share; the reasons run 3–2,000 characters).
 */
export function rulingProblem(
	outcome: DisputeOutcome | null,
	sharePercent: number | null,
	notes: string,
): string | null {
	if (!outcome) return "Choose a ruling.";
	if (outcome === "split" && shareToBp(sharePercent) === null) {
		return "Give the provider's share, between 0.01 % and 99.99 %.";
	}
	const n = notes.trim().length;
	if (n < 3) return "Give the parties the reasons for the ruling.";
	if (n > 2000) return "Keep the reasons to 2,000 characters.";
	return null;
}

/** The confirm step's sentence: what this ruling will do, before it is final. */
export function confirmSentence(
	outcome: DisputeOutcome,
	sharePercent: number | null,
	amountLabel: string,
): string {
	switch (outcome) {
		case "release":
			return `Pay the provider from the ${amountLabel} held. This is final.`;
		case "refund":
			return `Refund the ${amountLabel} held to the attendee. This is final.`;
		case "split": {
			const bp = shareToBp(sharePercent) ?? 0;
			return `Give the provider ${
				bp / 100
			} % of the ${amountLabel} held and refund the rest. This is final.`;
		}
	}
}
// #endregion

// #region Dev preview (the `operatorDesk` axis)
const PREVIEW_IDS = [
	"00000000-0000-4000-8000-0000000d0e51",
	"00000000-0000-4000-8000-0000000d0e52",
	"00000000-0000-4000-8000-0000000d0e53",
	"00000000-0000-4000-8000-0000000d0e54",
] as const;

/** Whether a case id is one of the preview's samples (its dialog is built here, never fetched). */
export function isPreviewCase(id: string): boolean {
	return (PREVIEW_IDS as ReadonlyArray<string>).includes(id);
}

const HOUR = 3_600_000;

function previewItem(
	n: number,
	status: DisputeQueueStatus,
	now: number,
	ageHours: number,
): DisputeQueueItem {
	const amountMinor = 12_000;
	// One consistent timeline: raised, escalated 20 h later, a ruling due 72 h after that.
	const opened = now - ageHours * HOUR;
	const escalated = opened + 20 * HOUR;
	const reviewed = status === "under_review";
	return {
		id: PREVIEW_IDS[n],
		status,
		kind: "no_show",
		reason: "The provider did not join the session.",
		openedAt: new Date(opened).toISOString(),
		respondBy: status === "open" ? null : new Date(opened + 48 * HOUR).toISOString(),
		escalatedAt: reviewed ? new Date(escalated).toISOString() : null,
		reviewBy: reviewed ? new Date(escalated + 72 * HOUR).toISOString() : null,
		overdue: reviewed && escalated + 72 * HOUR <= now,
		amountMinor,
		currency: "GBP",
		amountLabel: formatMoney(amountMinor, "GBP"),
		projectSlug: "prj-preview000",
		projectTitle: "Previewed engagement",
		sitting: {
			title: `Previewed session ${n + 1}`,
			startsAt: new Date(opened - 2 * HOUR).toISOString(),
			endsAt: new Date(opened - HOUR).toISOString(),
		},
		claimant: { name: "Sample attendee", handle: "sample-attendee" },
		respondent: { name: "Sample provider", handle: "sample-provider" },
		statementCount: reviewed ? 2 : 0,
		evidenceCount: 0,
	};
}

/**
 * The Dev Context Switcher's `operatorDesk` over the page: `queue` fills it with one case in each live
 * status plus an overdue one, `empty` with none. Not a derivation — the switcher names the state, this
 * fills its shape. Every ruling on a sample still goes to the database, which refuses it.
 */
export function previewQueue(kind: OperatorDeskOverride, now: number): DisputeQueue {
	if (kind === "empty") {
		return { items: [], counts: { open: 0, awaitingResponse: 0, underReview: 0, overdue: 0 } };
	}
	const items = [
		previewItem(0, "under_review", now, 100),
		previewItem(1, "under_review", now, 30),
		previewItem(2, "awaiting_response", now, 20),
		previewItem(3, "open", now, 1),
	];
	return { items, counts: { open: 1, awaitingResponse: 1, underReview: 2, overdue: 1 } };
}

/** The full case behind a sample, with a statement each side, for the dev preview only. */
export function previewCase(item: DisputeQueueItem): DisputeCase {
	const reviewed = item.status === "under_review";
	return {
		id: item.id,
		kind: item.kind,
		status: item.status,
		role: "operator",
		reason: item.reason,
		openedAt: item.openedAt,
		respondBy: item.respondBy,
		respondedAt: reviewed ? item.escalatedAt : null,
		escalatedAt: item.escalatedAt,
		reviewBy: item.reviewBy,
		resolvedAt: null,
		resolutionNotes: null,
		resolvedByOperator: false,
		payeeShareBp: null,
		settlement: null,
		audit: item.status === "open" ? null : {
			verdict: "ambiguous",
			presenceOutcome: "untracked",
			tracked: false,
			hostPresencePct: 0,
			claimantPresencePct: 0,
			thresholdPct: 80,
			auditedAt: item.openedAt,
		},
		amountMinor: item.amountMinor,
		currency: item.currency,
		amountLabel: item.amountLabel,
		projectSlug: item.projectSlug,
		sitting: item.sitting ? { id: item.id, slug: "ssn-preview000", ...item.sitting } : null,
		messages: reviewed
			? [
				{
					id: "00000000-0000-4000-8000-0000000d0e61",
					party: "claimant",
					body: "I waited in the room for twenty minutes and nobody came.",
					createdAt: item.openedAt,
					mine: false,
					files: [],
				},
				{
					id: "00000000-0000-4000-8000-0000000d0e62",
					party: "respondent",
					body: "I was in the room from the start; the link in the invite was the one I used.",
					createdAt: item.escalatedAt ?? item.openedAt,
					mine: false,
					files: [],
				},
			]
			: [],
		canRespond: false,
		canEscalate: false,
		canResolve: true,
	};
}
// #endregion
