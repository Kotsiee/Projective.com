import type { EntityView, ProjectViewExtra } from "@projective/types/explore";
import type { PriceAmount } from "@features/explore/core/pricing.ts";
import type { LaneLedgerRow } from "../components/lane-parts.tsx";

/**
 * View feature — the pure projections behind the Projects archetype (`/view/[id]?type=projects`).
 *
 * Every figure the project's three regions print — the hero's meta line, the lane's ledger, the
 * body's details ledger, and the transactional block below the frame breakpoint — is derived here
 * and nowhere else, so the desktop lane and the phone apply-bar cannot quote the brief differently
 * (§D.7.4 applied to the data, not only to the layout). No JSX, no side effects (SSR == island).
 */

// #region Currency
/**
 * The currency a project's ticket prices are quoted in.
 *
 * `TicketPrice.min`/`max` are MAJOR units in the listing's own currency, and a project carries no
 * `currency` field of its own — the corpus prices every brief in USD. The fallback is the SAME one
 * `StageProgressLedger` applies, so the lane figure and the stage ledger cannot label one number two
 * ways.
 */
export const PROJECT_CURRENCY = "USD";
// #endregion

// #region Headline price
/**
 * The project's headline figure — the per-ticket price across every stage.
 *
 * A Pipeline spans a RANGE (the cheapest stage's floor to the dearest's ceiling); the lane shows the
 * floor with `isFloor` set, exactly as the service lane does for a pipeline service, and the stage
 * ledger prints each stage's own figure where there is room to explain what moves it. A One-Off
 * collapses to one fixed amount and is announced as such — prefixing it with "From" would invent an
 * open-ended cost the client never offered.
 */
export function projectTicketPrice(
	project: ProjectViewExtra,
): { amount: PriceAmount | null; fallback: string; unit: string; isFloor: boolean } {
	const { ticketPrice } = project.finance;
	const hasFigure = Number.isFinite(ticketPrice.min) && ticketPrice.min > 0;
	return {
		amount: hasFigure
			? { minor: Math.round(ticketPrice.min * 100), currency: PROJECT_CURRENCY }
			: null,
		fallback: ticketPrice.label || "Price on application",
		unit: "ticket",
		isFloor: ticketPrice.max > ticketPrice.min,
	};
}
// #endregion

// #region Details ledger
/**
 * The body's "Project details" rows — classification-tailored (§8 Decision #44: no generic
 * Client / Current-stage / Engagement cells). A Pipeline adds its live stage and its stage count; both
 * shapes carry the open-seat position.
 *
 * The ticket price is deliberately NOT here: it is the offer's headline figure and the offer has one
 * home (§D.7.3) — the lane on desktop, the apply bar below the frame breakpoint.
 */
export function projectDetailRows(view: EntityView, project: ProjectViewExtra): LaneLedgerRow[] {
	const isPipeline = project.classification === "pipeline";
	const rows: LaneLedgerRow[] = [{ label: "Project type", value: project.classificationLabel }];
	if (isPipeline && project.stage) rows.push({ label: "Current stage", value: project.stage });
	if (isPipeline) rows.push({ label: "Stages", value: `${project.stages.length}` });
	rows.push({ label: "Open seats", value: seatSentence(project) });
	if (view.item.type === "projects" && view.item.org) {
		rows.push({ label: "Posted by", value: view.item.org });
	}
	return rows;
}

/** The lane's summary ledger — the same facts, condensed to what a decision needs at a glance. */
export function projectLaneRows(project: ProjectViewExtra): LaneLedgerRow[] {
	const isPipeline = project.classification === "pipeline";
	const rows: LaneLedgerRow[] = [];
	if (isPipeline && project.stage) {
		const active = project.stages.find((s) => s.status === "active");
		rows.push({
			label: "Stage",
			value: active ? `${active.index} of ${project.stages.length}` : project.stage,
			note: active ? active.name : undefined,
		});
	}
	rows.push({
		label: "Open seats",
		value: `${project.finance.openSeats} of ${project.finance.totalSeats}`,
		note: isPipeline ? `across ${project.stages.length} stages` : undefined,
	});
	rows.push({ label: "Type", value: project.classificationLabel });
	return rows;
}

/** "3 of 7 seats open across 5 stages" — the one sentence both ledgers agree on. */
function seatSentence(project: ProjectViewExtra): string {
	const { openSeats, totalSeats } = project.finance;
	if (totalSeats <= 0) return "Not set";
	return `${openSeats} of ${totalSeats} open`;
}
// #endregion

// #region Roles
/**
 * The roles the brief is hiring for, as plain strings for a `MetaLine` — metadata, never chips
 * (§B.11.2). Deduped case-insensitively so "Frontend" and "frontend" do not print twice.
 */
export function projectRoles(view: EntityView): string[] {
	if (view.item.type !== "projects") return [];
	const seen = new Set<string>();
	return view.item.roles.filter((role) => {
		const key = role.trim().toLowerCase();
		if (!key || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
// #endregion

// #region Headings
/** The section heading above the stage ledger: a run of stages, or a single delivery. */
export function projectStagesHeading(project: ProjectViewExtra): string {
	return project.classification === "pipeline" ? "Stages" : "Delivery";
}
// #endregion
