import {
	defaultStageSelection,
	fundableStageIds,
	type MoneyView,
	type TicketFundingPhase,
	type TicketFundingQuote,
} from "@projective/types/finance";
import type { BasketItem } from "../types/checkout-types.ts";

/**
 * stage-picker — the pure model behind a ticket's stage picker (Decision #430): which stages can be
 * chosen, what each one says, and how a selection changes. The quote's `fundable` flag is the server's;
 * nothing here decides what can be bought or adds up money.
 */

// #region Rows
/** One row of a ticket's stage picker, in the ticket's order. */
export interface StagePickerRow {
	stageId: string;
	name: string;
	phase: TicketFundingPhase;
	/** `null` while the stage has no price for this ticket. */
	amount: MoneyView | null;
	/** Whether the row offers a checkbox. */
	fundable: boolean;
}

/** The quote's stages as picker rows; nothing is fundable while the ticket is blocked. */
export function stagePickerRows(quote: TicketFundingQuote): StagePickerRow[] {
	const fundable = new Set(fundableStageIds(quote));
	return [...quote.stages].sort((a, b) => a.order - b.order).map((s) => ({
		stageId: s.stageId,
		name: s.name,
		phase: s.phase,
		amount: s.amount,
		fundable: fundable.has(s.stageId),
	}));
}

/** What a row says beside its price, in the meta register. */
export function stagePhaseNote(phase: TicketFundingPhase, selected: boolean): string {
	switch (phase) {
		case "done":
			return "Finished";
		case "funded":
			return "Held in escrow";
		case "prepaid":
			return "Prepaid · held when the ticket reaches it";
		case "now":
			return selected ? "Held in escrow as soon as you pay" : "Not paid yet";
		case "later":
		default:
			return selected
				? "Prepaid now · held when the ticket reaches it"
				: "Paid when the ticket reaches it";
	}
}
// #endregion

// #region Selection
/**
 * `ids` narrowed to the quote's fundable stages, in the ticket's order, each once. A stage may be named
 * by its row id or by its `stg-…` slug, which is how a basket line names it.
 */
export function normaliseSelection(
	quote: TicketFundingQuote,
	ids: readonly string[],
): string[] {
	const byRef = new Map<string, string>();
	for (const s of quote.stages) {
		byRef.set(s.stageId, s.stageId);
		if (s.slug) byRef.set(s.slug, s.stageId);
	}
	const wanted = new Set(ids.flatMap((id) => {
		const stageId = byRef.get(id);
		return stageId ? [stageId] : [];
	}));
	return fundableStageIds(quote).filter((id) => wanted.has(id));
}

/** The selection after one stage is ticked or cleared. */
export function toggleStage(
	quote: TicketFundingQuote,
	selected: readonly string[],
	stageId: string,
	on: boolean,
): string[] {
	const rest = selected.filter((id) => id !== stageId);
	return normaliseSelection(quote, on ? [...rest, stageId] : rest);
}

/** Every fundable stage, or none. */
export function selectAllStages(quote: TicketFundingQuote, on: boolean): string[] {
	return on ? fundableStageIds(quote) : [];
}

/** How much of the fundable set a selection covers — what "Select all stages" shows. */
export type SelectAllState = "all" | "some" | "none";

/** Where "Select all stages" stands for this selection. */
export function selectAllState(
	quote: TicketFundingQuote,
	selected: readonly string[],
): SelectAllState {
	const fundable = fundableStageIds(quote);
	const chosen = normaliseSelection(quote, selected).length;
	if (chosen === 0) return "none";
	return chosen === fundable.length ? "all" : "some";
}

/** Whether the selection pays ahead for a stage the ticket has not reached. */
export function selectsLaterStage(
	quote: TicketFundingQuote,
	selected: readonly string[],
): boolean {
	const chosen = new Set(selected);
	return quote.stages.some((s) => s.phase === "later" && chosen.has(s.stageId));
}

/** Whether the selection is the same set of stages as `other`. */
export function sameSelection(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	const set = new Set(a);
	return b.every((id) => set.has(id));
}
// #endregion

// #region The basket's lines for one ticket
/** The facts of a basket line the picker reads. */
export type TicketLineFacts = Pick<BasketItem, "ticketId" | "stageId" | "savedForLater">;

/** Whether a basket line belongs to this ticket, named by its `tkt-…` slug or its row id. */
export function isTicketLine(item: TicketLineFacts, ticketRefs: readonly string[]): boolean {
	return !!item.ticketId && ticketRefs.includes(item.ticketId);
}

/** The stages this ticket already has live (unparked) lines for in the basket. */
export function basketStagesOf(
	items: readonly TicketLineFacts[],
	ticketRefs: readonly string[],
): string[] {
	return items.flatMap((item) =>
		isTicketLine(item, ticketRefs) && !item.savedForLater && item.stageId ? [item.stageId] : []
	);
}

/**
 * The selection a picker opens on: the stages already in the basket that can still be bought, else
 * the quote's default — the stage the ticket is funded in, or the first that can be.
 */
export function initialStageSelection(
	quote: TicketFundingQuote,
	inBasket: readonly string[],
): string[] {
	const held = normaliseSelection(quote, inBasket);
	return held.length > 0 ? held : defaultStageSelection(quote);
}
// #endregion

// #region Dev preview
/** How the Dev Context Switcher previews a ticket's prepaid stages. */
export type PrepaidPreview = "auto" | "none" | "later";

/**
 * The quote as the dev preview shows it — display only, the server still answers from the real
 * escrows. `later` marks every unreached stage prepaid; `none` offers every prepaid stage again.
 */
export function previewQuote(quote: TicketFundingQuote, mode: PrepaidPreview): TicketFundingQuote {
	if (mode === "auto") return quote;
	const stages = quote.stages.map((s) => {
		if (mode === "later" && s.phase === "later") {
			return { ...s, phase: "prepaid" as const, fundable: false };
		}
		if (mode === "none" && s.phase === "prepaid") {
			return { ...s, phase: "later" as const, fundable: (s.amount?.minor ?? 0) > 0 };
		}
		return s;
	});
	const anyFundable = stages.some((s) => s.fundable);
	const blocked = quote.blocked === null && !anyFundable
		? "paid"
		: quote.blocked === "paid" && anyFundable
		? null
		: quote.blocked;
	return { ...quote, stages, blocked };
}
// #endregion
