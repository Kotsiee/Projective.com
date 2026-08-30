import type { SupabaseClient } from "supabaseClient";
import { getUserClient } from "../../core/supabase.ts";
import type { ReadActor } from "../read-actor.ts";
import type {
	EngagementKind,
	ProjectFormat,
	ProjectStatus,
	ProjectSummary,
	ProjectViewerRole,
	ScopeOption,
} from "@projective/types/projects";
import type { ContextType } from "@projective/types/auth";

/**
 * live-queries — the RLS-scoped Postgres read path for the `/projects` domain.
 *
 * ## What this module is, and what it deliberately is not
 *
 * It is the SQL half of the projects read layer: it narrows `projects.*` to the rows the caller may
 * see and maps them onto the Zod projections. It is NOT the business half — filtering, sorting,
 * grouping and the incoming-request count all stay in `./query.ts`, which the live path calls with
 * the rows this module returns. That split is deliberate: the feed's `priority` sort is a computed
 * weight with no column behind it, so reproducing it in `ORDER BY` would be a second implementation
 * of a rule that is already written down once.
 *
 * ## Every query is under the caller's own JWT
 *
 * {@link getUserClient} binds the actor's access token, so `projects.has_project_access` and the
 * policies in `00002011_policies_projects.sql` decide what comes back. Nothing here uses the
 * service-role client. That is not caution for its own sake — a service-role read of a multi-tenant
 * feed would put the entire tenancy burden on the `.eq()` filters below, where one missing predicate
 * is a cross-tenant disclosure that no policy would catch.
 *
 * ## PostgREST facts this code depends on
 *
 * - **The schema profile is not optional.** `supabase/config.toml` exposes `projects` but the default
 *   profile is `public`, so every call goes through `.schema("projects")`. Without it the request
 *   404s on the table name rather than failing in any way that says why.
 * - **The owner is a SEPARATE query, not an embed.** `org.users_public` lives in another exposed
 *   schema, and PostgREST's cross-schema resource embedding is version-dependent and would additionally
 *   need the FK constraint named to avoid `PGRST201`. A second `.in()` round trip over the page's
 *   owner ids is one extra query with semantics that do not depend on the broker's version — and it
 *   is a fixed cost per page, not per row.
 * - **`marketplace` is NOT exposed**, which is why {@link toSummary} never tries to resolve a
 *   blueprint's title through `source_blueprint_id` and derives {@link EngagementKind} from the
 *   column's mere presence instead.
 *
 * ## `org.users_public` does not have the columns a display name suggests
 *
 * There is no `display_name`, no `handle` and no `avatar_url`. The real columns are `username`,
 * `first_name`, `last_name` and `avatar_file_id` — the last a FK into `files.items`, not a URL. So a
 * party's `handle` is its `username`, its `name` is the composed given/family pair falling back to
 * the username, and its `avatar` is `null`: turning a file id into a served URL is a files-domain
 * concern behind its own gate, and emitting a guessed path would render as a broken image on every
 * row.
 *
 * ## The status contradiction, handled rather than hidden
 *
 * The Postgres `project_status` enum carries six members; the Zod `ProjectStatus` carries five — it
 * has no `archived` (that member was added to the database by Decision #80 and never reached the
 * SSOT). A row in that state therefore cannot be represented, so {@link ARCHIVED_STATUS} rows are
 * EXCLUDED from the feed at the query level rather than coerced into some other status. Excluding is
 * correct on its own terms — archived is this platform's soft delete, and a soft-deleted engagement
 * does not belong in a feed — but it is worth knowing that the alternative was never available.
 */

// #region Constants

/** The soft-delete terminal state. Present in the DB enum, absent from the Zod SSOT — see the docblock. */
const ARCHIVED_STATUS = "archived";

/** The five `project_status` members the Zod SSOT can represent. */
const REPRESENTABLE_STATUS: readonly string[] = [
	"draft",
	"active",
	"on_hold",
	"completed",
	"cancelled",
];

/**
 * The `stage_status` members that mean a stage is DELIVERED, for the feed's progress meter.
 *
 * The enum is `('open','assigned','in_progress','submitted','approved','revisions','paid',
 * 'cancelled')` — there is **no `'completed'`**. Counting against that spelling is not a filter that
 * matches nothing loudly; it makes `completedStages` permanently `0` while `totalStages` stays
 * correct, so a finished five-stage project renders a plausible "0/5" with no error anywhere.
 *
 * `approved` is the client's acceptance and `paid` is the escrow release that follows it. Both mean
 * the work is done; `paid` is included because a stage that has been paid out cannot be anything
 * else, and a project whose stages have all settled must not read as unstarted. `submitted` is
 * deliberately excluded — awaiting review is not delivered — and so is `revisions`.
 */
const DELIVERED_STAGE_STATUS: ReadonlySet<string> = new Set(["approved", "paid"]);

/**
 * A hard ceiling on rows pulled for the feed.
 *
 * The feed projection is UNPAGED — `ProjectFeedParams` has no cursor and no limit, and
 * `ProjectFeedPayload` has no `hasMore` — so without a bound here a tenant with ten thousand
 * engagements would serialise all of them into one response. PostgREST's own `max_rows = 1000`
 * would cap it anyway; stating it explicitly means the number is visible to a reader rather than
 * being a property of a config file three directories away.
 */
const FEED_ROW_CAP = 500;

/** The columns one feed row needs. The owner is resolved separately — see the docblock. */
const SUMMARY_COLUMNS = [
	"id",
	"slug",
	"title",
	"format",
	"status",
	"visibility",
	"currency",
	"owner_user_id",
	"owner_team_id",
	"owner_organisation_id",
	"client_business_id",
	"source_blueprint_id",
	"updated_at",
	"last_activity_at",
].join(", ");

/** The `org.users_public` columns a display party needs. Verified against `00000011_tables_org.sql`. */
const PARTY_COLUMNS = "user_id, username, first_name, last_name";

// #endregion

// #region Row shapes

/**
 * One `org.users_public` row, restricted to the columns that actually exist.
 *
 * Named against the migration rather than against what a display party wants to be called — the
 * mapping from `username`/`first_name`/`last_name` to `handle`/`name` happens in {@link partyOf},
 * where it is visible, instead of being smuggled into a `select` alias.
 */
interface OwnerRow {
	user_id: string;
	username: string;
	first_name: string | null;
	last_name: string | null;
}

/** One `projects.projects` row as selected by {@link SUMMARY_COLUMNS}. */
export interface ProjectRow {
	id: string;
	slug: string;
	title: string;
	format: string;
	status: string;
	visibility: string | null;
	currency: string | null;
	owner_user_id: string;
	owner_team_id: string | null;
	owner_organisation_id: string | null;
	client_business_id: string | null;
	source_blueprint_id: string | null;
	updated_at: string;
	last_activity_at: string | null;
}

/** One `projects.project_participants` row, for the viewer's role and the roster. */
export interface ParticipantRow {
	project_id: string;
	profile_type: string;
	profile_id: string;
	role: string;
}

/** A stage row reduced to what the feed's progress meter needs. */
export interface StageCountRow {
	project_id: string;
	status: string;
}

// #endregion

// #region Mapping

/**
 * Coerce a `project_format` value onto the Zod enum.
 *
 * The two vocabularies agree today (`one_off` | `pipeline` | `session`), so this is a guard against
 * a future enum member reaching a client as an unparseable row rather than a translation. An unknown
 * member degrades to `pipeline`, the platform's default format, because a feed row with a plausible
 * format renders and a row that fails Zod takes the whole page down.
 */
function toFormat(raw: string): ProjectFormat {
	return raw === "one_off" || raw === "session" ? raw : "pipeline";
}

/** Coerce a `project_status` value; anything unrepresentable becomes `active`. See the docblock. */
function toStatus(raw: string): ProjectStatus {
	return (REPRESENTABLE_STATUS.includes(raw) ? raw : "active") as ProjectStatus;
}

/**
 * Map a participant `role` string onto {@link ProjectViewerRole}.
 *
 * `projects.project_participants.role` is FREE TEXT — no enum, no CHECK — so the values are whatever
 * the RPCs happen to write. Anything unrecognised becomes `member`, the least-privileged member of
 * the union: a role we cannot read should never be promoted into an authority tier by accident.
 */
function toViewerRole(raw: string | undefined): ProjectViewerRole {
	switch (raw) {
		case "owner":
		case "admin":
		case "freelancer":
		case "client":
			return raw;
		default:
			return "member";
	}
}

/**
 * Which workspace an engagement belongs to.
 *
 * The columns are checked most-specific first — an organisation-owned project also carries a team,
 * and reading the team would file it under the wrong scope in the feed's grouping.
 */
function scopeOf(row: ProjectRow): { scopeType: ContextType; scopeId: string } {
	if (row.owner_organisation_id) {
		return { scopeType: "organisation", scopeId: row.owner_organisation_id };
	}
	if (row.owner_team_id) return { scopeType: "team", scopeId: row.owner_team_id };
	if (row.client_business_id) return { scopeType: "business", scopeId: row.client_business_id };
	return { scopeType: "personal", scopeId: row.owner_user_id };
}

/**
 * A display party from an `org.users_public` row, or a neutral placeholder.
 *
 * `avatar` is always `null` — `avatar_file_id` is a FK into `files.items`, not a URL, and composing a
 * served path from it belongs to the files domain behind its own gate. A guessed path would render as
 * a broken image on every row, which is worse than the initials fallback the `Avatar` component
 * already draws for a null.
 *
 * The name falls back through composed → username → `"Unknown"` because `ProjectPartySchema.name` is
 * `min(1)`: an empty string is not a value this schema can carry, so the absence has to be spelled.
 * That absence is a real state — RLS can hide an owner's public row from a viewer who can
 * nonetheless see the project.
 */
function partyOf(owner: OwnerRow | null): ProjectSummary["owner"] {
	if (!owner) return { name: "Unknown", avatar: null, handle: null };
	const composed = [owner.first_name, owner.last_name]
		.map((part) => part?.trim() ?? "")
		.filter((part) => part.length > 0)
		.join(" ");
	return {
		name: composed || owner.username.trim() || "Unknown",
		avatar: null,
		handle: owner.username,
	};
}

/** Options for {@link toSummary} — the per-viewer facts no single project row carries. */
export interface SummaryContext {
	/** The viewer's role per project id, from `projects.project_participants`. */
	roles: Map<string, string>;
	/** Human labels per scope id, from the actor's memberships. */
	scopeLabels: Map<string, string>;
	/** `[completed, total]` stage counts per project id. */
	stages: Map<string, [number, number]>;
	/** Owner rows by `user_id`, from the separate `org.users_public` read. */
	owners: Map<string, OwnerRow>;
}

/**
 * Map one database row onto the feed's {@link ProjectSummary} projection.
 *
 * Several fields on that projection have no column anywhere and are genuinely per-viewer derived
 * state — `unread`, `starred`, `activity`. There is no `project_stars` table, no read watermark for
 * a project (only for a DM thread), and no materialised activity signal. They are therefore returned
 * as their NEUTRAL values (`false` / `null`) rather than being synthesised from something adjacent
 * like `last_activity_at`, which would produce a pulsing unread dot on every project the viewer had
 * simply not opened today. A missing signal that renders as "nothing awaiting you" is wrong in the
 * quiet direction; an invented one is wrong in the direction the user acts on.
 */
export function toSummary(row: ProjectRow, ctx: SummaryContext): ProjectSummary {
	const { scopeType, scopeId } = scopeOf(row);
	const [completed, total] = ctx.stages.get(row.id) ?? [0, 0];
	const isSession = row.format === "session";

	return {
		id: row.id,
		slug: row.slug,
		title: row.title,
		// A project instantiated from a service blueprint is provider-architected; anything else was
		// posted by a client. The blueprint FK is the only durable evidence of which, and it survives
		// even though `marketplace` is not exposed to PostgREST, because presence is all that is read.
		kind: (row.source_blueprint_id ? "service" : "project") as EngagementKind,
		format: toFormat(row.format),
		status: toStatus(row.status),
		viewerRole: toViewerRole(ctx.roles.get(row.id)),
		scopeType,
		scopeId,
		scopeLabel: ctx.scopeLabels.get(scopeId) ?? "Personal",
		owner: partyOf(ctx.owners.get(row.owner_user_id) ?? null),
		// The counterparty is the other side of the hire, which needs the participant graph resolved
		// per project. The roster read owns that; the feed row leaves it null rather than guessing
		// from the owner columns, which describe ownership rather than opposition.
		counterparty: null,
		serviceId: row.source_blueprint_id,
		unread: false,
		starred: false,
		completedStages: isSession ? null : completed,
		totalStages: isSession ? null : total,
		activity: null,
		nextSessionLabel: null,
		// No budget column exists on `projects.projects` — the money lives in `finance.escrows` and in
		// per-stage `unit_price_cents`, and summing those is a finance read with its own gate. Null is
		// the schema's "private or unset", which is exactly what this is.
		budgetLabel: null,
		updatedAt: row.last_activity_at ?? row.updated_at,
	};
}

// #endregion

// #region Workspace labels

/**
 * Resolve human names for the workspaces a page of projects belongs to.
 *
 * `ProjectSummary.scopeLabel` is documented as "Human label of the owning workspace (e.g. 'Northwind
 * Studio', 'Personal')", and `buildGroups` renders it as a FEED SECTION HEADER and as the label on
 * every scope filter option. Passing the raw id through means a user with one team sees their feed
 * split into "Personal" and `a3f1c2de-9b40-4e77-8c12-5f0e1b7d9a44`.
 *
 * Three tables because the three workspace kinds are three tables, and the name column differs:
 * `org.teams.name`, `org.business_profiles.name`, and `org.organisations` — which has no `name` at
 * all, only `legal_name`, an optional `trading_name` and a `handle`. Trading name is preferred there
 * because it is what an organisation calls itself in public; the legal name is the fallback.
 *
 * Only the kinds actually present on the page are queried. A lookup that fails leaves that scope
 * unresolved and {@link toSummary} falls back to a generic label for its TYPE — never to the id.
 */
async function fetchScopeLabels(
	actor: ReadActor & { accessToken: string },
	rows: readonly ProjectRow[],
): Promise<Map<string, string>> {
	const labels = new Map<string, string>();
	const teamIds: string[] = [];
	const businessIds: string[] = [];
	const orgIds: string[] = [];

	for (const row of rows) {
		if (row.owner_organisation_id) orgIds.push(row.owner_organisation_id);
		else if (row.owner_team_id) teamIds.push(row.owner_team_id);
		else if (row.client_business_id) businessIds.push(row.client_business_id);
	}

	const db = orgClient(actor);
	// PostgREST builders are thenable rather than real Promises, so the array is typed to what they
	// actually are; `Promise.all` accepts either.
	const reads: PromiseLike<void>[] = [];

	if (teamIds.length > 0) {
		reads.push(
			db.from("teams").select("id, name").in("id", [...new Set(teamIds)]).then(
				({ data, error }) => {
					if (error) return;
					for (const r of (data ?? []) as { id: string; name: string | null }[]) {
						if (r.name?.trim()) labels.set(r.id, r.name.trim().slice(0, 120));
					}
				},
			),
		);
	}
	if (businessIds.length > 0) {
		reads.push(
			db.from("business_profiles").select("id, name").in("id", [...new Set(businessIds)]).then(
				({ data, error }) => {
					if (error) return;
					for (const r of (data ?? []) as { id: string; name: string | null }[]) {
						if (r.name?.trim()) labels.set(r.id, r.name.trim().slice(0, 120));
					}
				},
			),
		);
	}
	if (orgIds.length > 0) {
		reads.push(
			db.from("organisations").select("id, trading_name, legal_name").in(
				"id",
				[...new Set(orgIds)],
			).then(({ data, error }) => {
				if (error) return;
				type OrgRow = { id: string; trading_name: string | null; legal_name: string | null };
				for (const r of (data ?? []) as OrgRow[]) {
					const name = r.trading_name?.trim() || r.legal_name?.trim();
					if (name) labels.set(r.id, name.slice(0, 120));
				}
			}),
		);
	}

	await Promise.all(reads);
	return labels;
}

/**
 * The label for a scope whose name could not be resolved.
 *
 * A generic word for the KIND, never the id. "Team" is a poor label; a uuid is not a label at all,
 * and `scopeLabel` is `min(1)` so the absence cannot simply be passed through as empty.
 */
function fallbackScopeLabel(scopeType: ContextType): string {
	switch (scopeType) {
		case "personal":
			return "Personal";
		case "team":
			return "Team";
		case "business":
			return "Business";
		case "organisation":
			return "Organisation";
		default:
			return "Workspace";
	}
}

// #endregion

// #region Queries

/** An RLS-scoped client on the `projects` schema profile. */
function projectsClient(actor: ReadActor & { accessToken: string }): SupabaseClient {
	return getUserClient(actor.accessToken).schema("projects") as unknown as SupabaseClient;
}

/** An RLS-scoped client on the `org` schema profile, for the party lookup. */
function orgClient(actor: ReadActor & { accessToken: string }): SupabaseClient {
	return getUserClient(actor.accessToken).schema("org") as unknown as SupabaseClient;
}

/**
 * Resolve display parties for a set of user ids.
 *
 * A failed or partial read is NOT an error: `partyOf` degrades any missing id to the "Unknown"
 * placeholder, and a feed that renders with one unnamed owner is strictly better than a feed that
 * 500s because a public profile row was hidden by RLS.
 */
async function fetchParties(
	actor: ReadActor & { accessToken: string },
	userIds: readonly string[],
): Promise<Map<string, OwnerRow>> {
	const parties = new Map<string, OwnerRow>();
	const unique = [...new Set(userIds)].filter((id) => id.length > 0);
	if (unique.length === 0) return parties;

	const { data, error } = await orgClient(actor)
		.from("users_public")
		.select(PARTY_COLUMNS)
		.in("user_id", unique);

	if (error) return parties;
	for (const row of (data ?? []) as OwnerRow[]) parties.set(row.user_id, row);
	return parties;
}

/**
 * Every project the caller is INVOLVED WITH, already mapped to the feed projection.
 *
 * ## Why this is not "everything RLS allows"
 *
 * The two are very different sets, and leaning on RLS alone gets this endpoint badly wrong. The
 * policies on `projects.projects` are OR-ed, and one of them is
 * `"Public can view active published projects" USING (status = 'active' AND visibility = 'public')`
 * — every active public project on the platform. So an unfiltered read returns the whole public
 * marketplace, ordered by `last_activity_at`, and the {@link FEED_ROW_CAP} fills with strangers'
 * projects while the viewer's own quieter ones fall off the end.
 *
 * RLS answers "what may this person see". The feed answers "what is this person working on". Those
 * are different questions, and only the second one belongs here — `/projects` is the workspace, not
 * discovery.
 *
 * So involvement is resolved FIRST (owner, or a participant row), and the project read is scoped to
 * it. RLS still applies underneath and is still the security boundary; this predicate is about
 * meaning, not permission.
 *
 * ## The gap this makes visible
 *
 * `projects.project_participants` is the only evidence of a hire, and `projects.projects` has NO
 * policy granting a participant SELECT on the project they were hired into — only owner-or-public.
 * So a freelancer's private engagement is inside the involvement set and outside RLS, and comes back
 * empty. That is a missing policy in the schema, not something a query can fix; it is recorded in
 * `documentation/architecture/READ_API_FINDINGS.md`.
 */
export async function fetchProjectRows(
	actor: ReadActor & { accessToken: string },
): Promise<ProjectSummary[]> {
	const db = projectsClient(actor);

	// Involvement first: the project ids this viewer holds a participant row for. Resolved before the
	// project read so the read can be scoped to them, rather than after, where it could only filter a
	// page the public-visibility policy had already filled with other people's work.
	const involvedIds = await fetchInvolvedProjectIds(db, actor);

	let query = db
		.from("projects")
		.select(SUMMARY_COLUMNS)
		.neq("status", ARCHIVED_STATUS);

	query = involvedIds.length > 0
		// PostgREST `or` with an `in` list. Owner OR participant — a client always owns their
		// projects, a hired freelancer never does, and both belong in the same feed.
		? query.or(`owner_user_id.eq.${actor.userId},id.in.(${involvedIds.join(",")})`)
		: query.eq("owner_user_id", actor.userId);

	const { data, error } = await query
		.order("last_activity_at", { ascending: false })
		.limit(FEED_ROW_CAP);

	if (error) throw new Error(`projects.projects read failed: ${error.message}`);
	const rows = (data ?? []) as unknown as ProjectRow[];
	if (rows.length === 0) return [];

	const ids = rows.map((r) => r.id);
	// Three independent lookups over the same page. Issued together rather than sequentially: none
	// depends on another's result, and awaiting them in series would add all three latencies to every
	// feed render.
	const [roles, stages, owners, names] = await Promise.all([
		fetchViewerRoles(db, actor, ids),
		fetchStageCounts(db, ids),
		fetchParties(actor, rows.map((r) => r.owner_user_id)),
		fetchScopeLabels(actor, rows),
	]);

	const scopeLabels = new Map<string, string>();
	for (const row of rows) {
		const { scopeType, scopeId } = scopeOf(row);
		if (scopeLabels.has(scopeId)) continue;
		scopeLabels.set(scopeId, names.get(scopeId) ?? fallbackScopeLabel(scopeType));
	}

	return rows.map((row) => toSummary(row, { roles, scopeLabels, stages, owners }));
}

/**
 * The project ids the viewer holds a participant row for.
 *
 * Separate from {@link fetchViewerRoles}, which reads the same table for a DIFFERENT reason: that one
 * annotates a page that already exists, this one decides which page to fetch. Merging them would
 * mean either fetching the projects first (the bug this exists to prevent) or carrying the roles for
 * projects that never reach the feed.
 *
 * A failure here returns an empty list, which narrows the feed to owned projects rather than
 * widening it to the public marketplace. Under-reporting a hire is a visible, reportable emptiness;
 * over-reporting fills someone's workspace with strangers' work.
 */
async function fetchInvolvedProjectIds(
	db: SupabaseClient,
	actor: ReadActor,
): Promise<string[]> {
	if (!actor.userId) return [];
	const { data, error } = await db
		.from("project_participants")
		.select("project_id")
		.eq("profile_id", actor.userId);
	if (error) return [];
	const ids = new Set<string>();
	for (const row of (data ?? []) as { project_id: string }[]) ids.add(row.project_id);
	return [...ids];
}

/**
 * The viewer's role in each of the given projects.
 *
 * Keyed on `profile_id` ALONE, and that is deliberate rather than lazy.
 *
 * `projects.project_participants.profile_type` is the `profile_type` ENUM, whose members are exactly
 * `('freelancer', 'business')` — there is **no `'user'`**. Filtering `profile_type = 'user'` does not
 * return nothing; it raises `22P02 invalid input value for enum profile_type` on every request, and
 * because this lookup swallows its errors by design the whole feed would silently degrade to
 * `viewerRole: "member"` for every row, forever, with no log line to say why.
 *
 * Pinning it to `'freelancer'` instead would be correct for the only write the migrations perform
 * (`00001130_functions_projects_stages.sql:536` enrols an individual as `'freelancer'` with their
 * user id in `profile_id`) and would silently exclude any future participant enrolled under the
 * other member. `profile_id` is the discriminating key either way: a `'business'` row carries a
 * business id, which is never a user id, so the type predicate adds no selectivity and only adds a
 * way to be wrong.
 */
async function fetchViewerRoles(
	db: SupabaseClient,
	actor: ReadActor,
	projectIds: readonly string[],
): Promise<Map<string, string>> {
	const roles = new Map<string, string>();
	if (!actor.userId) return roles;

	const { data, error } = await db
		.from("project_participants")
		.select("project_id, profile_type, profile_id, role")
		.eq("profile_id", actor.userId)
		.in("project_id", projectIds as string[]);

	// A failed role read is not a failed feed: the rows are already resolved and every one of them
	// degrades to `member`, which is the least-privileged reading. Throwing here would turn a
	// secondary lookup into an outage of the primary surface.
	if (error) return roles;
	for (const row of (data ?? []) as ParticipantRow[]) roles.set(row.project_id, row.role);
	return roles;
}

/**
 * `[completed, total]` stage counts per project, for the feed's progress meter.
 *
 * One query over all the projects on the page rather than one per project — the N+1 here would be up
 * to {@link FEED_ROW_CAP} round trips to render a single list.
 */
async function fetchStageCounts(
	db: SupabaseClient,
	projectIds: readonly string[],
): Promise<Map<string, [number, number]>> {
	const counts = new Map<string, [number, number]>();

	const { data, error } = await db
		.from("project_stages")
		.select("project_id, status")
		.in("project_id", projectIds as string[]);

	if (error) return counts;
	for (const row of (data ?? []) as StageCountRow[]) {
		const entry = counts.get(row.project_id) ?? [0, 0];
		entry[1] += 1;
		if (DELIVERED_STAGE_STATUS.has(row.status)) entry[0] += 1;
		counts.set(row.project_id, entry);
	}
	return counts;
}

/**
 * One project by slug, or `null`.
 *
 * `maybeSingle` rather than `single`: a slug that matches nothing is an ordinary 404 on this route,
 * and `single` turns it into a thrown PostgREST error that the service would have to unwrap to tell
 * "no such project" apart from "the database is down".
 */
export async function fetchProjectBySlug(
	actor: ReadActor & { accessToken: string },
	slug: string,
): Promise<ProjectSummary | null> {
	const db = projectsClient(actor);

	const { data, error } = await db
		.from("projects")
		.select(SUMMARY_COLUMNS)
		.eq("slug", slug)
		.maybeSingle();

	if (error) throw new Error(`projects.projects slug read failed: ${error.message}`);
	if (!data) return null;

	const row = data as unknown as ProjectRow;
	const [roles, stages, owners] = await Promise.all([
		fetchViewerRoles(db, actor, [row.id]),
		fetchStageCounts(db, [row.id]),
		fetchParties(actor, [row.owner_user_id]),
	]);
	const { scopeType, scopeId } = scopeOf(row);
	const names = await fetchScopeLabels(actor, [row]);
	const scopeLabels = new Map([[scopeId, names.get(scopeId) ?? fallbackScopeLabel(scopeType)]]);

	return toSummary(row, { roles, scopeLabels, stages, owners });
}

/**
 * The workspaces the actor can scope the feed to, derived from the projects they can actually see.
 *
 * Deliberately derived from the FEED rather than from a memberships read. A workspace the viewer
 * belongs to but has no visible project in is a scope option that filters to nothing — an affordance
 * that is offered and then refuses, which §D.7.7 treats as a defect. Counts are left at zero here
 * and filled by `scopeOptionsFrom`, so the counting rule lives in one place.
 */
export function scopesFromRows(rows: readonly ProjectSummary[]): ScopeOption[] {
	const seen = new Map<string, ScopeOption>();
	for (const row of rows) {
		if (seen.has(row.scopeId)) continue;
		seen.set(row.scopeId, {
			id: row.scopeId,
			type: row.scopeType,
			label: row.scopeLabel,
			handle: null,
			role: row.viewerRole === "owner" || row.viewerRole === "admin" ? row.viewerRole : "member",
			count: 0,
		});
	}
	return [...seen.values()];
}

// #endregion
