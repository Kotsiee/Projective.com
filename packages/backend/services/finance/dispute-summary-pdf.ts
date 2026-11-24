import {
	DEFAULT_LOCALE,
	type DisputeCase,
	type DisputeParty,
	type DisputeStatus,
	type DisputeVaultRead,
	formatMoney,
	ticketDisputeSideLabel,
	ticketDisputeSideOf,
} from "@projective/types/finance";
import type { PdfBlock, PdfDocument } from "../../core/pdf.ts";
import { PDF_TEXT_WIDTH, wrapText } from "../legal/legal-pdf.ts";

/**
 * dispute-summary-pdf — a ticket case's summary as a PDF document (PROJECTS EX3): the case, its
 * timeline, the statements with their evidence, the offers, the ruling, and the Evidence Vault's hash,
 * so either party (or an auditor) holds one printable record of what was raised and what was frozen.
 * Pure: it lays out what `finance.get_dispute` and `finance.get_dispute_vault` returned to the reader,
 * nothing more. Pinned by `dispute-summary-pdf.test.ts`.
 */

// #region Layout
const BODY = 10;
const META = 9;

const STATUS: Record<DisputeStatus, string> = {
	open: "Claim open",
	awaiting_response: "Awaiting response",
	under_review: "Under review",
	resolved_release: "Released",
	resolved_refund: "Refunded",
	resolved_split: "Split",
};

function when(iso: string | null | undefined): string {
	if (!iso) return "—";
	const ms = Date.parse(iso);
	return Number.isFinite(ms)
		? new Date(ms).toLocaleString("en-GB", {
			day: "numeric",
			month: "short",
			year: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			timeZone: "UTC",
		}) + " UTC"
		: "—";
}

function party(d: DisputeCase, p: DisputeParty): string {
	if (p === "operator") return "Projective auditor";
	return d.ticket ? ticketDisputeSideLabel(ticketDisputeSideOf(p, d.ticket.claimantSide)) : p;
}

function heading(text: string): PdfBlock[] {
	return [
		{ kind: "space", points: 12 },
		{ kind: "row", left: { text, size: 12, bold: true } },
		{ kind: "rule" },
	];
}

function fact(label: string, value: string): PdfBlock {
	return { kind: "row", left: { text: label, size: META }, right: { text: value, size: META } };
}

function prose(text: string, size = BODY): PdfBlock[] {
	return text.split(/\n+/).flatMap((para) =>
		wrapText(para, size, PDF_TEXT_WIDTH).map((line): PdfBlock => ({
			kind: "row",
			left: { text: line, size },
		}))
	);
}

function count(manifest: Record<string, unknown>, key: string, one: string, many: string): string {
	const v = manifest[key];
	const n = Array.isArray(v) ? v.length : 0;
	return `${n} ${n === 1 ? one : many}`;
}
// #endregion

/** The summary's file name: the case's short reference, never anything a party typed. */
export function disputeSummaryFilename(disputeId: string): string {
	return `dispute-${disputeId.slice(0, 8)}-summary.pdf`;
}

/** Lay out a case and its vault (null when the reader gets none) as the summary document. */
export function disputeSummaryDocument(
	d: DisputeCase,
	vault: DisputeVaultRead | null,
): PdfDocument {
	const money = (minor: number) => formatMoney(minor, d.currency, DEFAULT_LOCALE);
	const claimant = party(d, "claimant");
	const blocks: PdfBlock[] = [
		{
			kind: "row",
			left: { text: "Projective", size: 11, bold: true },
			right: { text: "DISPUTE SUMMARY", size: 11, bold: true },
		},
		{ kind: "space", points: 10 },
		{
			kind: "row",
			left: { text: `Dispute ${d.id.slice(0, 8).toUpperCase()}`, size: 18, bold: true },
		},
		...prose(d.reason),
		{ kind: "space", points: 8 },
		fact("Status", STATUS[d.status]),
		fact("Raised by", claimant),
		...(d.ticket
			? [
				fact("Ticket", d.ticket.title),
				fact("Stage", d.ticket.stageName || "—"),
				fact(
					d.ticket.window === "pending" ? "Clearing earnings at stake" : "Payment at stake",
					money(d.amountMinor),
				),
			]
			: [fact("At stake", money(d.amountMinor))]),
	];

	// #region Timeline
	const events: { at: string; text: string }[] = [{
		at: d.openedAt,
		text: `${claimant} raised the dispute`,
	}];
	if (d.respondedAt) {
		events.push({ at: d.respondedAt, text: `${party(d, "respondent")} responded` });
	}
	if (d.escalatedAt) events.push({ at: d.escalatedAt, text: "Sent to a Projective auditor" });
	for (const o of d.offers ?? []) {
		events.push({
			at: o.createdAt,
			text: `${party(d, o.party)} offered ${o.payeeShareBp / 100}% to the freelancer`,
		});
		if (o.acceptedAt) events.push({ at: o.acceptedAt, text: "The offer was accepted" });
	}
	if (d.resolvedAt) events.push({ at: d.resolvedAt, text: `Settled: ${STATUS[d.status]}` });
	events.sort((a, b) => a.at.localeCompare(b.at));
	blocks.push(...heading("Timeline"), ...events.map((e) => fact(e.text, when(e.at))));
	// #endregion

	// #region Statements
	blocks.push(...heading("Statements and evidence"));
	for (const m of d.messages) {
		blocks.push(
			{ kind: "space", points: 4 },
			{
				kind: "row",
				left: { text: party(d, m.party), size: BODY, bold: true },
				right: { text: when(m.createdAt), size: META },
			},
			...prose(m.body),
			...(m.files.length ? prose(`Evidence: ${m.files.map((f) => f.name).join(", ")}`, META) : []),
		);
	}
	// #endregion

	// #region Offers
	if (d.offers?.length) {
		blocks.push(...heading("Offers"));
		for (const o of d.offers) {
			blocks.push(
				{ kind: "space", points: 4 },
				{
					kind: "row",
					left: {
						text: `${party(d, o.party)}: ${o.payeeShareBp / 100}% to the freelancer`,
						size: BODY,
						bold: true,
					},
					right: {
						text: o.acceptedAt ? "Accepted" : o.standing ? "Standing" : "Superseded",
						size: META,
					},
				},
				fact("To the freelancer", money(o.payeeMinor)),
				fact("Platform fee", money(o.feeMinor)),
				fact("Back to the client", money(o.refundMinor)),
				...(o.note ? prose(o.note, META) : []),
			);
		}
	}
	// #endregion

	// #region Ruling
	if (d.resolvedAt) {
		blocks.push(
			...heading(d.resolvedByOperator ? "The auditor's ruling" : "Outcome"),
			fact("Outcome", STATUS[d.status]),
		);
		if (d.settlement && !d.settlement.byFact && !d.settlement.deferred) {
			blocks.push(
				fact("Paid to the freelancer", money(d.settlement.payeeMinor)),
				fact("Back to the client", money(d.settlement.refundMinor)),
			);
		}
		if (d.resolutionNotes) blocks.push(...prose(d.resolutionNotes));
	}
	// #endregion

	// #region Evidence Vault
	if (vault) {
		blocks.push(
			...heading("Evidence Vault"),
			fact("Frozen", when(vault.createdAt)),
			fact(
				"Files",
				vault.status === "ready" ? "Copied into the vault" : "Being copied into the vault",
			),
			fact(
				"Snapshot",
				[
					count(vault.manifest, "submissions", "submission", "submissions"),
					count(vault.manifest, "history", "history entry", "history entries"),
					count(vault.manifest, "messages", "message", "messages"),
				].join(" · "),
			),
			{ kind: "row", left: { text: "SHA-256 of the manifest", size: META } },
			{ kind: "row", left: { text: vault.sha256, size: META } },
		);
	}
	// #endregion

	return {
		title: `Dispute ${d.id.slice(0, 8).toUpperCase()} summary`,
		blocks,
		running: {
			text: `Projective dispute summary · generated ${when(new Date().toISOString())}`,
			size: 7,
		},
	};
}
