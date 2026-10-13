import type { SupabaseClient } from "supabaseClient";
import type { IntakeAnswers, PipelineDraft, PipelineDraftStatus } from "@projective/types/services";
import { draftArchivesAt } from "@projective/types/services";
import { getUserClient } from "../../core/supabase.ts";
import type { ReadActor } from "../read-actor.ts";
import { clampOr } from "./live-support.ts";
import { refusalFrom, type WriteOutcome, type WriteRefusal } from "./live-writes.ts";

/**
 * live-instantiate — "Add to Projects" on the live path (Decision #209).
 *
 * Three calls, each ONE guarded SECURITY DEFINER door in `marketplace` (00001175), issued under the
 * buyer's own JWT so `auth.uid()` inside is the person who pressed the button:
 *
 * - {@link instantiateBlueprintRow} → `marketplace.instantiate_service_blueprint` — the project, its
 *   stages, one priced ticket per stage, every room and the request record, in one transaction,
 *   idempotent on the client's key and on the buyer's live draft of the listing;
 * - {@link readServiceDraft} → `marketplace.get_service_draft` — the draft that flips the listing's
 *   primary control to "Open project →";
 * - {@link archiveServiceDraftRow} → `marketplace.archive_service_draft` — "Remove draft", refused
 *   once anything is funded, check and archive in one transaction.
 *
 * Every door answers with the same projection (`marketplace.fn_service_draft_json`), mapped here by
 * {@link toPipelineDraft}. Nothing in this module repeats a check the doors make: the caller checks
 * (publication, pipeline, own listing, currency, adulthood) are the security of this path, and a
 * TypeScript mirror of them could only ever disagree in the direction of letting someone through.
 */

// #region Projection
/** The keys `marketplace.fn_service_draft_json` answers with (plus `created`). Pinned by the test. */
export const DRAFT_JSON_KEYS = [
	"project_id",
	"slug",
	"title",
	"status",
	"source_blueprint_slug",
	"stage_count",
	"ticket_count",
	"funded_stage_count",
	"currency",
	"created_at",
	"last_activity_at",
	"created",
] as const;

/**
 * The listing's three-state view of a project status.
 *
 * `on_hold` is still an engagement the buyer works in; `completed` and `cancelled` are not drafts and
 * can never hold the listing's control on "Open project", so they read as `archived` — the state in
 * which the listing offers "Add to Projects" again. An unknown value takes that same safe side.
 */
function draftStatusOf(status: unknown): PipelineDraftStatus {
	if (status === "draft") return "draft";
	if (status === "active" || status === "on_hold") return "active";
	return "archived";
}

function count(value: unknown): number {
	const n = typeof value === "string" ? Number(value) : value;
	return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

function instant(value: unknown): number {
	const at = typeof value === "string" ? Date.parse(value) : NaN;
	return Number.isFinite(at) ? at : 0;
}

/**
 * Map the doors' jsonb onto the listing page's {@link PipelineDraft}.
 *
 * `projectId` is the SLUG, as it is on the stub path: it is what "Remove draft" sends back, and the
 * uuid does not route (Decision #88). `archivesAt` is derived by the SSOT's own rule, never stored.
 */
export function toPipelineDraft(row: Record<string, unknown>, serviceId: string): PipelineDraft {
	const slug = String(row.slug ?? "");
	const status = draftStatusOf(row.status);
	const fundedStageCount = count(row.funded_stage_count);
	const lastActivityAt = instant(row.last_activity_at);
	return {
		projectId: slug,
		slug,
		title: clampOr(String(row.title ?? ""), 200, "Untitled project"),
		status,
		sourceServiceId: typeof row.source_blueprint_slug === "string" && row.source_blueprint_slug
			? row.source_blueprint_slug
			: serviceId || slug,
		stageCount: count(row.stage_count),
		fundedStageCount,
		createdAt: instant(row.created_at),
		lastActivityAt,
		archivesAt: draftArchivesAt({ status, fundedStageCount, lastActivityAt }),
		boardHref: `/projects/${slug}/board`,
	};
}
// #endregion

// #region Error mapping
/** The PostgREST error fields read here. `code` is the SQLSTATE the door raised. */
interface PgError {
	message: string;
	code?: string | null;
}

/**
 * Map a refused door onto a refusal, by SQLSTATE. The doors' sentences are written for a buyer
 * ("This service is priced in USD.") and are passed through, clamped. Anything unrecognised falls to
 * the domain's shared {@link refusalFrom}, which owns the stale-token and generic cases.
 */
export function instantiateRefusal(error: PgError): WriteRefusal {
	const message = error.message ?? "";
	const say = (fallback: string) => clampOr(message, 200, fallback);
	switch (error.code) {
		case "28000":
			return { status: 401, message: say("Sign in to add this to your projects.") };
		case "42501":
			return {
				status: 403,
				message: message.includes("permission denied")
					? "You cannot do that."
					: say("You cannot do that."),
				errors: { serviceId: "not_permitted" },
			};
		case "PM403":
			// The age gate (`org.fn_assert_adult`, Decision #208): buying unlocks at 18.
			return {
				status: 403,
				message: "Adding a paid service unlocks on your 18th birthday.",
				errors: { serviceId: "age_restricted" },
			};
		case "P0002":
			return {
				status: 404,
				message: say("That is no longer available."),
				errors: { serviceId: "not_found" },
			};
		case "PU422":
			return {
				status: 422,
				message: say("You can't add your own service."),
				errors: { serviceId: "own_listing" },
			};
		case "PC409":
			return {
				status: 409,
				message: say("This service is priced in another currency."),
				errors: { currency: "currency_mismatch" },
			};
		case "23514":
			return {
				status: 409,
				message: say("That draft can no longer be changed here."),
				errors: { projectId: "has_funded_stages" },
			};
		case "22023": {
			const field: Record<string, string> = message.includes("pipeline")
				? { serviceId: "not_a_pipeline" }
				: message.includes("no stages")
				? { serviceId: "no_stages" }
				: message.includes("key")
				? { idempotencyKey: "key_reused" }
				: message.includes("answers")
				? { answers: "invalid" }
				: { serviceId: "invalid" };
			return { status: 422, message: say("That request could not be processed."), errors: field };
		}
		default:
			return refusalFrom(message, "serviceId");
	}
}
// #endregion

// #region Doors
function marketplaceDb(actor: ReadActor & { accessToken: string }): SupabaseClient {
	return getUserClient(actor.accessToken).schema("marketplace") as unknown as SupabaseClient;
}

/** What {@link instantiateBlueprintRow} sends — every value already validated by the route's Zod. */
export interface InstantiateArgs {
	/** The listing's blueprint uuid, from the live listing read. */
	blueprintId: string;
	/** The listing item id (`svc-…`), the draft's `sourceServiceId` fallback. */
	serviceId: string;
	answers: IntakeAnswers;
	/** `null` = the listing's own. */
	currency: string | null;
	idempotencyKey: string;
	title: string | null;
}

/** `marketplace.instantiate_service_blueprint` — the one transaction. */
export async function instantiateBlueprintRow(
	actor: ReadActor & { accessToken: string },
	args: InstantiateArgs,
): Promise<WriteOutcome<{ draft: PipelineDraft; created: boolean }>> {
	const { data, error } = await marketplaceDb(actor).rpc("instantiate_service_blueprint", {
		p_blueprint_id: args.blueprintId,
		p_intake: args.answers,
		p_currency: args.currency,
		p_idempotency_key: args.idempotencyKey,
		p_title: args.title,
	});
	if (error) return { refusal: instantiateRefusal(error) };
	if (!data || typeof data !== "object") return null;
	const row = data as Record<string, unknown>;
	return { data: { draft: toPipelineDraft(row, args.serviceId), created: row.created === true } };
}

/** `marketplace.get_service_draft` — the buyer's live draft of a listing, or `null`. Throws on failure. */
export async function readServiceDraft(
	actor: ReadActor & { accessToken: string },
	blueprintId: string,
	serviceId: string,
): Promise<PipelineDraft | null> {
	const { data, error } = await marketplaceDb(actor).rpc("get_service_draft", {
		p_blueprint_id: blueprintId,
	});
	if (error) throw new Error(`marketplace.get_service_draft failed — ${error.message}`);
	if (!data || typeof data !== "object") return null;
	return toPipelineDraft(data as Record<string, unknown>, serviceId);
}

/** `marketplace.archive_service_draft` — "Remove draft" by the draft's slug. */
export async function archiveServiceDraftRow(
	actor: ReadActor & { accessToken: string },
	slug: string,
	reason: string | null,
): Promise<WriteOutcome<{ draft: PipelineDraft }>> {
	const { data, error } = await marketplaceDb(actor).rpc("archive_service_draft", {
		p_project_slug: slug,
		p_reason: reason,
	});
	if (error) return { refusal: instantiateRefusal(error) };
	if (!data || typeof data !== "object") return null;
	return { data: { draft: toPipelineDraft(data as Record<string, unknown>, "") } };
}
// #endregion
