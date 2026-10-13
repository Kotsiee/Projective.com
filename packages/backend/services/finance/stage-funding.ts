import type { StageFundingQuote, StageFundingQuoteQuery } from "@projective/types/finance";
import { getUserClient, isFinanceBackendLive } from "../../core/supabase.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { type DbResult, refusalOf } from "./live-payments.ts";

/**
 * stage-funding — what funding one stage takes, read before anything commits (Decision #197).
 *
 * `projects.get_stage_funding_quote` runs under the caller's own token, so the payer rule, the priced
 * set (`projects.fn_stage_funding_need`, the definition `fund_stage` holds by and
 * `begin_card_payment` charges by) and the paying wallet's balance are the database's, never
 * re-derived here. The wallet's Fund a stage and the board's Fund stage both read it.
 */

type Row = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function int(value: unknown): number {
	const n = typeof value === "string" ? Number(value) : value;
	return typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** One `get_stage_funding_quote` answer onto {@link StageFundingQuote}. */
export function stageFundingQuoteOf(row: Row, projectId: string): StageFundingQuote {
	return {
		projectId,
		stageId: String(row.stage_id),
		stageName: String(row.stage_name ?? "Stage").slice(0, 120),
		stageStatus: String(row.stage_status ?? "").slice(0, 20),
		fundable: row.fundable === true,
		ticketCount: Math.max(0, int(row.ticket_count)),
		unpricedCount: Math.max(0, int(row.unpriced_count)),
		amountMinor: Math.max(0, int(row.amount_cents)),
		currency: String(row.currency ?? "USD").toUpperCase(),
		payer: {
			scope: row.payer_scope === "business" ? "business" : "personal",
			id: String(row.payer_id),
		},
		walletBalanceMinor: int(row.wallet_balance_cents),
	};
}

/** Quote one stage by its row ids, as the caller. */
export async function readStageFundingQuote(
	accessToken: string,
	projectId: string,
	stageId: string,
): Promise<DbResult<StageFundingQuote>> {
	const { data, error } = await getUserClient(accessToken).schema("projects").rpc(
		"get_stage_funding_quote",
		{
			p_project_id: projectId,
			p_stage_id: stageId,
		},
	);
	if (error) return { ok: false, refusal: refusalOf(error, "get_stage_funding_quote") };
	return { ok: true, value: stageFundingQuoteOf(data as Row, projectId) };
}

/** A project's `prj-…` slug and a stage's `stg-…` slug (or row id) as row ids, under RLS; `null` when either is not visible. */
export async function resolveStageRefs(
	accessToken: string,
	projectSlug: string,
	stageRef: string,
): Promise<{ projectId: string; stageId: string } | null> {
	const db = getUserClient(accessToken).schema("projects");
	const project = await db.from("projects").select("id").eq("slug", projectSlug).maybeSingle();
	if (project.error) throw new Error(`projects.projects read failed: ${project.error.message}`);
	if (!project.data) return null;
	const projectId = (project.data as { id: string }).id;
	const stage = await db.from("project_stages").select("id")
		.eq("project_id", projectId)
		.eq(UUID.test(stageRef) ? "id" : "slug", stageRef)
		.maybeSingle();
	if (stage.error) throw new Error(`projects.project_stages read failed: ${stage.error.message}`);
	if (!stage.data) return null;
	return { projectId, stageId: (stage.data as { id: string }).id };
}

/** The thin `GET /api/finance/escrow/quote` route's service. */
export class StageFundingBackendService {
	/**
	 * The payer's quote for one stage. 401 signed out, 503 where the finance backend is not live, 404
	 * for a project or stage the caller cannot see, 403 for someone who may not fund it.
	 */
	static async quote(
		query: StageFundingQuoteQuery,
		actor: ReadActor,
	): Promise<ServiceResult<{ quote: StageFundingQuote }>> {
		if (!canReadLive(actor)) return fail(401, { message: "Sign in to fund this stage." });
		if (!isFinanceBackendLive()) {
			return fail(503, { message: "Stage funding isn't connected in this environment." });
		}
		try {
			const refs = await resolveStageRefs(actor.accessToken, query.project, query.stage);
			if (!refs) return fail(404, { message: "That stage wasn't found." });
			const quoted = await readStageFundingQuote(actor.accessToken, refs.projectId, refs.stageId);
			if (!quoted.ok) return fail(quoted.refusal.status, { message: quoted.refusal.message });
			return ok({ quote: quoted.value });
		} catch (error) {
			console.error("[stage-funding:quote]", error instanceof Error ? error.message : error);
			return fail(503, {
				message: "We couldn't read this stage's funding just now. Try again in a moment.",
			});
		}
	}
}
