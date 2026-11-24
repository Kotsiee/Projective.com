import { assert, assertEquals } from "@std/assert";
import {
	type DisputeCase,
	DisputeCaseSchema,
	type DisputeVaultRead,
} from "@projective/types/finance";
import type { PdfBlock } from "../../core/pdf.ts";
import { renderPdf } from "../../core/pdf.ts";
import { disputeSummaryDocument, disputeSummaryFilename } from "./dispute-summary-pdf.ts";

/*
 * The case summary PDF (PROJECTS EX3): it must name the case, the sides as the ticket's (never "claimant"),
 * every statement, offer and the ruling, and the vault's full hash, so the printed record can be checked
 * against the manifest.
 */

// #region Fixtures
const ID = "11111111-1111-4111-8111-111111111111";
const HASH = "3f".repeat(32);

const CASE: DisputeCase = DisputeCaseSchema.parse({
	id: ID,
	kind: "ticket",
	status: "resolved_split",
	role: "claimant",
	reason: "The delivered work does not meet the brief.",
	openedAt: "2026-11-24T10:00:00.000Z",
	respondBy: null,
	respondedAt: "2026-11-24T12:00:00.000Z",
	escalatedAt: null,
	reviewBy: null,
	resolvedAt: "2026-11-25T09:00:00.000Z",
	resolutionNotes: null,
	resolvedByOperator: false,
	payeeShareBp: 4000,
	settlement: {
		payeeMinor: 38_000,
		feeMinor: 2_000,
		refundMinor: 60_000,
		currency: "USD",
		deferred: false,
		byFact: false,
		payeeLabel: "$380.00",
		feeLabel: "$20.00",
		refundLabel: "$600.00",
	},
	audit: null,
	room: null,
	amountMinor: 100_000,
	currency: "USD",
	amountLabel: "$1,000.00",
	projectSlug: "prj-abcdefghjk",
	purchaseTitle: null,
	sitting: null,
	messages: [{
		id: ID,
		party: "claimant",
		body: "The checkout flow is missing. ".repeat(40),
		createdAt: "2026-11-24T10:00:00.000Z",
		mine: true,
		files: [{ id: ID, name: "brief.pdf", mimeType: "application/pdf", sizeBytes: 10 }],
	}],
	ticket: {
		id: ID,
		slug: "tkt-abcdefghjk",
		title: "Checkout redesign",
		stageId: ID,
		stageName: "Design",
		claimantSide: "payer",
		window: "held",
		feeBp: 500,
		escrowAmounts: [100_000],
	},
	offers: [{
		id: ID,
		party: "respondent",
		payeeShareBp: 4000,
		note: null,
		createdAt: "2026-11-24T13:00:00.000Z",
		acceptedAt: "2026-11-25T09:00:00.000Z",
		mine: false,
		standing: true,
		canAccept: false,
		payeeMinor: 38_000,
		feeMinor: 2_000,
		refundMinor: 60_000,
	}],
	vault: { status: "ready", sha256: HASH, createdAt: "2026-11-24T10:00:00.000Z" },
	canRespond: false,
	canEscalate: false,
	canOffer: false,
	canResolve: false,
});

const VAULT: DisputeVaultRead = {
	disputeId: ID,
	role: "claimant",
	status: "ready",
	sha256: HASH,
	createdAt: "2026-11-24T10:00:00.000Z",
	manifest: { submissions: [{}], history: [{}, {}], messages: [] },
	objectPrefix: null,
};

function text(blocks: PdfBlock[]): string[] {
	return blocks.flatMap((b) => b.kind === "row" ? [b.left.text, b.right?.text ?? ""] : []);
}
// #endregion

Deno.test("the summary names the case, its sides, timeline, offers, ruling and the vault's hash", () => {
	const doc = disputeSummaryDocument(CASE, VAULT);
	const lines = text(doc.blocks);
	for (
		const expected of [
			"DISPUTE SUMMARY",
			"Dispute 11111111",
			"Checkout redesign",
			"The client raised the dispute",
			"The freelancer offered 40% to the freelancer",
			"The offer was accepted",
			"Settled: Split",
			"Outcome",
			"Evidence Vault",
			"1 submission · 2 history entries · 0 messages",
			HASH,
		]
	) assert(lines.includes(expected), expected);
	assert(lines.some((l) => l.startsWith("Evidence: brief.pdf")));
	assert(
		!lines.some((l) => /claimant|respondent/i.test(l)),
		"sides are the ticket's, never the roles",
	);
	assertEquals(lines.filter((l) => l.startsWith("The checkout flow")).length > 0, true);
});

Deno.test("with no vault for its reader the summary leaves the vault out, and the file still renders", () => {
	const lines = text(disputeSummaryDocument(CASE, null).blocks);
	assert(!lines.includes("Evidence Vault"));
	const bytes = renderPdf(disputeSummaryDocument(CASE, VAULT));
	assertEquals(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
	assertEquals(disputeSummaryFilename(ID), "dispute-11111111-summary.pdf");
});
