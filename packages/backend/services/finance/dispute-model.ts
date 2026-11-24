import {
	type DisputeAudit,
	type DisputeCase,
	type DisputeKind,
	type DisputeOffer,
	type DisputeQueue,
	type DisputeQueueItem,
	type DisputeQueueParty,
	DisputeQueueStatus,
	DisputeRole,
	type DisputeRoomEntry,
	DisputeRoomEntrySchema,
	type DisputeSettlement,
	DisputeStatus,
	type DisputeTicket,
	type DisputeVault,
	type DisputeVaultRead,
	DisputeVaultReadSchema,
	DisputeVaultSchema,
	formatMoney,
	TicketDisputeSide,
	TicketDisputeWindow,
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

/** `finance.get_dispute.ticket` (PROJECTS EX2). */
interface RawTicket {
	id: string;
	slug: string;
	title: string;
	stage_id: string;
	stage_name: string | null;
	claimant_side: string;
	window: string;
	fee_bp: number | null;
	escrow_amounts: number[] | null;
}

/** One `finance.get_dispute.offers` entry (PROJECTS EX2). */
interface RawOffer {
	id: string;
	party: string;
	payee_share_bp: number;
	note: string | null;
	created_at: string;
	accepted_at: string | null;
	mine: boolean;
	standing: boolean;
	can_accept: boolean;
	payee_minor: number;
	fee_minor: number;
	refund_minor: number;
}

/** `finance.get_dispute`'s answer. */
export interface RawDispute {
	id: string;
	kind: "no_show" | "general" | "product" | "ticket";
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
	/** An operator's alone; absent from a party's read. */
	room?: { guarded?: boolean; unmatched?: number } | null;
	amount_minor: number;
	currency: string;
	project: { id: string; slug: string } | null;
	/** A product dispute's purchase (FBP DB21); absent or null on any other. */
	purchase?: { line_id: string; title: string } | null;
	sitting: { id: string; slug: string; title: string; starts_at: string; ends_at: string } | null;
	messages: RawMessage[] | null;
	/** The custom quote the engagement was bought on (Decision #522); absent before the key existed. */
	agreed_terms?: RawAgreedTerms | null;
	/** A ticket case's ticket and offers (PROJECTS EX2); null or absent on any other. */
	ticket?: RawTicket | null;
	offers?: RawOffer[] | null;
	/** A ticket case's Evidence Vault (PROJECTS EX3); null or absent on any other. */
	vault?: { status: string; sha256: string; created_at: string } | null;
	can_respond: boolean;
	can_escalate: boolean;
	can_offer?: boolean;
	can_resolve: boolean;
}
// #endregion

/** `finance.get_dispute.agreed_terms`: the offer's canonical terms and its hash. */
interface RawAgreedTerms {
	offer_id: string;
	terms: {
		scope?: string;
		deliverables?: string[];
		price_cents?: number;
		currency?: string;
		turnaround_days?: number;
	} | null;
	terms_hash: string;
	terms_intact: boolean;
	accepted_at: string | null;
	paid_at: string | null;
}

function agreedTermsOf(raw: RawAgreedTerms | null | undefined): DisputeCase["agreedTerms"] {
	if (!raw?.terms || !/^[0-9a-f]{64}$/.test(raw.terms_hash)) return null;
	const currency = (raw.terms.currency ?? "").toUpperCase();
	return {
		offerId: raw.offer_id,
		scope: (raw.terms.scope ?? "").slice(0, 4000),
		deliverables: (raw.terms.deliverables ?? []).slice(0, 12).map((d) => d.slice(0, 160)),
		priceLabel: currency ? formatMoney(Math.max(0, int(raw.terms.price_cents)), currency) : "",
		turnaroundDays: Math.min(90, Math.max(1, int(raw.terms.turnaround_days))),
		termsHash: raw.terms_hash,
		intact: raw.terms_intact === true,
		acceptedAt: raw.accepted_at,
		paidAt: raw.paid_at,
	};
}

// #region Helpers
function int(value: unknown): number {
	const n = Number(value);
	return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function pct(value: unknown): number {
	return Math.min(100, Math.max(0, int(value)));
}

/** The frozen log, dropping a line this build cannot read rather than guessing at it. */
function timelineOf(raw: unknown): DisputeRoomEntry[] {
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((line: Record<string, unknown>) => {
		const entry = DisputeRoomEntrySchema.safeParse({ ...line, weak: line?.how === "email" });
		return entry.success ? [entry.data] : [];
	});
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
		hostSeconds: Math.max(0, int(raw.host_seconds)),
		claimantSeconds: Math.max(0, int(raw.claimant_seconds)),
		reconnects: Math.max(0, int(raw.reconnects)),
		thresholdPct: pct(raw.threshold_pct),
		auditedAt: String(raw.audited_at ?? ""),
		timeline: timelineOf(raw.timeline),
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
/** The read's kind; anything unrecognised reads as a general dispute. */
function kindOf(raw: string | null | undefined): DisputeKind {
	return raw === "no_show" || raw === "product" || raw === "ticket" ? raw : "general";
}

/** A ticket case's ticket; `null` when absent or unreadable. */
function ticketOf(raw: RawTicket | null | undefined): DisputeTicket | null {
	if (!raw) return null;
	const side = TicketDisputeSide.safeParse(raw.claimant_side);
	const window = TicketDisputeWindow.safeParse(raw.window);
	const amounts = (raw.escrow_amounts ?? []).map((a) => Math.max(0, int(a))).slice(0, 20);
	if (!side.success || !window.success || amounts.length === 0) return null;
	return {
		id: raw.id,
		slug: raw.slug,
		title: (raw.title ?? "").slice(0, 300) || "Ticket",
		stageId: raw.stage_id,
		stageName: (raw.stage_name ?? "").slice(0, 200),
		claimantSide: side.data,
		window: window.data,
		feeBp: Math.min(10000, Math.max(0, int(raw.fee_bp))),
		escrowAmounts: amounts,
	};
}

/** A ticket case's offers, dropping one this build cannot read. */
function vaultOf(raw: RawDispute["vault"]): DisputeVault | null {
	const vault = raw && DisputeVaultSchema.safeParse({
		status: raw.status,
		sha256: raw.sha256,
		createdAt: raw.created_at,
	});
	return vault?.success ? vault.data : null;
}

/** `finance.get_dispute_vault`'s answer, mapped; null for a reader it admits nothing to. */
export function toDisputeVaultRead(raw: Record<string, unknown> | null): DisputeVaultRead | null {
	const vault = raw && DisputeVaultReadSchema.safeParse({
		disputeId: raw.dispute_id,
		role: raw.role,
		status: raw.status,
		sha256: raw.sha256,
		createdAt: raw.created_at,
		manifest: raw.manifest,
		objectPrefix: raw.object_prefix ?? null,
	});
	return vault?.success ? vault.data : null;
}

/** A file the vault holds a copy of: its id and where its bytes were when the case was raised. */
export interface VaultFile {
	file_id: string;
	bucket: string;
	path: string;
}

/** Every distinct file a manifest's submissions name (what the vault's copy step copies). */
export function vaultFilesOf(manifest: Record<string, unknown>): VaultFile[] {
	const seen = new Map<string, VaultFile>();
	const submissions = Array.isArray(manifest.submissions) ? manifest.submissions : [];
	for (const s of submissions as { files?: unknown }[]) {
		for (const f of (Array.isArray(s?.files) ? s.files : []) as Partial<VaultFile>[]) {
			if (f?.file_id && f.bucket && f.path) {
				seen.set(f.file_id, { file_id: f.file_id, bucket: f.bucket, path: f.path });
			}
		}
	}
	return [...seen.values()];
}

function offersOf(raw: RawOffer[] | null | undefined): DisputeOffer[] {
	return (raw ?? []).slice(0, 200).flatMap((o) => {
		if (o.party !== "claimant" && o.party !== "respondent") return [];
		return [{
			id: o.id,
			party: o.party,
			payeeShareBp: Math.min(10000, Math.max(0, int(o.payee_share_bp))),
			note: o.note?.slice(0, 1000) || null,
			createdAt: o.created_at,
			acceptedAt: o.accepted_at,
			mine: !!o.mine,
			standing: !!o.standing,
			canAccept: !!o.can_accept,
			payeeMinor: Math.max(0, int(o.payee_minor)),
			feeMinor: Math.max(0, int(o.fee_minor)),
			refundMinor: Math.max(0, int(o.refund_minor)),
		}];
	});
}

/** Map `finance.get_dispute`; `null` when the row is absent or unrecognisable. */
export function toDisputeCase(raw: RawDispute | null): DisputeCase | null {
	if (!raw) return null;
	const status = DisputeStatus.safeParse(raw.status);
	const role = DisputeRole.safeParse(raw.role);
	if (!status.success || !role.success) return null;
	return {
		id: raw.id,
		kind: kindOf(raw.kind),
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
		room: raw.room
			? { guarded: raw.room.guarded === true, unmatched: Math.max(0, int(raw.room.unmatched)) }
			: null,
		amountMinor: Math.max(0, int(raw.amount_minor)),
		currency: raw.currency,
		amountLabel: formatMoney(Math.max(0, int(raw.amount_minor)), raw.currency),
		projectSlug: raw.project?.slug ?? "",
		purchaseTitle: raw.purchase?.title?.slice(0, 200) || null,
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
		agreedTerms: agreedTermsOf(raw.agreed_terms),
		ticket: ticketOf(raw.ticket),
		offers: offersOf(raw.offers),
		vault: vaultOf(raw.vault),
		canRespond: !!raw.can_respond,
		canEscalate: !!raw.can_escalate,
		canOffer: !!raw.can_offer,
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
	/** A product dispute's purchase (FBP DB21); absent or null on any other. */
	purchase?: { title: string | null } | null;
	/** A ticket case's ticket (PROJECTS EX2); absent or null on any other. */
	ticket?: { title: string | null; slug: string | null } | null;
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
		kind: kindOf(raw.kind),
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
		purchaseTitle: raw.purchase?.title?.slice(0, 200) || null,
		ticketTitle: raw.ticket?.title?.slice(0, 300) || null,
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
