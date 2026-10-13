import {
	type DisputeAudit,
	type DisputeCase,
	DisputeRole,
	type DisputeSettlement,
	DisputeStatus,
	formatMoney,
} from "@projective/types/finance";

/**
 * dispute-model — the pure mapping from `finance.get_dispute` (00001260, Decision #212) onto
 * {@link DisputeCase}. No I/O; pinned by `dispute-model.test.ts`. A row with a status or role this
 * build does not know maps to `null` rather than to a guess.
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
