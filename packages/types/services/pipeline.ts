import { z } from "zod";

/**
 * services.pipeline — instantiating a **Pipeline** service into the client's workspace.
 *
 * This is the one booking format that creates something before any money moves. Pressing "Add to
 * Projects" copies the seller's service template into the buyer's own workspace as a DRAFT project:
 * a real `projects.projects` row with `status = 'draft'` and `visibility = 'unlisted'`, its stages
 * copied from the blueprint, and freelancer assignments parked at `pending_funding` until the client
 * funds the first ticket.
 *
 * # Why a draft rather than a basket line
 *
 * A pipeline is not a thing you buy; it is a thing you staff and then buy tickets against. The buyer
 * has to be able to open the board, read the stages, write tickets and decide what to fund — none of
 * which a basket line can hold. So the instantiation is the commitment-free step, and the purchase is
 * the per-ticket escrow that follows (`PRODUCT_SPEC.md` §Creation & Purchasing Gate).
 *
 * # Why the CTA never becomes destructive
 *
 * Once a draft exists the control becomes **"Open Project →"**, never "Remove Project". A conversion
 * CTA that turns into a destructive one puts a delete under the cursor that was, one render ago,
 * hovering the primary action — and the buyer's next click is aimed at where the button was, not at
 * what it now says. Removal lives in the secondary controls, behind an explicit confirmation
 * (root CLAUDE.md §3, the Button policy).
 *
 * # The 30-day sweep
 *
 * A draft nobody funds is clutter, not history, so it is archived after 30 days of inactivity — with
 * `status = 'archived'`, never a `DELETE` (§7). The sweep is server-side
 * (`projects.fn_archive_stale_service_drafts`, registered with `pg_cron`); this module holds the
 * constant both sides read, so the interface's "expires in 12 days" and the job's cut-off cannot
 * drift apart.
 */

// #region Constants
/**
 * Days of inactivity before an un-funded service draft is auto-archived.
 *
 * Exported rather than inlined because THREE places need it and they must agree: the SQL sweep, the
 * fat service's projection of `expiresAt`, and the sentence the drawer shows the buyer. Two of the
 * three being right is indistinguishable from all three being right until the day it is not.
 */
export const DRAFT_IDLE_DAYS = 30;

/** {@link DRAFT_IDLE_DAYS} in milliseconds, for the projection arithmetic. */
export const DRAFT_IDLE_MS = DRAFT_IDLE_DAYS * 24 * 60 * 60 * 1000;
// #endregion

// #region Draft state
/**
 * The lifecycle of an instantiated pipeline draft, as the CTA reads it.
 *
 * A strict subset of `project_status`, not a parallel vocabulary: these are the only three states a
 * listing page can put a project into or observe from one, and naming them here keeps the CTA from
 * having to branch over the five it can never see.
 */
export const PipelineDraftStatus = z.enum(["draft", "active", "archived"]);
export type PipelineDraftStatus = z.infer<typeof PipelineDraftStatus>;

/**
 * An instantiated draft, as the listing page needs it.
 *
 * Deliberately thin. The board owns the project; this is only enough to render "Open Project →",
 * explain when it expires, and offer to archive it.
 */
export const PipelineDraftSchema = z.object({
	projectId: z.string().min(1).max(120),
	/** The URL slug — what `/projects/[projectId]/board` is addressed by. */
	slug: z.string().min(1).max(120),
	title: z.string().min(1).max(200),
	status: PipelineDraftStatus,
	/** The service blueprint this was instantiated from, so a repeat press is idempotent. */
	sourceServiceId: z.string().min(1).max(160),
	/** How many stages were copied across. */
	stageCount: z.number().int().min(0),
	/** How many stages have been funded. `0` on a fresh draft — the sweep's whole predicate. */
	fundedStageCount: z.number().int().min(0),
	createdAt: z.number().int(),
	/** Last meaningful activity, epoch ms — what the sweep measures idleness from. */
	lastActivityAt: z.number().int(),
	/**
	 * When the sweep will archive it, epoch ms, or `null` once anything has been funded.
	 *
	 * `null` rather than a far-future date: funding does not postpone the deadline, it removes it, and
	 * a date that says "expires in 3 years" invites the reader to believe there is still a clock.
	 */
	archivesAt: z.number().int().nullable(),
	/** Deep link to the board. Server-built so the route shape has one home. */
	boardHref: z.string().min(1).max(400),
});
export type PipelineDraft = z.infer<typeof PipelineDraftSchema>;
// #endregion

// #region Write payloads
/**
 * Instantiate a service template into the acting client's workspace.
 *
 * `idempotencyKey` is not optional and is not decorative. Instantiation creates a project, and a
 * double-press — or a retry after a timeout the client never saw resolve — would otherwise leave two
 * identical draft pipelines in someone's workspace with no way to tell which one is real. The server
 * returns the SAME draft for a repeated key rather than refusing, so a retry is safe by construction.
 */
export const InstantiateServiceInputSchema = z.object({
	/** The service listing to instantiate. */
	serviceId: z.string().min(1).max(160),
	/**
	 * The workspace to instantiate INTO — a team or business id when acting as an entity, `null` for
	 * the buyer's personal workspace. Never trusted for authorisation: the server resolves membership
	 * itself, and RLS is the real gate.
	 */
	workspaceId: z.string().max(120).nullable().default(null),
	/** Optional override for the project's title. Defaults to the service's own. */
	title: z.string().max(200).optional(),
	idempotencyKey: z.string().min(8).max(120),
});
export type InstantiateServiceInput = z.infer<typeof InstantiateServiceInputSchema>;

/**
 * Archive a draft.
 *
 * There is no `delete`, and there is no `permanent` flag that could grow into one. Nothing on this
 * platform is hard-deleted (root CLAUDE.md §5/§7), so the only shape this operation has is the one
 * that sets a status.
 */
export const ArchiveDraftInputSchema = z.object({
	projectId: z.string().min(1).max(120),
	/** Free-text, recorded on the audit trail. Optional — most archivals have no story. */
	reason: z.string().max(400).optional(),
});
export type ArchiveDraftInput = z.infer<typeof ArchiveDraftInputSchema>;
// #endregion

// #region Pure helpers
/**
 * When a draft will be archived, or `null` when it will not be.
 *
 * Pure and clock-free — it takes the activity instant rather than reading one — so the server's
 * projection and any client re-derivation produce the same answer, and a unit test can pin it.
 */
export function draftArchivesAt(draft: {
	lastActivityAt: number;
	fundedStageCount: number;
	status: PipelineDraftStatus;
}): number | null {
	if (draft.status !== "draft") return null;
	if (draft.fundedStageCount > 0) return null;
	return draft.lastActivityAt + DRAFT_IDLE_MS;
}

/**
 * Whether a draft is due to be swept, evaluated at `now`.
 *
 * Takes `now` as an argument for the same reason: a function that reads the clock cannot be tested
 * against a fixed corpus, and this one decides whether something disappears from a workspace.
 */
export function draftIsStale(
	draft: { lastActivityAt: number; fundedStageCount: number; status: PipelineDraftStatus },
	now: number,
): boolean {
	const at = draftArchivesAt(draft);
	return at !== null && at <= now;
}
// #endregion
