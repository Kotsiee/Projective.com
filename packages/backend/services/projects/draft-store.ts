import type { InstantiateServiceInput, PipelineDraft } from "@projective/types/services";
import { draftArchivesAt, draftIsStale } from "@projective/types/services";
import { NOW } from "../scheduling/derive.ts";

/**
 * pipeline draft store — the in-module session store behind "Add to Projects".
 *
 * Instantiating a service is the platform's first WRITE from a public listing page, so unlike the
 * read fixtures beside it this needs somewhere to remember what it did. It is a per-process `Map`,
 * exactly like the catalogue and wallet stores that preceded it: create → the CTA flips to "Open
 * Project →" → archive → it flips back, all exercisable with `PROJECTS_BACKEND_LIVE` off and none of
 * it persisted. A restart is a clean slate, which is the intended scope.
 *
 * The live path replaces THIS FILE and nothing else: `instantiate` becomes an insert into
 * `projects.projects` (`status = 'draft'`, `visibility = 'unlisted'`, `source_blueprint_id` set) plus
 * a copy of the blueprint's stages, and `archive` becomes a status update. The shapes the service
 * returns are unchanged either side of that, which is the whole point of keeping the store separate
 * from the service.
 *
 * ## Idempotency
 *
 * Instantiation creates a project. A double-press — or a retry after a timeout the client never saw
 * resolve — would otherwise leave two identical drafts in someone's workspace with no way to tell
 * which is real. So the store keys on the idempotency key AND on `(buyer, service)`: a repeat returns
 * the SAME draft rather than refusing, which makes a retry safe by construction rather than by the
 * client remembering not to.
 */

// #region Store
/** Everything the store keeps about one draft. */
interface DraftRow extends PipelineDraft {
	/** Who instantiated it. Scopes every read so one buyer never sees another's draft. */
	ownerKey: string;
	/** The key that created it, so a retry resolves to this row rather than a second one. */
	idempotencyKey: string;
}

const drafts = new Map<string, DraftRow>();

/** The per-viewer scope key. `null` (an unresolved account) collapses to a shared anonymous bucket. */
function ownerKeyOf(userId: string | null, workspaceId: string | null): string {
	return `${userId ?? "anon"}::${workspaceId ?? "personal"}`;
}

/**
 * A slug from a title.
 *
 * NOT the same shape `ProjectBackendService.create` produces any more: that one appends a short
 * disambiguating suffix, because `projects_slug_key` is a global UNIQUE and two buyers naming a
 * project "Website refresh" is the likely case rather than the unlikely one. A service instantiation
 * does not need the suffix — a draft is resolved by (owner, blueprint) and its slug is only ever
 * read back within this store — so it is deliberately left readable here rather than made to match.
 */
function slugify(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80) || "untitled-project";
}
// #endregion

// #region Reads
/**
 * The draft this buyer already has for this service, or `null`.
 *
 * Archived drafts are deliberately NOT returned. An archived draft is history, and surfacing one
 * would leave the listing's primary control saying "Open Project →" against a project the buyer
 * cannot work in — a control that renders and does nothing useful, which is the §D.7.7 defect class.
 * Instantiating again after an archive is a new draft, and that is the honest model.
 */
export function findDraft(
	serviceId: string,
	userId: string | null,
	workspaceId: string | null = null,
): PipelineDraft | null {
	const owner = ownerKeyOf(userId, workspaceId);
	for (const row of drafts.values()) {
		if (row.ownerKey !== owner) continue;
		if (row.sourceServiceId !== serviceId) continue;
		if (row.status === "archived") continue;
		return toDraft(row);
	}
	return null;
}

/** Every live draft this buyer holds, newest first. */
export function listDrafts(
	userId: string | null,
	workspaceId: string | null = null,
): PipelineDraft[] {
	const owner = ownerKeyOf(userId, workspaceId);
	return [...drafts.values()]
		.filter((r) => r.ownerKey === owner && r.status !== "archived")
		.sort((a, b) => b.createdAt - a.createdAt)
		.map(toDraft);
}

/** Look a draft up by its project id, scoped to its owner. */
export function getDraft(
	projectId: string,
	userId: string | null,
	workspaceId: string | null = null,
): PipelineDraft | null {
	const row = drafts.get(projectId);
	if (!row) return null;
	if (row.ownerKey !== ownerKeyOf(userId, workspaceId)) return null;
	return toDraft(row);
}
// #endregion

// #region Writes
/** What the service supplies about the source listing. */
export interface DraftSeed {
	serviceId: string;
	title: string;
	stageCount: number;
	userId: string | null;
	workspaceId: string | null;
	/** The instant the draft is created at. Injected so the fixture clock and a live clock agree. */
	now?: number;
}

/**
 * Instantiate a draft, or return the existing one.
 *
 * The idempotency key is checked FIRST and the `(buyer, service)` pair second. That order matters: a
 * buyer who deliberately instantiated the same service twice (two clients, two engagements) sends a
 * fresh key, and resolving by pair first would silently hand them back the first draft and quietly
 * refuse the second engagement they were trying to set up.
 */
export function instantiateDraft(
	input: InstantiateServiceInput,
	seed: DraftSeed,
): { draft: PipelineDraft; created: boolean } {
	const owner = ownerKeyOf(seed.userId, seed.workspaceId);

	for (const row of drafts.values()) {
		if (row.ownerKey === owner && row.idempotencyKey === input.idempotencyKey) {
			return { draft: toDraft(row), created: false };
		}
	}

	const existing = findDraft(seed.serviceId, seed.userId, seed.workspaceId);
	if (existing) return { draft: existing, created: false };

	const now = seed.now ?? NOW;
	const title = input.title?.trim() || seed.title;
	const slug = `${slugify(title)}-${(drafts.size + 1).toString(36)}`;
	const row: DraftRow = {
		ownerKey: owner,
		idempotencyKey: input.idempotencyKey,
		projectId: slug,
		slug,
		title,
		status: "draft",
		sourceServiceId: seed.serviceId,
		stageCount: seed.stageCount,
		// A fresh instantiation has funded nothing. That zero is the sweep's entire predicate, and it is
		// also what keeps the assignments at `pending_funding` — the two facts are one fact.
		fundedStageCount: 0,
		createdAt: now,
		lastActivityAt: now,
		archivesAt: null,
		boardHref: `/projects/${slug}/board`,
	};
	drafts.set(row.projectId, row);
	return { draft: toDraft(row), created: true };
}

/**
 * Soft-archive a draft.
 *
 * There is no delete and there never will be one here (root CLAUDE.md §7). `archived` is a status,
 * the row stays, and the audit trail stays with it.
 */
export function archiveDraft(
	projectId: string,
	userId: string | null,
	workspaceId: string | null = null,
	now = NOW,
): PipelineDraft | null {
	const row = drafts.get(projectId);
	if (!row) return null;
	if (row.ownerKey !== ownerKeyOf(userId, workspaceId)) return null;
	row.status = "archived";
	row.lastActivityAt = now;
	drafts.set(projectId, row);
	return toDraft(row);
}

/**
 * Mark a draft as having had a stage funded — which promotes it out of the sweep's reach.
 *
 * Funding does not postpone the archive deadline, it REMOVES it: a pipeline somebody has paid into is
 * an engagement, not an abandoned draft, and no amount of subsequent idleness makes it one again.
 */
export function recordDraftFunding(projectId: string, stages = 1, now = NOW): PipelineDraft | null {
	const row = drafts.get(projectId);
	if (!row) return null;
	row.fundedStageCount += stages;
	row.status = "active";
	row.lastActivityAt = now;
	drafts.set(projectId, row);
	return toDraft(row);
}

/**
 * The 30-day sweep, in the same shape the SQL job implements.
 *
 * It exists in TypeScript as well as in SQL for one reason: with `PROJECTS_BACKEND_LIVE` off there is
 * no database to run the job, and a rule that only exists on the path nobody is exercising is a rule
 * nobody has tested. Both sides call the SSOT's own {@link draftIsStale}, so the two cannot drift
 * into different definitions of "stale".
 */
export function sweepStaleDrafts(now = NOW): PipelineDraft[] {
	const archived: PipelineDraft[] = [];
	for (const row of drafts.values()) {
		if (!draftIsStale(row, now)) continue;
		row.status = "archived";
		row.lastActivityAt = now;
		archived.push(toDraft(row));
	}
	return archived;
}
// #endregion

// #region Projection
/**
 * Project a stored row into the public shape.
 *
 * `archivesAt` is DERIVED here rather than stored, by the SSOT's own {@link draftArchivesAt}. Storing
 * it would mean a funded draft kept a stale deadline unless every funding path remembered to clear
 * it — and the one that forgot would archive a live engagement.
 */
function toDraft(row: DraftRow): PipelineDraft {
	return {
		projectId: row.projectId,
		slug: row.slug,
		title: row.title,
		status: row.status,
		sourceServiceId: row.sourceServiceId,
		stageCount: row.stageCount,
		fundedStageCount: row.fundedStageCount,
		createdAt: row.createdAt,
		lastActivityAt: row.lastActivityAt,
		archivesAt: draftArchivesAt(row),
		boardHref: row.boardHref,
	};
}
// #endregion
