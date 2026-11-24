import type {
	ProjectSaleRequests,
	SaleRequestStatus,
	SaleRequestView,
} from "@projective/types/catalogue";

/**
 * The development-only request-to-sell simulation (MARKETPLACE SC7, root CLAUDE.md §5).
 *
 * Which state a request to sell is in, and which side the viewer is on, is the DATABASE's answer
 * (`catalogue.project_sale_requests`), and the seed holds no request at all. The Dev Context Switcher
 * writes this cookie instead, and the Overview honours it only in development: the read is restated so
 * the "Requests to sell" block and its dialog can be seen as the maker who may ask, the maker waiting,
 * granted or declined, and the client deciding. It grants nothing: a write from a simulated state still
 * meets the doors, which refuse what the real state does not allow.
 *
 * Pure, and free of `IS_DEV`/`import.meta.env`, so it loads under `deno test`.
 */

// #region Contract
/** The cookie the Dev Context Switcher writes and the Overview reads in development. */
export const SALE_REQUEST_SIM_COOKIE = "pj.dev.sale-request";

/** A simulated state of a project's request to sell, and the viewer's side of it. */
export type SaleRequestSim =
	| "can_request"
	| "requested"
	| "granted"
	| "declined"
	| "client_pending";

const SIMS: ReadonlyArray<SaleRequestSim> = [
	"can_request",
	"requested",
	"granted",
	"declined",
	"client_pending",
];

const SAMPLE_STAGE = {
	stageId: "00000000-0000-4000-8000-000000000493",
	stageSlug: "stg-preview493",
	stageName: "Previewed stage",
};
const SAMPLE_FILE = {
	file_id: "00000000-0000-4000-8000-000000000494",
	name: "previewed-asset.zip",
	bytes: 48_000,
	sha256: "0".repeat(64),
};
// #endregion

// #region Codec
/** Read a cookie value back; anything unrecognised is ignored, so a typo never invents a state. */
export function parseSaleRequestSim(raw: string | null | undefined): SaleRequestSim | null {
	if (!raw) return null;
	return SIMS.find((s) => s === raw) ?? null;
}

/** The sample request in a status, seen from one side. */
function sampleRequest(
	status: SaleRequestStatus,
	role: "maker" | "client",
	now: number,
): SaleRequestView {
	const decided = status === "approved" || status === "declined";
	return {
		id: "00000000-0000-4000-8000-000000000495",
		...SAMPLE_STAGE,
		title: "Previewed asset kit",
		status,
		ipMode: "exclusive_transfer",
		royaltyBp: 1500,
		note: "I'd like to sell the reusable parts of this work.",
		files: [SAMPLE_FILE],
		grantedFileIds: status === "approved" ? [SAMPLE_FILE.file_id] : [],
		scopeNote: status === "approved" ? "The kit only, not our logo." : null,
		decisionNote: status === "declined" ? "Ask again at 10 %." : null,
		createdAt: new Date(now - 86_400_000).toISOString(),
		decidedAt: decided ? new Date(now).toISOString() : null,
		role,
		canDecide: role === "client" && status === "requested",
		canWithdraw: role === "maker" && status === "requested",
		productSlug: status === "approved" && role === "maker" ? "prd-preview493" : null,
	};
}

/**
 * Lay a simulation over what `project_sale_requests` answered. No simulation passes the read through; a
 * simulation answers one sample stage and request in the chosen state, so the surface is reachable.
 */
export function applySaleRequestSim(
	read: ProjectSaleRequests,
	sim: SaleRequestSim | null,
	now = Date.now(),
): ProjectSaleRequests {
	if (!sim) return read;
	const makerStage = {
		...SAMPLE_STAGE,
		ipMode: "exclusive_transfer" as const,
		refusal: null,
		openRequest: sim === "requested",
		files: [SAMPLE_FILE],
	};
	const base = { grantsEnabled: read.grantsEnabled, royaltyMaxBp: read.royaltyMaxBp || 5000 };
	switch (sim) {
		case "can_request":
			return { ...base, stages: [makerStage], requests: [] };
		case "requested":
			return {
				...base,
				stages: [makerStage],
				requests: [sampleRequest("requested", "maker", now)],
			};
		case "granted":
			return { ...base, stages: [makerStage], requests: [sampleRequest("approved", "maker", now)] };
		case "declined":
			return { ...base, stages: [makerStage], requests: [sampleRequest("declined", "maker", now)] };
		case "client_pending":
			return { ...base, stages: [], requests: [sampleRequest("requested", "client", now)] };
	}
}
// #endregion
