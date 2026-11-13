import {
	type EngagementOwnership,
	fundingStageOf,
	PREPAID_TTL_HOURS,
	sameCurrencyMoney,
	TicketFundingBlock,
	type TicketFundingPhase,
	type TicketFundingQuote,
	type TicketFundingStage,
} from "@projective/types/finance";
import type { BoardCard } from "@projective/types/projects";
import { getUserClient } from "../../core/supabase.ts";
import { type DbResult, refusalOf } from "./live-payments.ts";

type Row = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHASES: ReadonlySet<string> = new Set(["done", "now", "funded", "later", "prepaid"]);
/** A fixture stage's statuses that mean it has finished (the board's `ProjectStatus` vocabulary). */
const FINISHED_STAGE: ReadonlySet<string> = new Set(["completed", "cancelled", "archived"]);
/** The funding states in which the ticket's current stage is already paid for — what the modal's line reads. */
const HELD_STATES: ReadonlySet<string> = new Set([
	"processing",
	"funded",
	"in_progress",
	"in_review",
	"released",
]);

function int(value: unknown): number {
	const n = typeof value === "string" ? Number(value) : value;
	return typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : 0;
}

function clip(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function blockOf(raw: unknown): TicketFundingQuote["blocked"] {
	if (raw === null || raw === undefined) return null;
	const parsed = TicketFundingBlock.safeParse(raw);
	return parsed.success ? parsed.data : "finished";
}

/** One `projects.get_ticket_funding_quote` answer onto {@link TicketFundingQuote}. */
export function ticketFundingQuoteOf(row: Row): TicketFundingQuote {
	const currency = String(row.currency ?? "USD").toUpperCase();
	const engagement: EngagementOwnership = row.engagement === "service" ? "service" : "project";
	const stages = (Array.isArray(row.stages) ? row.stages : []).slice(0, 50) as Row[];
	return {
		projectId: String(row.project_id),
		ticketId: String(row.ticket_id),
		ticketSlug: clip(String(row.ticket_slug ?? ""), 40),
		ticketTitle: clip(String(row.ticket_title ?? "Ticket"), 200),
		fundingStageId: row.funding_stage_id ? String(row.funding_stage_id) : null,
		fundingStageName: row.funding_stage_name ? clip(String(row.funding_stage_name), 120) : null,
		amount: sameCurrencyMoney(Math.max(0, int(row.amount_cents)), currency),
		blocked: blockOf(row.blocked),
		stages: stages.map((s, i): TicketFundingStage => ({
			stageId: String(s.stage_id),
			slug: s.slug ? clip(String(s.slug), 80) : null,
			name: clip(String(s.name ?? "Stage"), 120),
			order: Math.max(0, s.order === undefined ? i : int(s.order)),
			stageStatus: clip(String(s.stage_status ?? ""), 20),
			phase: (PHASES.has(String(s.phase)) ? s.phase : "later") as TicketFundingPhase,
			amount: s.amount_cents === null || s.amount_cents === undefined
				? null
				: sameCurrencyMoney(Math.max(0, int(s.amount_cents)), currency),
			fundable: s.fundable === true,
		})),
		engagement,
		escrowTtlHours: Math.max(1, int(row.ttl_hours) || PREPAID_TTL_HOURS[engagement]),
		prepaid: row.prepaid !== false,
		payer: {
			scope: row.payer_scope === "business" ? "business" : "personal",
			id: String(row.payer_id),
		},
		walletBalance: sameCurrencyMoney(int(row.wallet_balance_cents), currency),
	};
}

/**
 * The dev-fixture quote (no live finance backend): the same shape, from the stub board's own card —
 * its stages at the costs the board already priced, the stage it sits in (or a New ticket's first), the
 * later stages it prepaid (`funding.prepaidStageIds`), each stage `fundable` by the database's rule, and
 * the default refund window for its ownership. The fixture holds no wallet, so its balance is nil.
 */
export function fixtureTicketQuote(
	card: BoardCard,
	engagement: EngagementOwnership,
	projectId: string,
): TicketFundingQuote {
	const currency = card.currency.toUpperCase();
	const ordered = [...card.stages].sort((a, b) => a.order - b.order);
	const fundingStageId = fundingStageOf(
		card.stageId,
		ordered.map((s) => ({ stageId: s.stageId, order: s.order })),
	);
	const at = ordered.findIndex((s) => s.stageId === fundingStageId);
	const paid = card.escrowHeld || (card.funding !== null && HELD_STATES.has(card.funding.state));
	const prepaid = new Set(card.funding?.prepaidStageIds ?? []);
	const cost = at >= 0 ? ordered[at].costCents : null;
	const finished = card.frozen || card.status === "completed" || card.status === "cancelled";
	const ticketBlock: TicketFundingQuote["blocked"] = !card.hasDescription
		? "description"
		: finished
		? "finished"
		: fundingStageId === null
		? "no_stage"
		: null;
	const stages = ordered.map((s, i): TicketFundingStage => {
		const phase: TicketFundingPhase = s.stageId === fundingStageId
			? (paid ? "funded" : prepaid.has(s.stageId) ? "prepaid" : "now")
			: at >= 0 && i < at
			? "done"
			: prepaid.has(s.stageId)
			? "prepaid"
			: "later";
		return {
			stageId: s.stageId,
			slug: null,
			name: clip(s.name, 120),
			order: i,
			stageStatus: s.status,
			phase,
			amount: s.costCents === null ? null : sameCurrencyMoney(s.costCents, currency),
			fundable: ticketBlock === null && (phase === "now" || phase === "later") &&
				(s.costCents ?? 0) > 0 && !FINISHED_STAGE.has(s.status),
		};
	});
	const blocked: TicketFundingQuote["blocked"] = ticketBlock ??
		(stages.some((s) => s.fundable)
			? null
			: at >= 0 && FINISHED_STAGE.has(ordered[at].status)
			? "stage_finished"
			: stages.some((s) => (s.phase === "now" || s.phase === "later") && (s.amount?.minor ?? 0) <= 0)
			? "unpriced"
			: "paid");
	return {
		projectId,
		ticketId: card.id,
		ticketSlug: clip(card.slug ?? card.id, 40),
		ticketTitle: clip(card.title, 200),
		fundingStageId,
		fundingStageName: at >= 0 ? clip(ordered[at].name, 120) : null,
		amount: sameCurrencyMoney(Math.max(0, cost ?? 0), currency),
		blocked,
		stages,
		engagement,
		escrowTtlHours: PREPAID_TTL_HOURS[engagement],
		prepaid: !card.claimed && card.assignee === null,
		payer: { scope: "personal", id: "fixture" },
		walletBalance: sameCurrencyMoney(0, currency),
	};
}

/** A project's `prj-…` slug and a ticket's `tkt-…` slug (or row id) as row ids, under RLS; `null` when either is not visible. */
export async function resolveTicketRefs(
	accessToken: string,
	projectSlug: string,
	ticketRef: string,
): Promise<{ projectId: string; ticketId: string } | null> {
	const db = getUserClient(accessToken).schema("projects");
	const project = await db.from("projects").select("id").eq("slug", projectSlug).maybeSingle();
	if (project.error) throw new Error(`projects.projects read failed: ${project.error.message}`);
	if (!project.data) return null;
	const projectId = (project.data as { id: string }).id;
	const ticket = await db.from("tickets").select("id")
		.eq("project_id", projectId)
		.eq(UUID.test(ticketRef) ? "id" : "slug", ticketRef)
		.maybeSingle();
	if (ticket.error) throw new Error(`projects.tickets read failed: ${ticket.error.message}`);
	if (!ticket.data) return null;
	return { projectId, ticketId: (ticket.data as { id: string }).id };
}

/** Quote one ticket by its row ids, as the caller. */
export async function readTicketFundingQuote(
	accessToken: string,
	projectId: string,
	ticketId: string,
): Promise<DbResult<TicketFundingQuote>> {
	const { data, error } = await getUserClient(accessToken).schema("projects").rpc(
		"get_ticket_funding_quote",
		{ p_project_id: projectId, p_ticket_id: ticketId },
	);
	if (error) return { ok: false, refusal: refusalOf(error, "get_ticket_funding_quote") };
	return { ok: true, value: ticketFundingQuoteOf(data as Row) };
}
