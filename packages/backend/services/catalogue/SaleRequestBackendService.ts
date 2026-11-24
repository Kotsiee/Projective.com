import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getUserClient, isCatalogueBackendLive } from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import {
	type DecideSaleRequestInput,
	type ProjectSaleRequests,
	ProjectSaleRequestsSchema,
	type RequestSaleInput,
	type SaleRequestStatus,
} from "@projective/types/catalogue";

/**
 * SaleRequestBackendService — requests to sell (MARKETPLACE SC7, Decision #493): a maker asks to sell
 * an asset made on a released stage, the client grants or declines it, and a grant mints a draft
 * product the maker publishes through the normal gate. The royalty every sale then pays the client is
 * `finance.place_wallet_order`'s.
 *
 * It decides nothing. Who may ask, which IP modes need a grant, the royalty ceiling, the grant switch
 * (`sale_grants_enabled`, ⚖️ off until counsel) and the files a draft may deliver are the definers in
 * `00001170` §Requests to sell, called as the signed-in caller. Live only: a request names a real
 * stage, its delivered files and their hashes, so with the catalogue offline the read is empty and a
 * write answers 503 rather than inventing one.
 */

// #region Refusals
const UNREACHABLE = "We couldn't reach requests to sell just now. Try again in a moment.";
const SIGNED_OUT = "Sign in to continue.";

/** A definer's refusal (SQLSTATE + message) onto a ServiceResult; the message is the database's. */
function refusal<T>(error: { code?: string; message?: string }): ServiceResult<T> {
	const message = error.message ?? UNREACHABLE;
	switch (error.code) {
		case "42501":
			return fail(403, { message });
		case "P0002":
			return fail(404, { message });
		case "22023":
			return fail(422, { message });
		case "PG409":
		case "55000":
			return fail(409, { message });
		default:
			return fail(503, { message: UNREACHABLE });
	}
}

/** Run a call as the caller; an unexpected failure is a 503, never a throw into the route. */
async function live<T>(
	label: string,
	actor: ReadActor,
	run: (db: ReturnType<typeof getUserClient>) => Promise<ServiceResult<T>>,
): Promise<ServiceResult<T>> {
	if (!isCatalogueBackendLive()) {
		return fail(503, { message: "Requests to sell need the live database." });
	}
	if (!canReadLive(actor)) return fail(401, { message: SIGNED_OUT });
	try {
		return await run(getUserClient(actor.accessToken));
	} catch (error) {
		console.error(`[sale-requests:${label}]`, error instanceof Error ? error.message : error);
		return fail(503, { message: UNREACHABLE });
	}
}
// #endregion

// #region Mapping
interface RawFile {
	file_id: string;
	name: string;
	bytes: number | null;
	sha256: string | null;
}

interface RawRead {
	grants_enabled: boolean;
	royalty_max_bp: number;
	stages: {
		stage_id: string;
		stage_slug: string;
		stage_name: string;
		ip_mode: string;
		refusal: string | null;
		open_request: boolean;
		files: RawFile[] | null;
	}[] | null;
	requests: {
		id: string;
		stage_id: string;
		stage_slug: string;
		stage_name: string;
		title: string;
		status: string;
		ip_mode: string;
		royalty_bp: number;
		note: string;
		files: RawFile[] | null;
		granted_file_ids: string[] | null;
		scope_note: string | null;
		decision_note: string | null;
		created_at: string;
		decided_at: string | null;
		role: string;
		can_decide: boolean;
		can_withdraw: boolean;
		product_slug: string | null;
	}[] | null;
}

/** `catalogue.project_sale_requests`, mapped and validated; `null` when it does not parse. */
export function toProjectSaleRequests(raw: RawRead | null): ProjectSaleRequests | null {
	if (!raw) return null;
	const parsed = ProjectSaleRequestsSchema.safeParse({
		grantsEnabled: raw.grants_enabled === true,
		royaltyMaxBp: raw.royalty_max_bp,
		stages: (raw.stages ?? []).map((s) => ({
			stageId: s.stage_id,
			stageSlug: s.stage_slug,
			stageName: s.stage_name,
			ipMode: s.ip_mode,
			refusal: s.refusal,
			openRequest: s.open_request === true,
			files: s.files ?? [],
		})),
		requests: (raw.requests ?? []).map((r) => ({
			id: r.id,
			stageId: r.stage_id,
			stageSlug: r.stage_slug,
			stageName: r.stage_name,
			title: r.title,
			status: r.status,
			ipMode: r.ip_mode,
			royaltyBp: r.royalty_bp,
			note: r.note,
			files: r.files ?? [],
			grantedFileIds: r.granted_file_ids ?? [],
			scopeNote: r.scope_note,
			decisionNote: r.decision_note,
			createdAt: r.created_at,
			decidedAt: r.decided_at,
			role: r.role,
			canDecide: r.can_decide === true,
			canWithdraw: r.can_withdraw === true,
			productSlug: r.product_slug,
		})),
	});
	if (!parsed.success) {
		console.error("[sale-requests:read] unexpected shape", parsed.error.issues.slice(0, 3));
		return null;
	}
	return parsed.data;
}

/** A door's answer: where the request stands, and its draft once one is minted. */
export interface SaleRequestOutcome {
	requestId: string;
	status: SaleRequestStatus;
	/** The draft product's slug (its console and public address), once minted. */
	productSlug: string | null;
}

function outcomeOf(
	raw: { request_id: string; status: SaleRequestStatus; slug?: string | null },
): SaleRequestOutcome {
	return { requestId: raw.request_id, status: raw.status, productSlug: raw.slug ?? null };
}
// #endregion

export class SaleRequestBackendService {
	/**
	 * A project's requests to sell as the caller may act on them: the released stages they may ask to
	 * sell from, and the requests they made or decide. An empty read when the catalogue is offline or
	 * the caller is signed out, so the overview simply shows nothing.
	 */
	static forProject(
		projectSlug: string,
		actor: ReadActor,
	): Promise<ServiceResult<ProjectSaleRequests>> {
		const empty: ProjectSaleRequests = {
			grantsEnabled: false,
			royaltyMaxBp: 0,
			stages: [],
			requests: [],
		};
		if (!isCatalogueBackendLive() || !canReadLive(actor)) return Promise.resolve(ok(empty));
		return live("read", actor, async (db) => {
			const { data: project, error: readError } = await db.schema("projects").from("projects")
				.select("id").eq("slug", projectSlug).maybeSingle();
			if (readError) throw new Error(readError.message);
			if (!project) return ok(empty);
			const { data, error } = await db.schema("catalogue").rpc("project_sale_requests", {
				p_project: (project as { id: string }).id,
			});
			if (error) return refusal(error);
			return ok(toProjectSaleRequests(data as RawRead | null) ?? empty);
		});
	}

	/** Ask to sell an asset made on a stage; on a shared-ownership stage its draft is minted at once. */
	static request(
		input: RequestSaleInput,
		actor: ReadActor,
	): Promise<ServiceResult<SaleRequestOutcome>> {
		return live("request", actor, async (db) => {
			const { data, error } = await db.schema("catalogue").rpc("request_sale", {
				p_stage: input.stageId,
				p_title: input.title,
				p_file_ids: input.fileIds,
				p_royalty_bp: input.royaltyBp,
				p_note: input.note,
			});
			if (error) return refusal(error);
			const out = outcomeOf(data);
			return ok(out, {
				message: out.status === "approved"
					? "Its draft is ready: set a price and publish it."
					: "Request sent. The client will approve or decline it.",
			});
		});
	}

	/** The client grants (some of) the files asked for, or declines; ⚖️ a grant waits for counsel (409). */
	static decide(
		requestId: string,
		input: DecideSaleRequestInput,
		actor: ReadActor,
	): Promise<ServiceResult<SaleRequestOutcome>> {
		return live("decide", actor, async (db) => {
			const { data, error } = await db.schema("catalogue").rpc("decide_sale_request", {
				p_request: requestId,
				p_approve: input.approve,
				p_file_ids: input.fileIds ?? null,
				p_note: input.note ?? null,
			});
			if (error) return refusal(error);
			return ok(outcomeOf(data), {
				message: input.approve
					? "Granted. Your freelancer has been told."
					: "Declined. Your freelancer has been told.",
			});
		});
	}

	/** The maker withdraws an open request. */
	static withdraw(requestId: string, actor: ReadActor): Promise<ServiceResult<SaleRequestOutcome>> {
		return live("withdraw", actor, async (db) => {
			const { data, error } = await db.schema("catalogue").rpc("withdraw_sale_request", {
				p_request: requestId,
			});
			if (error) return refusal(error);
			return ok(outcomeOf(data), { message: "Request withdrawn." });
		});
	}
}
