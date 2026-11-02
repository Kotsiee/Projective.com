import type { NavPreview, NavPreviewItem, NavPreviewKind } from "@projective/types/user";
import { type SavedEntityType, savedKey } from "@projective/types/org";
import type {
	ProjectActivity,
	ProjectFeedParams,
	ProjectSummary,
} from "@projective/types/projects";
import type { ConversationSummary } from "@projective/types/messaging";
import type { ListingSummary } from "@projective/types/catalogue";
import { roleLabel, type WorkspaceSummary } from "@projective/types/workspace";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import { MessagingBackendService } from "../messaging/MessagingBackendService.ts";
import { ProjectBackendService } from "../projects/ProjectBackendService.ts";
import { CatalogueBackendService } from "../catalogue/CatalogueBackendService.ts";
import { WorkspaceBackendService } from "../workspace/WorkspaceBackendService.ts";
import { SavedBackendService } from "../saved/SavedBackendService.ts";
import { instant, newestFirst, pinFirst } from "./nav-preview-rank.ts";

/** Rows a preview considers before ranking. shortcut: a pin older than this window is missed; page it if sellers outgrow it. */
const SCAN = 50;

/** What each awaiting project state reads as on a preview row. */
const AWAITING: Record<ProjectActivity, string> = {
	new_ticket: "New ticket available",
	revision_requested: "Revision requested",
	pending_review: "Awaiting review",
	client_invite: "Hire request",
	service_request: "Service request",
};

/** The project feed's own defaults, ranked by priority. */
const PROJECT_FEED: ProjectFeedParams = {
	q: "",
	view: "projects",
	involvement: "all",
	sort: "priority",
	dir: "desc",
	scope: "context",
	scopeType: null,
	scopeId: "",
	workspaces: [],
	roles: [],
	formats: [],
	statuses: [],
	kinds: [],
	quick: [],
	requests: [],
	serviceId: "",
};

// #region Pins
/**
 * When the viewer saved each thing of these kinds, keyed `type:ref`. Empty when the saved store is not
 * reachable (the stub backend): the rows' own `starred` flags still pin.
 */
async function pinTimes(
	types: readonly SavedEntityType[],
	actor: ReadActor,
): Promise<Map<string, string | null>> {
	return (await SavedBackendService.pins(types, actor)).data?.pins ?? new Map();
}

/** A row's pin: its saved time, `null` when starred with no time, `undefined` when not pinned. */
function pinFrom(
	pins: Map<string, string | null>,
	type: SavedEntityType,
	ref: string,
	starred = false,
): string | null | undefined {
	const key = savedKey(type, ref);
	if (pins.has(key)) return pins.get(key) ?? null;
	return starred ? null : undefined;
}

/** Concatenate reads, keeping the first row per key. */
function unique<T>(key: (row: T) => string, ...lists: readonly T[][]): T[] {
	const seen = new Map<string, T>();
	for (const row of lists.flat()) if (!seen.has(key(row))) seen.set(key(row), row);
	return [...seen.values()];
}
// #endregion

// #region Per destination
async function messages(actor: ReadActor): Promise<ServiceResult<NavPreviewItem[]>> {
	// The starred view is read on its own so a pinned thread outside the recent page still leads.
	const [recent, starred, pins] = await Promise.all([
		MessagingBackendService.conversations({ folder: "primary", limit: SCAN }, actor),
		MessagingBackendService.conversations({ view: "starred", limit: SCAN }, actor),
		pinTimes(["conversation"], actor),
	]);
	if (!recent.ok) return fail(recent.status, { message: recent.message });
	const rows = unique(
		(c: ConversationSummary) => c.id,
		starred.data?.page.conversations ?? [],
		recent.data!.page.conversations,
	);
	const pinOf = (c: ConversationSummary) => pinFrom(pins, "conversation", c.id, c.starred);
	return ok(
		pinFirst(rows, pinOf, newestFirst((c) => c.updatedAt)).map((c) => ({
			ref: c.id,
			title: c.title,
			image: c.avatar,
			detail: c.preview,
			at: c.updatedAt,
			pinned: pinOf(c) !== undefined,
		})),
	);
}

/** Awaiting the viewer, then the feed's own priority (unread, then active), then the latest activity. */
function projectUrgency(a: ProjectSummary, b: ProjectSummary): number {
	const weight = (r: ProjectSummary) =>
		(r.activity ? 0 : 4) + (r.unread ? 0 : 2) + (r.status === "active" ? 0 : 1);
	return weight(a) - weight(b) || instant(b.updatedAt) - instant(a.updatedAt);
}

async function projects(actor: ReadActor): Promise<ServiceResult<NavPreviewItem[]>> {
	const [feed, starred, pins] = await Promise.all([
		ProjectBackendService.list(PROJECT_FEED, actor),
		ProjectBackendService.list({ ...PROJECT_FEED, quick: ["starred"] }, actor),
		pinTimes(["project"], actor),
	]);
	if (!feed.ok) return fail(feed.status, { message: feed.message });
	const rows = unique(
		(p: ProjectSummary) => p.id,
		starred.data?.items ?? [],
		feed.data!.items,
	);
	const pinOf = (p: ProjectSummary) => pinFrom(pins, "project", p.slug, p.starred);
	return ok(
		pinFirst(rows, pinOf, projectUrgency).map((p) => ({
			ref: p.slug,
			title: p.title,
			image: p.owner.avatar,
			detail: p.activity ? AWAITING[p.activity] : p.scopeLabel,
			at: p.updatedAt,
			pinned: pinOf(p) !== undefined,
		})),
	);
}

/**
 * The listings the seller worked on or sold most lately: last edited first, then lifetime orders.
 * shortcut: there is no per-listing record of recent orders or enquiries; rank on it once one exists.
 */
function listingEngagement(a: ListingSummary, b: ListingSummary): number {
	return instant(b.updatedAt) - instant(a.updatedAt) || b.metrics.orders - a.metrics.orders;
}

async function catalogue(
	actor: ReadActor,
	display: string,
): Promise<ServiceResult<NavPreviewItem[]>> {
	const [list, pins] = await Promise.all([
		CatalogueBackendService.list(
			{ status: ["published", "paused", "draft"], sort: "recent", limit: SCAN, cursor: null },
			actor,
			display,
		),
		pinTimes(["service", "product"], actor),
	]);
	if (!list.ok) return fail(list.status, { message: list.message });
	const pinOf = (l: ListingSummary) => pinFrom(pins, l.kind, l.id);
	return ok(
		pinFirst(list.data!.page.items, pinOf, listingEngagement).map((l) => ({
			ref: l.id,
			title: l.title,
			image: l.cover,
			detail: l.updatedLabel,
			at: l.updatedAt,
			pinned: pinOf(l) !== undefined,
		})),
	);
}

async function workspaces(
	kind: "team" | "business",
	actor: ReadActor,
): Promise<ServiceResult<NavPreviewItem[]>> {
	const [roster, pins] = await Promise.all([
		WorkspaceBackendService.roster(kind, actor),
		pinTimes(["profile"], actor),
	]);
	if (!roster.ok) return fail(roster.status, { message: roster.message });
	const pinOf = (w: WorkspaceSummary) => pinFrom(pins, "profile", w.handle.toLowerCase());
	// Fresh updates first, then the latest change.
	const rank = (a: WorkspaceSummary, b: WorkspaceSummary) =>
		Number(b.hasUpdate) - Number(a.hasUpdate) || instant(b.updatedAt) - instant(a.updatedAt);
	return ok(
		pinFirst(roster.data!.items.filter((w) => w.status !== "archived"), pinOf, rank).map((w) => ({
			ref: w.handle,
			title: w.name,
			image: w.avatar || null,
			detail: roleLabel(w.role),
			at: w.updatedAt,
			pinned: pinOf(w) !== undefined,
		})),
	);
}
// #endregion

/**
 * NavPreviewBackendService — the rows a right-click on a rail destination lists (Decision #370). It
 * composes each destination's existing read (the inbox, the project feed, the catalogue console, the
 * workspace roster) under the caller's own session and RLS, pins what the viewer saved or starred
 * through the saved system (Decision #180), and keeps the top {@link NAV_PREVIEW_LIMIT}. Read only on
 * demand: the rail fetches it when a menu opens, never on page load.
 */
export class NavPreviewBackendService {
	/** One destination's preview. `display` is the viewer's display currency (the catalogue read takes it). */
	static async preview(
		kind: NavPreviewKind,
		actor: ReadActor,
		display: string,
	): Promise<ServiceResult<NavPreview>> {
		if (!actor.userId) return fail(401, { message: "Sign in to see your previews." });
		const res = kind === "messages"
			? await messages(actor)
			: kind === "projects"
			? await projects(actor)
			: kind === "catalogue"
			? await catalogue(actor, display)
			: await workspaces(kind === "teams" ? "team" : "business", actor);
		return res.ok ? ok({ kind, items: res.data! }) : fail(res.status, { message: res.message });
	}
}
