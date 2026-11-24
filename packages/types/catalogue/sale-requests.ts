import { z } from "zod";
import { IpOwnershipMode } from "../projects/create.ts";

/**
 * catalogue requests to sell — the Zod SSOT for MARKETPLACE SC7 (Decision #493): a maker asks to sell
 * an asset made on a released stage, the client grants or declines it, and an approved request mints a
 * draft product with provenance whose every sale pays the client a royalty.
 *
 * Every rule is the database's (`00001170` §Requests to sell): who may ask (the paid maker of a
 * `paid` stage), which IP modes need a grant (`exclusive_transfer`, `licensed_use`; `shared_ownership`
 * lists at once, `projective_partner` is refused), the 0–50 % royalty of the seller's net, the grant
 * switch (`sale_grants_enabled`, off until counsel) and the files a draft may deliver. These are the
 * shapes the overview reads and the routes validate.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID_RE, "Expected a UUID.");
const timestamptz = z.string();

// #region Lifecycle
/** `catalogue.sale_requests.status`: requested → approved | declined | withdrawn (PRODUCT_MANAGEMENT §3.11). */
export const SaleRequestStatus = z.enum(["requested", "approved", "declined", "withdrawn"]);
export type SaleRequestStatus = z.infer<typeof SaleRequestStatus>;

/** The IP modes a request can be made under (`ck_sale_requests_ip_mode`); `projective_partner` is refused. */
export const SaleRequestIpMode = IpOwnershipMode.exclude(["projective_partner"]);
export type SaleRequestIpMode = z.infer<typeof SaleRequestIpMode>;

/** The highest royalty a request may propose, in basis points of the seller's net (#493 (A)). */
export const SALE_ROYALTY_MAX_BP = 5000;
// #endregion

// #region The stored row
/** One delivered file a request names, by its whole-file SHA-256 (the provenance link, #493 (b)). */
export const SaleRequestFileSchema = z.object({
	file_id: uuid,
	name: z.string().min(1).max(500),
	bytes: z.number().int().min(0).nullable(),
	sha256: z.string().regex(/^[0-9a-f]{64}$/i).nullable(),
});
export type SaleRequestFile = z.infer<typeof SaleRequestFileSchema>;

/** A `catalogue.sale_requests` row, column for column (`catalogue-tables.contract.test.ts`). */
export const SaleRequestRowSchema = z.object({
	id: uuid,
	project_id: uuid,
	stage_id: uuid,
	/** The maker who asked; null once their account is erased. */
	requested_by: uuid.nullable(),
	/** The team that sells the asset when the stage paid a team. */
	seller_team_id: uuid.nullable(),
	ip_mode: SaleRequestIpMode,
	/** The client: a person, or a business (one, or neither once erased). */
	client_user_id: uuid.nullable(),
	client_business_id: uuid.nullable(),
	title: z.string().min(1).max(200),
	note: z.string().max(2000),
	/** The proposed royalty, fixed at the grant; 0 on a shared-ownership request. */
	royalty_bp: z.number().int().min(0).max(SALE_ROYALTY_MAX_BP),
	files: z.array(SaleRequestFileSchema).min(1).max(24),
	/** What the client granted (some or all of `files`); null until approved. */
	granted_file_ids: z.array(uuid).min(1).nullable(),
	scope_note: z.string().max(2000).nullable(),
	status: SaleRequestStatus,
	decided_by: uuid.nullable(),
	decided_at: timestamptz.nullable(),
	decision_note: z.string().max(2000).nullable(),
	created_at: timestamptz,
	updated_at: timestamptz,
});
export type SaleRequestRow = z.infer<typeof SaleRequestRowSchema>;
// #endregion

// #region The overview read
/** A released stage the viewer may ask to sell from (`catalogue.project_sale_requests().stages`). */
export const SaleStageSchema = z.object({
	stageId: uuid,
	stageSlug: z.string().min(1).max(40),
	stageName: z.string().min(1).max(200),
	ipMode: IpOwnershipMode,
	/** Why a request would be refused now; null when it would not. */
	refusal: z.string().max(300).nullable(),
	/** The viewer already has an open request on this stage. */
	openRequest: z.boolean(),
	/** The files the viewer delivered on it; `sha256` null when it cannot be the link. */
	files: z.array(SaleRequestFileSchema).max(200),
});
export type SaleStage = z.infer<typeof SaleStageSchema>;

/** One request as its viewer sees it (`catalogue.project_sale_requests().requests`). */
export const SaleRequestViewSchema = z.object({
	id: uuid,
	stageId: uuid,
	stageSlug: z.string().min(1).max(40),
	stageName: z.string().min(1).max(200),
	title: z.string().min(1).max(200),
	status: SaleRequestStatus,
	ipMode: SaleRequestIpMode,
	royaltyBp: z.number().int().min(0).max(SALE_ROYALTY_MAX_BP),
	note: z.string().max(2000),
	files: z.array(SaleRequestFileSchema).max(24),
	grantedFileIds: z.array(uuid).max(24),
	scopeNote: z.string().max(2000).nullable(),
	decisionNote: z.string().max(2000).nullable(),
	createdAt: timestamptz,
	decidedAt: timestamptz.nullable(),
	/** The viewer's side: the maker (or a member of the selling team) or the client. */
	role: z.enum(["maker", "client"]),
	canDecide: z.boolean(),
	canWithdraw: z.boolean(),
	/** The minted draft's product slug, for its maker; null otherwise. */
	productSlug: z.string().max(40).nullable(),
});
export type SaleRequestView = z.infer<typeof SaleRequestViewSchema>;

/** The project's requests to sell as the viewer may act on them. */
export const ProjectSaleRequestsSchema = z.object({
	/** ⚖️ Whether a grant can be recorded yet (`sale_grants_enabled`, off until counsel). */
	grantsEnabled: z.boolean(),
	royaltyMaxBp: z.number().int().min(0).max(SALE_ROYALTY_MAX_BP),
	stages: z.array(SaleStageSchema).max(100),
	requests: z.array(SaleRequestViewSchema).max(200),
});
export type ProjectSaleRequests = z.infer<typeof ProjectSaleRequestsSchema>;
// #endregion

// #region Inputs
/** `POST /api/catalogue/sale-requests` — ask to sell an asset made on a released stage. */
export const RequestSaleInputSchema = z.object({
	stageId: uuid,
	title: z.string().trim().min(1, "Name what you want to sell.").max(200),
	fileIds: z.array(uuid).min(1, "Choose the files it is made of.").max(24),
	royaltyBp: z.number().int().min(0).max(SALE_ROYALTY_MAX_BP),
	note: z.string().trim().max(2000).default(""),
});
export type RequestSaleInput = z.infer<typeof RequestSaleInputSchema>;

/** `POST /api/catalogue/sale-requests/[requestId]/decide` — the client grants (some files) or declines. */
export const DecideSaleRequestInputSchema = z.object({
	approve: z.boolean(),
	/** The files granted; absent grants every file asked for. Only with `approve`. */
	fileIds: z.array(uuid).min(1).max(24).optional(),
	/** On a grant, the client's own words for its scope; on a decline, why. */
	note: z.string().trim().max(2000).optional(),
}).refine((v) => v.approve || v.fileIds === undefined, {
	message: "A decline names no files.",
	path: ["fileIds"],
});
export type DecideSaleRequestInput = z.infer<typeof DecideSaleRequestInputSchema>;
// #endregion
