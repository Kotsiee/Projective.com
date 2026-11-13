import { assert, assertEquals } from "@std/assert";
import type { TicketFundingQuote, TicketFundingStage } from "@projective/types/finance";
import {
	basketStagesOf,
	initialStageSelection,
	normaliseSelection,
	previewQuote,
	sameSelection,
	selectAllStages,
	selectAllState,
	selectsLaterStage,
	stagePhaseNote,
	stagePickerRows,
	type TicketLineFacts,
	toggleStage,
} from "./stage-picker.ts";

const money = (minor: number) => ({
	minor,
	currency: "USD",
	display: `$${minor / 100}`,
	origin: null,
});

function stage(
	id: string,
	order: number,
	phase: TicketFundingStage["phase"],
	fundable: boolean,
): TicketFundingStage {
	return {
		stageId: id,
		slug: `stg-${id}`,
		name: `Stage ${id}`,
		order,
		stageStatus: "open",
		phase,
		amount: money(10_000),
		fundable,
	};
}

function quote(
	stages: TicketFundingStage[],
	blocked: TicketFundingQuote["blocked"] = null,
): TicketFundingQuote {
	return {
		projectId: "p",
		ticketId: "t",
		ticketSlug: "tkt-abc",
		ticketTitle: "Ticket",
		fundingStageId: stages.find((s) => s.phase === "now" || s.phase === "funded")?.stageId ?? null,
		fundingStageName: null,
		amount: money(10_000),
		blocked,
		stages,
		engagement: "project",
		escrowTtlHours: 168,
		prepaid: true,
		payer: { scope: "personal", id: "u" },
		walletBalance: money(0),
	};
}

const THREE = quote([
	stage("c", 2, "later", true),
	stage("a", 0, "now", true),
	stage("b", 1, "later", true),
]);

Deno.test("rows follow the ticket's order and a blocked ticket offers no checkbox", () => {
	assertEquals(stagePickerRows(THREE).map((r) => r.stageId), ["a", "b", "c"]);
	assert(stagePickerRows(THREE).every((r) => r.fundable));
	const blocked = quote([stage("a", 0, "now", true)], "description");
	assertEquals(stagePickerRows(blocked)[0].fundable, false);
});

Deno.test("a selection keeps only fundable stages, in order, each once", () => {
	const mixed = quote([
		stage("a", 0, "funded", false),
		stage("b", 1, "later", true),
		stage("c", 2, "prepaid", false),
	]);
	assertEquals(normaliseSelection(mixed, ["c", "b", "a", "b"]), ["b"]);
	assertEquals(toggleStage(THREE, ["c"], "a", true), ["a", "c"]);
	assertEquals(toggleStage(THREE, ["a", "c"], "a", false), ["c"]);
});

Deno.test("select all covers every fundable stage and reports partial selections", () => {
	assertEquals(selectAllStages(THREE, true), ["a", "b", "c"]);
	assertEquals(selectAllStages(THREE, false), []);
	assertEquals(selectAllState(THREE, []), "none");
	assertEquals(selectAllState(THREE, ["b"]), "some");
	assertEquals(selectAllState(THREE, ["c", "a", "b"]), "all");
});

Deno.test("paying ahead is noticed and the phase note follows the selection", () => {
	assert(!selectsLaterStage(THREE, ["a"]));
	assert(selectsLaterStage(THREE, ["a", "c"]));
	assertEquals(stagePhaseNote("later", true), "Prepaid now · held when the ticket reaches it");
	assertEquals(stagePhaseNote("later", false), "Paid when the ticket reaches it");
	assertEquals(stagePhaseNote("prepaid", false), "Prepaid · held when the ticket reaches it");
	assert(sameSelection(["a", "b"], ["b", "a"]));
	assert(!sameSelection(["a"], ["a", "b"]));
});

Deno.test("the picker opens on the ticket's basket stages, else the stage it is funded in", () => {
	const line = (ticketId: string, stageId: string, savedForLater = false): TicketLineFacts => ({
		ticketId,
		stageId,
		savedForLater,
	});
	const items = [line("tkt-abc", "c"), line("tkt-abc", "b", true), line("tkt-other", "a")];
	assertEquals(basketStagesOf(items, ["tkt-abc", "t"]), ["c"]);
	assertEquals(initialStageSelection(THREE, ["c"]), ["c"]);
	assertEquals(initialStageSelection(THREE, ["gone"]), ["a"]);
	const nowFunded = quote([stage("a", 0, "funded", false), stage("b", 1, "later", true)]);
	assertEquals(initialStageSelection(nowFunded, []), ["b"]);
});

Deno.test("the dev preview marks later stages prepaid or offers prepaid ones again", () => {
	const later = previewQuote(THREE, "later");
	assertEquals(later.stages.filter((s) => s.phase === "prepaid").map((s) => s.stageId).sort(), [
		"b",
		"c",
	]);
	assertEquals(stagePickerRows(later).filter((r) => r.fundable).map((r) => r.stageId), ["a"]);
	const allPrepaid = previewQuote(
		quote([stage("a", 0, "funded", false), stage("b", 1, "later", true)]),
		"later",
	);
	assertEquals(allPrepaid.blocked, "paid");
	const reopened = previewQuote(allPrepaid, "none");
	assertEquals(reopened.blocked, null);
	assertEquals(stagePickerRows(reopened).filter((r) => r.fundable).map((r) => r.stageId), ["b"]);
	assertEquals(previewQuote(THREE, "auto"), THREE);
});

Deno.test("a basket line naming its stage by slug is the same stage as the quote's row id (#430)", () => {
	const q = quote([stage("a", 0, "now", true), stage("b", 1, "later", true), stage("c", 2, "later", true)]);
	assertEquals(normaliseSelection(q, ["stg-c", "a", "stg-zzz"]), ["a", "c"]);
	assertEquals(initialStageSelection(q, ["stg-b"]), ["b"]);
});
