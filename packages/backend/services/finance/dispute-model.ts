import {
	type DisputeAudit,
	type DisputeCase,
	type DisputeQueue,
	type DisputeQueueItem,
	type DisputeQueueParty,
	DisputeQueueStatus,
	DisputeRole,
	type DisputeSettlement,
	DisputeStatus,
	formatMoney,
} from "@projective/types/finance";

/**
 * dispute-model — the pure mappings from `finance.get_dispute` onto {@link DisputeCase} and from
 * `finance.list_disputes_for_review` onto {@link DisputeQueue} (00001260, Decision #212). No I/O;
 * pinned by `dispute-model.test.ts`. A row with a status or role this build does not know maps to
 * `null` (or is dropped from the queue) rather than to a guess.
 */

// #region Raw rows (the SQL jsonb, as written by the function)
interface RawFile {
	id: string;
	name: string;
	mime_type: string | null;
	size_bytes: number | null;
}

interface RawMessage {
	id: string;
	party: string;
	body: string;
	created_at: string;
	mine: boolean;
	files: RawFile[] | null;
}

/** `finance.get_dispute`'s answer. */
export interface RawDispute {
	id: string;
	kind: "no_show" | "general";
	status: string;
	role: string;
	reason: string;
	opened_at: string;
	respond_by: string | null;
	responded_at: string | null;
	escalated_at: string | null;
	/** The review SLA (absent from a row read before the column existed). */
	review_by?: string | null;
	resolved_at: string | null;
	resolution_notes: string | null;
	resolved_by_operator: boolean;
	payee_share_bp: number | null;
	settlement: Record<string, unknown> | null;
	audit: Record<string, unknown> | null;
	amount_minor: number;
	currency: string;
	project: { id: string; slug: string } | null;
	sitting: { id: string; slug: string; title: string; starts_at: string; ends_at: string } | null;
	messages: RawMessage[] | null;
	can_respond: boolean;
	can_escalate: boolean;
	can_resolve: boolean;
}
// #endregion

// #region Helpers
function int(value: unknown): number {
	const n = Number(value);
	return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function pct(value: unknown): number {
	return Math.min(100, Math.max(0, int(value)));
}

function auditOf(raw: Record<string, unknown> | null): DisputeAudit | null {
	if (!raw) return null;
	const verdict = String(raw.verdict ?? "");
	if (!["pending", "refund", "dismiss", "ambiguous"].includes(verdict)) return null;
	return {
		verdict: verdict as DisputeAudit["verdict"],
		presenceOutcome: typeof raw.presence_outcome === "string" ? raw.presence_outcome : null,
		tracked: raw.tracked === true,
		hostPresencePct: pct(raw.host_presence_pct),
		claimantPresencePct: pct(raw.claimant_presence_pct),
		thresholdPct: pct(raw.threshold_pct),
		auditedAt: String(raw.audited_at ?? ""),
	};
}

function settlementOf(raw: Record<string, unknown> | null): DisputeSettlement | null {
	if (!raw) return null;
	const code = typeof raw.currency === "string" ? raw.currency : null;
	const payeeMinor = Math.max(0, int(raw.payee_minor));
	const feeMinor = Math.max(0, int(raw.fee_minor));
	const refundMinor = Math.max(0, int(raw.refund_minor));
	return {
		payeeMinor,
		feeMinor,
		refundMinor,
		currency: code,
		deferred: raw.deferred === true,
		byFact: raw.by_fact === true,
		payeeLabel: code ? formatMoney(payeeMinor, code) : null,
		feeLabel: code ? formatMoney(feeMinor, code) : null,
		refundLabel: code ? formatMoney(refundMinor, code) : null,
	};
}
// #endregion

// #region The case
/** Map `finance.get_dispute`; `null` when the row is absent or unrecognisable. */
export function toDisputeCase(raw: RawDispute | null): DisputeCase | null {
	if (!raw) return null;
	const status = DisputeStatus.safeParse(raw.status);
	const role = DisputeRole.safeParse(raw.role);
	if (!status.success || !role.success) return null;
	return {
		id: raw.id,
		kind: raw.kind === "no_show" ? "no_show" : "general",
		status: status.data,
		role: role.data,
		reason: raw.reason.slice(0, 500) || "No reason given.",
		openedAt: raw.opened_at,
		respondBy: raw.respond_by,
		respondedAt: raw.responded_at,
		escalatedAt: raw.escalated_at,
		reviewBy: raw.review_by ?? null,
		resolvedAt: raw.resolved_at,
		resolutionNotes: raw.resolution_notes,
		resolvedByOperator: !!raw.resolved_by_operator,
		payeeShareBp: raw.payee_share_bp ?? null,
		settlement: settlementOf(raw.settlement),
		audit: auditOf(raw.audit),
		amountMinor: Math.max(0, int(raw.amount_minor)),
		currency: raw.currency,
		amountLabel: formatMoney(Math.max(0, int(raw.amount_minor)), raw.currency),
		projectSlug: raw.project?.slug ?? "",
		sitting: raw.sitting
			? {
				id: raw.sitting.id,
				slug: raw.sitting.slug,
				title: raw.sitting.title.slice(0, 200),
				startsAt: raw.sitting.starts_at,
				endsAt: raw.sitting.ends_at,
			}
			: null,
		messages: (raw.messages ?? []).flatMap((m) => {
			const party = DisputeRole.safeParse(m.party);
			if (!party.success) return [];
			return [{
				id: m.id,
				party: party.data,
				body: m.body.slice(0, 4000),
				createdAt: m.created_at,
				mine: !!m.mine,
				files: (m.files ?? []).slice(0, 10).map((f) => ({
					id: f.id,
					name: f.name || "Evidence",
					mimeType: f.mime_type ?? "application/octet-stream",
					sizeBytes: Math.max(0, int(f.size_bytes)),
				})),
			}];
		}),
		canRespond: !!raw.can_respond,
		canEscalate: !!raw.can_escalate,
		canResolve: !!raw.can_resolve,
	};
}
// #endregion

// #region The operator queue
interface RawParty {
	name: string | null;
	handle: string | null;
}

/** One `finance.list_disputes_for_review` item. */
export interface RawQueueItem {
	id: string;
	status: string;
	kind: string;
	reason: string;
	opened_at: string;
	respond_by: string | null;
	escalated_at: string | null;
	review_by: string | null;
	overdue: boolean;
	amount_minor: number;
	currency: string;
	project: { slug: string | null; title: string | null } | null;
	sitting: { title: string; starts_at: string; ends_at: string } | null;
	claimant: RawParty | null;
	respondent: RawParty | null;
	statements: number;
	evidence: number;
}

/** `finance.list_disputes_for_review`'s answer. */
export interface RawQueue {
	items: RawQueueItem[] | null;
	counts: {
		open?: number;
		awaiting_response?: number;
		under_review?: number;
		overdue?: number;
	} | null;
}

function partyOf(raw: RawParty | null): DisputeQueueParty {
	const name = raw?.name?.trim().slice(0, 200) || null;
	const handle = raw?.handle?.trim().slice(0, 60) || null;
	return { name, handle };
}

function count(value: unknown): number {
	return Math.max(0, int(value));
}

/** Map one queue row; `null` for a status this build does not list. */
export function toDisputeQueueItem(raw: RawQueueItem): DisputeQueueItem | null {
	const status = DisputeQueueStatus.safeParse(raw.status);
	if (!status.success) return null;
	const amountMinor = count(raw.amount_minor);
	return {
		id: raw.id,
		status: status.data,
		kind: raw.kind === "no_show" ? "no_show" : "general",
		reason: (raw.reason ?? "").slice(0, 500) || "No reason given.",
		openedAt: raw.opened_at,
		respondBy: raw.respond_by,
		escalatedAt: raw.escalated_at,
		reviewBy: raw.review_by,
		overdue: status.data === "under_review" && raw.overdue === true,
		amountMinor,
		currency: raw.currency,
		amountLabel: formatMoney(amountMinor, raw.currency),
		projectSlug: raw.project?.slug ?? "",
		projectTitle: (raw.project?.title ?? "").slice(0, 200),
		sitting: raw.sitting
			? {
				title: raw.sitting.title.slice(0, 200) || "Session",
				startsAt: raw.sitting.starts_at,
				endsAt: raw.sitting.ends_at,
			}
			: null,
		claimant: partyOf(raw.claimant),
		respondent: partyOf(raw.respondent),
		statementCount: count(raw.statements),
		evidenceCount: count(raw.evidence),
	};
}

/** Map the queue; unknown rows are dropped, the counts are taken as the database gave them. */
export function toDisputeQueue(raw: RawQueue | null): DisputeQueue {
	const items = (raw?.items ?? []).slice(0, 200).flatMap((row) => {
		const item = toDisputeQueueItem(row);
		return item ? [item] : [];
	});
	const c = raw?.counts ?? {};
	return {
		items,
		counts: {
			open: count(c.open),
			awaitingResponse: count(c.awaiting_response),
			underReview: count(c.under_review),
			overdue: count(c.overdue),
		},
	};
}
// #endregion
