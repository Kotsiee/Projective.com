import { z } from "zod";
import { ContextType } from "../auth/mod.ts";

/**
 * projects.summary — the Zod SSOT for the COMPACT project/service projection the `/projects`
 * middle-nav feed renders (one row per engagement the actor is involved with).
 *
 * This is a read projection, not a table row: it flattens the parts of `projects.projects` (+ the
 * viewer's `projects.project_participants` / `org.*_members` role and the owning tenant) that the
 * high-density list needs, so the feed never over-fetches the full project graph. The enums mirror
 * the Postgres enum types in `supabase/migrations/0000_init_enums.sql` and `0007_projects_tables.sql`
 * column-for-column; the richer full-row schemas land alongside their own reads later (root
 * CLAUDE.md §1). Only enum/array/min/max/number primitives are used so the schema stays stable
 * across Zod majors (matching `org/organisations.ts`).
 */

// #region Primitives
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An opaque UUID id. */
const uuid = z.string().regex(UUID_RE, "Expected a UUID.");
/** An ISO timestamp string as returned by PostgREST. */
const timestamp = z.string();
// #endregion

// #region Enums (mirror the Postgres enum types)
/** `projects.project_format` — how work flows through the engagement. */
export const ProjectFormat = z.enum(["one_off", "pipeline", "session"]);
export type ProjectFormat = z.infer<typeof ProjectFormat>;

/** `project_status` — engagement lifecycle (nothing is hard-deleted; `cancelled`/`completed` rest). */
export const ProjectStatus = z.enum(["draft", "active", "on_hold", "completed", "cancelled"]);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

/**
 * The multi-tenant role the acting user holds in a given engagement — the union the feed collapses
 * `projects.project_participants.role` + `org.{team,business,organisation}_members.role` into for
 * the role filter. `owner`/`admin` are authority tiers; `freelancer`/`client` are the two sides of a
 * hire; `member` is any other tenant seat.
 */
export const ProjectViewerRole = z.enum(["owner", "admin", "freelancer", "client", "member"]);
export type ProjectViewerRole = z.infer<typeof ProjectViewerRole>;

/**
 * Whether the engagement was architected client-side (a **project** — client posts, stages
 * negotiated) or provider-side (a **service** — freelancer/team is Lead Architect, purchase
 * instantiates the board). Same feed, one discriminator (PRODUCT_SPEC §Projects & Services).
 */
export const EngagementKind = z.enum(["project", "service"]);
export type EngagementKind = z.infer<typeof EngagementKind>;

/**
 * The single most salient actionable state the viewer has on an engagement — drives the card footer's
 * icon-only Status Icon (label on hover via Tooltip) and the involvement quick-filters / incoming
 * request toggles. A derived, per-viewer projection (not a lifecycle column); `null`/absent = nothing
 * awaiting the viewer.
 *
 * - `new_ticket` — a new ticket is open on the viewer's current stage.
 * - `revision_requested` — the client asked for a revision on a submission.
 * - `pending_review` — a submission was sent and is awaiting the client's review (hourglass).
 * - `client_invite` — a client has invited/hired the viewer into a project (incoming hire request).
 * - `service_request` — a paid service purchase is awaiting the provider's acceptance/vetting.
 */
export const ProjectActivity = z.enum([
	"new_ticket",
	"revision_requested",
	"pending_review",
	"client_invite",
	"service_request",
]);
export type ProjectActivity = z.infer<typeof ProjectActivity>;
// #endregion

// #region Party
/** A person/entity attached to a row (owner or counterparty) — name + avatar + optional @handle. */
export const ProjectPartySchema = z.object({
	name: z.string().min(1).max(120),
	/** Avatar URL (Unsplash face crops in fixtures, per DESIGN_SYSTEM.md §C.4). */
	avatar: z.string().max(400).nullable(),
	handle: z.string().max(40).nullable(),
});
export type ProjectParty = z.infer<typeof ProjectPartySchema>;
// #endregion

// #region Row projection
/** One compact engagement row in the `/projects` feed. */
export const ProjectSummarySchema = z.object({
	id: uuid,
	/** Route slug — the row links to `/projects/{slug}`. */
	slug: z.string().min(1).max(120),
	title: z.string().min(1).max(160),
	kind: EngagementKind,
	format: ProjectFormat,
	status: ProjectStatus,
	/** The acting user's role in THIS engagement (drives the role filter + a small role chip). */
	viewerRole: ProjectViewerRole,
	/** Which structural workspace the engagement belongs to — the partition axis for context scoping. */
	scopeType: ContextType,
	/** The owning tenant/context id (team/business/org id, or the user id for a personal engagement). */
	scopeId: z.string().max(64),
	/** Human label of the owning workspace (e.g. "Northwind Studio", "Personal"). */
	scopeLabel: z.string().min(1).max(120),
	/** The engagement owner. */
	owner: ProjectPartySchema,
	/** The other side of the engagement (the client to a freelancer; the provider to a client). */
	counterparty: ProjectPartySchema.nullable(),
	/**
	 * When the engagement was instantiated from one of the actor's provider services, that service's
	 * id (→ the "Clients by Service Provider" filter); null for client-architected projects.
	 */
	serviceId: uuid.nullable(),
	/** Unseen activity — drives a pulsing dot, never a count (DESIGN_SYSTEM.md Part D). */
	unread: z.boolean(),
	/** Whether the actor starred this engagement (the `Starred` quick-filter + a star affordance). */
	starred: z.boolean(),
	/** Completed vs total stages, for the compact progress meter; null for session/one-off. */
	completedStages: z.number().int().min(0).nullable(),
	totalStages: z.number().int().min(0).nullable(),
	/**
	 * The viewer's current actionable state on this engagement — the single icon-only Status Icon in
	 * the card footer (label on hover) and the axis the involvement quick-filters + incoming-request
	 * toggles select on. Derived per-viewer projection (no table column); `null`/absent = nothing
	 * awaiting the viewer. See {@link ProjectActivity}.
	 */
	activity: ProjectActivity.nullable().optional(),
	/**
	 * A pre-formatted "next session" label (e.g. "Thu, Jul 17 · 2:30 PM") for `session`-format
	 * engagements — the card's Row-2 metadata line. Pre-formatted (like {@link budgetLabel}) so SSR and
	 * the client render identically with no locale/timezone hydration drift. `null`/absent = unscheduled.
	 */
	nextSessionLabel: z.string().max(60).nullable().optional(),
	/** Pre-formatted budget label (e.g. "$4,200") or null when private/unset. */
	budgetLabel: z.string().max(40).nullable(),
	/** Last activity time — the default `recent` sort key. */
	updatedAt: timestamp,
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
// #endregion
