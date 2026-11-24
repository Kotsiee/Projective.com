import type { SupabaseClient } from "supabaseClient";
import type { BoardCard } from "@projective/types/projects";
import { bumpCacheVersion, cachedGlobal, cacheVersionTag } from "../../core/kv.ts";
import { getUserClient } from "../../core/supabase.ts";

/**
 * freshness.ts — how a write by one party to a shared project reaches the OTHER party's next read
 * (ST6; closes Decision #427 (i)).
 *
 * The project read cache (`projectsReadCache`, `cache.ts`) is keyed by the reader's tenant, so
 * evicting the writer's tenant leaves every other party on its pre-write entry for the whole TTL, and
 * evicting anything leaves every other isolate untouched. Instead each project has a version in KV
 * (Decision #339 ruling N2): every cached read of a project folds {@link projectVersion} into its
 * key, read BEFORE the query, and every path that changes a project bumps it after its write
 * commits ({@link touchProjects}). The new version re-keys every reader at once, in every tenant;
 * another isolate follows within a second (`kv.ts` `VERSION_CHECK_MS`). A read with no write in
 * between keeps its key and stays a hit.
 *
 * The scope is the project's `prj-` slug, because that is what every reader holds before it reads
 * (Decision #88) and slugs never change (`security.fn_slug_guard`). A writer that holds only row ids
 * resolves the slug with {@link touchProjectsOf}.
 *
 * A pure SQL job cannot reach KV, so it cannot bump. Where a cached answer shows that such a job is
 * due on the project, the read goes around the cache until the job has run ({@link claimSweepDue}).
 */

// #region Scopes
/** A project's version scope: `["cache","v","projects",<slug>]` in KV. */
export function projectScope(slug: string): readonly string[] {
	return ["projects", slug];
}

/**
 * One person's projects-feed scope. A project's own version cannot reach a feed that has never
 * listed it, so a write that hands someone a project bumps this too ({@link touchPerson}).
 */
export function personScope(userId: string): readonly string[] {
	return ["projects", "person", userId];
}

/** A project's current version as a cache-key component (`"v0"` before its first bump). */
export function projectVersion(slug: string): Promise<string> {
	return cacheVersionTag(projectScope(slug));
}

/** A person's feed version as a cache-key component. */
export function personVersion(userId: string): Promise<string> {
	return cacheVersionTag(personScope(userId));
}
// #endregion

// #region Bumps
/**
 * Bump each named project's version, after the write that changed it has committed. Empty and
 * repeated slugs are skipped. Never rejects: a lost bump leaves the TTL to clear the entry.
 */
export async function touchProjects(slugs: Iterable<string | null | undefined>): Promise<void> {
	const unique = new Set<string>();
	for (const slug of slugs) if (slug) unique.add(slug);
	await Promise.all([...unique].map((slug) => bumpCacheVersion(projectScope(slug))));
}

/** Bump one person's feed scope: a write gave them a project (a seat, an engagement to own). */
export async function touchPerson(userId: string | null | undefined): Promise<void> {
	if (userId) await bumpCacheVersion(personScope(userId));
}

/** The rows a write touched, by uuid — whatever the writer holds. */
export interface ProjectRowRefs {
	projectIds?: readonly string[];
	stageIds?: readonly string[];
	ticketIds?: readonly string[];
	applicationIds?: readonly string[];
	invitationIds?: readonly string[];
}

/**
 * The table that holds each kind of row, and the column naming the person the row hands the project
 * to (the applicant, the invitee), whose feed is bumped with it.
 */
const PROJECT_OF: Record<
	Exclude<keyof ProjectRowRefs, "projectIds">,
	{ table: string; person?: string }
> = {
	stageIds: { table: "project_stages" },
	ticketIds: { table: "tickets" },
	applicationIds: { table: "project_applications", person: "applicant_user_id" },
	invitationIds: { table: "project_invitations", person: "target_user_id" },
};

/**
 * Bump the projects behind rows a write touched, resolving their slugs through `db`: a `projects`
 * schema client as the writer (an RLS-scoped user client) or as a cron or webhook door (the service
 * role). An application or invitation also bumps its applicant's or invitee's feed. A row the client
 * cannot see, or a lookup that fails, is skipped and left to the TTL; this never rejects, because a
 * cache bump must not fail a write that has already committed.
 */
export async function touchProjectsOf(db: SupabaseClient, refs: ProjectRowRefs): Promise<void> {
	try {
		const projectIds = new Set(refs.projectIds ?? []);
		const people = new Set<string>();
		await Promise.all(
			(Object.keys(PROJECT_OF) as (keyof typeof PROJECT_OF)[]).map(async (kind) => {
				const ids = refs[kind] ?? [];
				if (ids.length === 0) return;
				const { table, person } = PROJECT_OF[kind];
				const { data } = await db.from(table).select(
					person ? `project_id, ${person}` : "project_id",
				)
					.in("id", [...ids]);
				for (const row of (data ?? []) as unknown as Record<string, string | null>[]) {
					if (row.project_id) projectIds.add(row.project_id);
					if (person && row[person]) people.add(row[person]!);
				}
			}),
		);
		await Promise.all([...people].map(touchPerson));
		if (projectIds.size === 0) return;
		const { data } = await db.from("projects").select("slug").in("id", [...projectIds]);
		await touchProjects(((data ?? []) as { slug: string }[]).map((row) => row.slug));
	} catch {
		// The TTL clears what a failed lookup could not bump.
	}
}
// #endregion

// #region Read-around
/** `claim_ttl_minutes`'s default, as `projects.fn_release_expired_claims` falls back to it. */
const CLAIM_TTL_DEFAULT_MINUTES = 1440;

/**
 * Whether the claim sweep (`projects.fn_release_expired_claims`, a pure SQL job every 15 minutes) is
 * due on any card: still only `claimed`, claimed longer than `ttlMinutes` ago. The mirror of the
 * sweep's own WHERE, so a board that holds one is read from the database, not the cache, until the
 * sweep has released it.
 */
export function claimSweepDue(
	cards: readonly Pick<BoardCard, "status" | "claimedAt">[],
	ttlMinutes: number,
	nowMs: number,
): boolean {
	const cutoff = nowMs - Math.max(ttlMinutes, 1) * 60_000;
	return cards.some((card) =>
		card.status === "claimed" && card.claimedAt !== null && Date.parse(card.claimedAt) < cutoff
	);
}

/** `security.platform_params.claim_ttl_minutes`: global reference data, read once per 15 minutes. */
function claimTtlMinutes(accessToken: string): Promise<number> {
	return cachedGlobal(["params", "claim_ttl_minutes"], 15 * 60_000, async () => {
		const { data } = await getUserClient(accessToken).schema("security").from("platform_params")
			.select("value").eq("key", "claim_ttl_minutes").maybeSingle();
		const minutes = Number((data as { value?: unknown } | null)?.value);
		return Number.isFinite(minutes) && minutes >= 1 ? minutes : CLAIM_TTL_DEFAULT_MINUTES;
	});
}

/** {@link claimSweepDue} for a board read, reading the TTL only when a card is still only claimed. */
export async function boardSweepDue(
	cards: readonly Pick<BoardCard, "status" | "claimedAt">[],
	accessToken: string,
): Promise<boolean> {
	if (!cards.some((card) => card.status === "claimed" && card.claimedAt !== null)) return false;
	return claimSweepDue(cards, await claimTtlMinutes(accessToken), Date.now());
}
// #endregion
