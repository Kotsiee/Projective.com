import { z } from "zod";
import { formatMoney, type MoneyView, MoneyViewSchema } from "./wallet.ts";

/** A row id or a fixture reference: the commit doors re-validate every id they are given. */
const ref = z.string().min(1).max(120);

// #region Prepaid escrow TTL (Decision #428)
/** Who owns the engagement a ticket belongs to: a productised service (`source_blueprint_id`) or a client project. */
export const EngagementOwnership = z.enum(["service", "project"]);
export type EngagementOwnership = z.infer<typeof EngagementOwnership>;

/**
 * The default window an unclaimed prepaid escrow waits for a claim before it is refunded, by ownership.
 * Mirrors `security.platform_params` `prepaid_service_ttl_hours` / `prepaid_project_ttl_hours`; the
 * database's figure is the one a quote carries.
 */
export const PREPAID_TTL_HOURS: Readonly<Record<EngagementOwnership, number>> = {
	service: 120,
	project: 168,
};

/** A refund window in the words the product uses: whole days when it is whole days, else hours. */
export function ttlWindowLabel(hours: number): string {
	const h = Math.max(1, Math.trunc(hours));
	if (h % 24 === 0) {
		const days = h / 24;
		return `${days} ${days === 1 ? "day" : "days"}`;
	}
	return `${h} ${h === 1 ? "hour" : "hours"}`;
}

/** The escrow guarantee stated under a ticket's funding total. */
export function escrowGuaranteeLine(hours: number): string {
	return `Held in escrow · Auto-refunded to your wallet if unclaimed after ${
		ttlWindowLabel(hours)
	}`;
}
// #endregion

// #region The stage a ticket is funded in
/** One stage a ticket lists, as `projects.tickets.required_stages` stores it. */
export interface ListedStage {
	stageId: string;
	order: number;
}

/**
 * The stage a ticket is funded in — `projects.fn_ticket_funding_stage`: the stage it sits in, else, for a
 * ticket in the stage-less New lane, the first stage it lists by its own order (ties by list position).
 */
export function fundingStageOf(
	currentStageId: string | null,
	listed: readonly ListedStage[],
): string | null {
	if (currentStageId !== null) return currentStageId;
	const first = listed
		.map((s, i) => ({ s, i }))
		.sort((a, b) => a.s.order - b.s.order || a.i - b.i)[0];
	return first?.s.stageId ?? null;
}

/** `required_stages` jsonb as {@link ListedStage}s; anything malformed is dropped. */
export function listedStagesOf(raw: unknown): ListedStage[] {
	if (!Array.isArray(raw)) return [];
	const out: ListedStage[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue;
		const stageId = (entry as Record<string, unknown>).stage_id;
		const order = Number((entry as Record<string, unknown>).order ?? 0);
		if (typeof stageId === "string" && stageId) {
			out.push({ stageId, order: Number.isFinite(order) ? order : 0 });
		}
	}
	return out;
}
// #endregion

// #region Ticket funding quote
/**
 * Where a stage stands in one ticket's funding: `done` (the ticket has passed it), `now` (the stage it is
 * funded in, unpaid), `funded` (that stage, held), `later` (a stage it has not reached, unpaid: prepaid
 * now if chosen, else held by the Chain Reaction on arrival, #210), `prepaid` (a later stage already
 * paid for, a `reserved` escrow held when the ticket reaches it, Decision #430).
 */
export const TicketFundingPhase = z.enum(["done", "now", "funded", "later", "prepaid"]);
export type TicketFundingPhase = z.infer<typeof TicketFundingPhase>;

/**
 * Why nothing on a ticket can be funded now — `projects.fund_ticket`'s ticket gates in its order, then,
 * when no stage is `fundable`, why not: every remaining stage is paid for, the funding stage has
 * finished, or none is priced.
 */
export const TicketFundingBlock = z.enum([
	"description",
	"finished",
	"paid",
	"no_stage",
	"stage_finished",
	"unpriced",
]);
export type TicketFundingBlock = z.infer<typeof TicketFundingBlock>;

/** One sentence per {@link TicketFundingBlock}, for every surface that says why. */
export const TICKET_FUNDING_BLOCK_SENTENCE: Readonly<Record<TicketFundingBlock, string>> = {
	description: "Add a description to this ticket before it can be bought.",
	finished: "This ticket is finished, so there is nothing left to fund.",
	paid: "Every stage this ticket still runs through is already paid for.",
	no_stage: "Add a stage to this ticket before it can be bought.",
	stage_finished: "The stage this ticket is funded in has finished.",
	unpriced: "This ticket's unpaid stages have no price yet.",
};

/** One stage of a {@link TicketFundingQuote}, at this ticket's own price there. */
export const TicketFundingStageSchema = z.object({
	stageId: ref,
	/** The stage's `stg-…` slug — what a basket line names it by (`BasketItem.stageId`); `null` when unknown. */
	slug: z.string().max(80).nullable().default(null),
	name: z.string().max(120),
	/** Position within the ticket's own order, 0-based. */
	order: z.number().int().min(0),
	/** `project_stages.status` as stored. */
	stageStatus: z.string().max(20),
	phase: TicketFundingPhase,
	/** `null` while the stage has no price for this ticket. */
	amount: MoneyViewSchema.nullable(),
	/**
	 * Whether the payer can buy this stage now: a `now` or `later` stage that is priced and has not
	 * finished, on a ticket nothing blocks. The server's answer (`projects.fn_ticket_stage_fundable`).
	 */
	fundable: z.boolean().default(false),
});
export type TicketFundingStage = z.infer<typeof TicketFundingStageSchema>;

/**
 * What funding one ticket takes, read before Buy now or Add to basket (`projects.get_ticket_funding_quote`,
 * Decisions #428, #430). Any `fundable` stage can be bought now: the stage it is funded in is held at
 * once, and a later one is prepaid (`reserved`) and held when the ticket reaches it. Every figure is
 * server-formatted in the project's currency.
 */
export const TicketFundingQuoteSchema = z.object({
	/** The project's row id — what the card intent names; never routed (Decision #88). */
	projectId: ref,
	ticketId: ref,
	ticketSlug: z.string().max(40),
	ticketTitle: z.string().max(200),
	/** The stage paid now: where the ticket sits, else the first stage a New ticket runs through. */
	fundingStageId: ref.nullable(),
	fundingStageName: z.string().max(120).nullable(),
	/** What is paid now. */
	amount: MoneyViewSchema,
	blocked: TicketFundingBlock.nullable(),
	stages: z.array(TicketFundingStageSchema).max(50),
	engagement: EngagementOwnership,
	/** The prepaid refund window, from the database's params. */
	escrowTtlHours: z.number().int().min(1),
	/** Held with no payee, so the refund window runs: nobody holds the ticket or a team seat on its stage. */
	prepaid: z.boolean(),
	payer: z.object({ scope: z.enum(["business", "personal"]), id: ref }),
	walletBalance: MoneyViewSchema,
});
export type TicketFundingQuote = z.infer<typeof TicketFundingQuoteSchema>;

/** The stages a quote lets the payer buy now, in the ticket's order; none while the ticket is blocked. */
export function fundableStageIds(
	quote: Pick<TicketFundingQuote, "blocked" | "stages">,
): string[] {
	if (quote.blocked !== null) return [];
	return [...quote.stages].sort((a, b) => a.order - b.order).filter((s) => s.fundable).map((s) =>
		s.stageId
	);
}

/**
 * The selection a stage picker opens on: the stage the ticket is funded in while it can be bought, else
 * the first stage that can; empty when none can.
 */
export function defaultStageSelection(
	quote: Pick<TicketFundingQuote, "blocked" | "stages" | "fundingStageId">,
): string[] {
	const fundable = fundableStageIds(quote);
	if (quote.fundingStageId && fundable.includes(quote.fundingStageId)) return [quote.fundingStageId];
	return fundable.slice(0, 1);
}

/** The refusal for a selection that names a stage that cannot be bought now. */
export const STAGE_SELECTION_REFUSAL =
	"That stage can't be paid for now: it has finished, is already paid for, or isn't on this ticket.";

/**
 * Why a requested stage selection cannot be funded now, or `null` when it can. An absent or empty
 * selection means the funding stage. Shared by the escrow intent, the basket and the stage pickers.
 */
export function stageSelectionRefusal(
	fundable: readonly string[],
	requested: readonly string[] | null | undefined,
): string | null {
	if (!requested || requested.length === 0) return null;
	return requested.every((id) => fundable.includes(id)) ? null : STAGE_SELECTION_REFUSAL;
}

/** Whether buying a ticket asks which of its stages first: it runs through several stages. */
export function needsStageSelector(stageCount: number): boolean {
	return stageCount > 1;
}

/** What a prepaid later stage means for the payer, stated beside every stage picker. */
export const PREPAY_TERMS =
	"A later stage you pay for now is held in escrow when the ticket reaches it, and comes back to your wallet if the ticket ends first.";

/** A same-currency {@link MoneyView}: nothing was converted, so there is no origin to disclose. */
export function sameCurrencyMoney(minor: number, code: string, locale?: string): MoneyView {
	return { minor, currency: code, display: formatMoney(minor, code, locale), origin: null };
}

/** `GET /api/finance/escrow/quote` — the project's `prj-…` slug and EITHER a stage or a ticket. */
export const EscrowQuoteQuerySchema = z.object({
	project: z.string().min(1).max(64),
	stage: z.string().min(1).max(80).optional(),
	ticket: z.string().min(1).max(80).optional(),
}).refine((q) => (q.stage === undefined) !== (q.ticket === undefined), {
	message: "Name a stage or a ticket, not both.",
	path: ["ticket"],
});
export type EscrowQuoteQuery = z.infer<typeof EscrowQuoteQuerySchema>;
// #endregion
