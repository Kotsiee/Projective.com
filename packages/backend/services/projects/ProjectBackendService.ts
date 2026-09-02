import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isProjectsBackendLive } from "../../core/supabase.ts";
import {
	cachedRead,
	cacheKey,
	invalidatePrefix,
	projectsReadCache,
	tenantPrefix,
} from "../../core/cache.ts";
import { canReadLive, type ReadActor, tenantOf } from "../read-actor.ts";
import { fetchProjectBySlug, fetchProjectRows, scopesFromRows } from "./live-queries.ts";
import { fetchBoardPage } from "./live-board.ts";
import { fetchProjectDetail } from "./live-detail.ts";
import { fetchFilePage } from "./live-files.ts";
import { fetchMemberRoster as fetchLiveMemberRoster } from "./live-members.ts";
import { fetchChannelMessagePage } from "./live-messages.ts";
import { fetchSubmissionPage } from "./live-submissions.ts";
import { fetchProjectOverview } from "./live-overview.ts";
import {
	applyProjectUpdate,
	archiveProjectRow,
	commitTicketRow,
	fetchProjectSetup,
	insertProject,
	insertProjectMessage,
	insertSubmission,
	moveTicketRow,
	type WriteOutcome,
	type WriteRefusal,
} from "./live-writes.ts";
import { findProjectSetup } from "./setup-fixtures.ts";
import { findProjectOverview } from "./overview-fixtures.ts";
import {
	appendChannelMessage,
	appendSubmission,
	buildStubCard,
	buildStubMessage,
	buildStubSubmissionUnit,
	createdDetail,
	createdSetup,
	createdSummary,
	isStoredArchived,
	isStoredCreated,
	mergeSetupPatch,
	mintTicketId,
	movedStubCard,
	overlayBoardPage,
	overlayDetail,
	overlayFeed,
	overlayMessagePage,
	overlayOverview,
	overlaySetup,
	overlaySubmissionPage,
	overlaySummary,
	putTicketCard,
	recordCreatedProject,
	recordProjectArchive,
	sentMessageCount,
	setupPatchFrom,
	storedTicketCard,
	submissionCount,
	submitStoredSubmission,
	writeOwnerOf,
} from "./write-store.ts";
import {
	findProject,
	getFeed,
	getFeedFrom,
	groupFeed,
	incomingCount,
	incomingCountFrom,
	scopeOptions,
	scopeOptionsFrom,
	serviceOptions,
	withResolvableScope,
} from "./query.ts";
import { findProjectDetail } from "./detail-fixtures.ts";
import { findMessagePage } from "./messages-fixtures.ts";
import { findFilePage } from "./files-fixtures.ts";
import { findSubmissionPage } from "./submissions-fixtures.ts";
import { findBoardPage } from "./board-fixtures.ts";
import { findMemberRoster } from "./members-fixtures.ts";
import { archiveDraft, getDraft, instantiateDraft, sweepStaleDrafts } from "./draft-store.ts";
import { buildViewPage } from "../explore/view-fixtures.ts";
import { findItem } from "../explore/query.ts";
import type {
	ArchiveDraftInput,
	InstantiateServiceInput,
	PipelineDraft,
} from "@projective/types/services";
import { createFormatToColumns, projectSlugFrom, reconcileSetup } from "@projective/types/projects";
import type {
	ArchiveProject,
	BoardCard,
	BoardListParams,
	BoardPage,
	ChatMessage,
	CommitTicket,
	CreatedProject,
	CreateProject,
	CreateSubmission,
	FileListPage,
	FileListParams,
	MemberRosterPage,
	MemberRosterParams,
	MessagePage,
	MessagePageParams,
	MessageSender,
	MoveTicket,
	ProjectDetail,
	ProjectFeedParams,
	ProjectFeedPayload,
	ProjectOverview,
	ProjectSetup,
	ProjectSummary,
	SendProjectMessage,
	SubmissionListPage,
	SubmissionListParams,
	SubmissionUnit,
	UpdateProject,
} from "@projective/types/projects";

/**
 * ProjectBackendService — the FAT server-side service behind the `/projects` middle-nav feed.
 *
 * It owns the multi-tenant feed query: scope resolution, role/format/status/kind facet filtering,
 * the sticky quick-filters, the client-by-service filter, sorting, and context grouping — plus the
 * scope + service option matrices the filter panel renders. Thin routes under
 * `apps/web/routes/api/projects/*` do only HTTP parsing + Zod validation, then delegate here and map
 * the returned {@link ServiceResult} to a `Response`; the `/projects` route calls these directly for
 * SSR first paint. Islands never reach this — they `fetch` the routes via the thin
 * `ProjectSidebarService`.
 *
 * **Stub mode (default).** With `PROJECTS_BACKEND_LIVE` off (see {@link isProjectsBackendLive}) the
 * service answers from the in-memory fixtures — the running app is unchanged. The live path
 * (RLS-scoped `projects.*` + `org.*` membership reads, escrow-aware) slots in behind the same gate
 * when it lands, a fill-in rather than a re-architecture.
 */

/** Compose the feed payload from the pure selectors (the stub read path; also the live fallback). */
function buildFeed(params: ProjectFeedParams): ProjectFeedPayload {
	const items = getFeed(params);
	return {
		count: items.length,
		incomingCount: incomingCount(params),
		items,
		groups: groupFeed(items),
		scopes: scopeOptions(params.view),
		services: serviceOptions(),
	};
}

/**
 * Compose the feed payload from LIVE rows.
 *
 * The same selectors as {@link buildFeed}, applied to rows from Postgres instead of to the fixture
 * corpus — so the feed's meaning (what `priority` sorts by, what the involvement quick-filters
 * select, what a group is) is defined in exactly one place regardless of where the rows came from.
 *
 * `services` is empty rather than fixture-derived: the provider-service list comes from
 * `marketplace.service_blueprints`, a schema `supabase/config.toml` does NOT expose to PostgREST, so
 * there is no live source for it. An empty list renders as "no service filter available", which is
 * true; the fixture list would render as a filter that selects nothing.
 */
function buildLiveFeed(
	rows: readonly ProjectSummary[],
	params: ProjectFeedParams,
): ProjectFeedPayload {
	const items = getFeedFrom(rows, params);
	return {
		count: items.length,
		incomingCount: incomingCountFrom(rows, params),
		items,
		groups: groupFeed(items),
		scopes: scopeOptionsFrom(rows, scopesFromRows(rows), params.view),
		services: [],
	};
}

/**
 * Record that a live read failed and the fixtures answered instead.
 *
 * Warned rather than thrown or swallowed: thrown, a transient broker error takes down a surface the
 * fixtures could still render; swallowed, a permanently broken live path is indistinguishable from a
 * working one. Falling back cannot disclose anything — the fixture corpus belongs to nobody.
 */
function liveFailed(method: string, error: unknown): void {
	const reason = error instanceof Error ? error.message : String(error);
	console.warn(`[ProjectBackendService.${method}] live read failed, serving fixtures: ${reason}`);
}

/**
 * Run a cached live read, or return `undefined` to mean "the caller should use the fixtures".
 *
 * Six methods share this shape exactly, and writing it out six times is six chances for one of them
 * to forget the actor check, the cache key, or the try/catch. The `undefined` return is deliberately
 * distinct from the `null` a resolver returns for "no such row": `undefined` means the live path did
 * not run or could not answer, and the fixture branch takes over; `null` means the database was
 * asked and said no, which is a real 404 the caller must NOT paper over with a fabricated fixture.
 */
async function liveRead<T>(
	method: string,
	actor: ReadActor | undefined,
	namespace: string,
	key: unknown,
	run: (actor: ReadActor & { accessToken: string }) => Promise<T | null>,
): Promise<T | null | undefined> {
	if (!isProjectsBackendLive() || !actor || !canReadLive(actor)) return undefined;
	try {
		return await cachedRead(
			projectsReadCache,
			cacheKey(tenantOf(actor), namespace, key),
			() => run(actor),
		);
	} catch (error) {
		liveFailed(method, error);
		return undefined;
	}
}

// #region Write plumbing
/**
 * Evict this tenant's cached reads.
 *
 * Called after EVERY successful write, before the result is returned. Without it the GET that
 * follows a mutation is served the pre-mutation entry for the whole cache TTL, and the change looks
 * lost while the database is perfectly correct — a failure nothing in the write path can be blamed
 * for, because the statement committed, the service returned `ok`, and the row is right.
 *
 * The whole tenant prefix rather than the one namespace that changed: moving a ticket alters the
 * board, the detail projection's stage counts, the setup ladder's staffing step and the feed row's
 * progress meter, and a list of namespaces maintained by hand at each call site is a list one write
 * eventually forgets to extend.
 */
function invalidateProjects(actor: ReadActor): void {
	invalidatePrefix(projectsReadCache, tenantPrefix(tenantOf(actor)));
}

/**
 * The refusal a write returns when nobody is signed in.
 *
 * A write genuinely needs an identity, unlike the reads, which answer a guest from the fixture
 * corpus. This is the service's own guard and not an authorisation decision: RLS remains the real
 * gate (root CLAUDE.md §6), and no capability is checked here, because the Dev Context Switcher's
 * simulated persona never reaches the server and a capability bounce would fire on it
 * (Decision #53(b)).
 */
/**
 * A slug no engagement this viewer has already drafted is using.
 *
 * The stub needs the collision discipline the database gets from its unique index: without it, two
 * projects named the same thing map to one key, and creating the second silently replaces the first —
 * which reads, from the feed, as the create having renamed something rather than added anything.
 *
 * The suffix is a counter rather than random, because the stub store is per-process and a stable
 * second address is easier to reason about than a fresh one on every attempt.
 */
function uniqueStubSlug(base: string, actor: ReadActor): string {
	// Taken by ANY project the reads can resolve, not just one this viewer drafted. The fixture corpus
	// is the other half: `createdSetup` is consulted BEFORE `findProjectSetup`, so a draft that landed
	// on a fixture's slug would not collide — it would SHADOW it, replacing a fully populated
	// engagement with a blank draft at the same address. Titling a new project "Monarch Design System"
	// did exactly that.
	const taken = (slug: string) => isStoredCreated(slug, actor) || findProjectSetup(slug) !== null;

	const seed = base || `p-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
	if (!taken(seed)) return seed;
	for (let n = 2; n < 100; n++) {
		const candidate = `${seed}-${n}`;
		if (!taken(candidate)) return candidate;
	}
	return `${seed}-${crypto.randomUUID().slice(0, 6)}`;
}

function requireIdentity<T>(actor: ReadActor, action: string): ServiceResult<T> | null {
	if (actor.userId.length > 0) return null;
	return fail<T>(401, { message: `Sign in to ${action}.` });
}

/** The uniform 404 for a slug or id that resolved to nothing the viewer can see. */
function noSuchProject<T>(id: string): ServiceResult<T> {
	return fail<T>(404, { message: `No project found for "${id}".` });
}

/**
 * The thing a write could not find, named for the reader.
 *
 * A write's `null` outcome means "the subject did not resolve", and the subject is not always a
 * project: sending a message resolves a CHANNEL, moving a ticket resolves a TICKET, filing a
 * submission resolves a STAGE. Reporting all four as "No project found for <a channel uuid>" is wrong
 * on both counts — the id is not a project's and the project is usually right there and readable.
 */
function notFound<T>(noun: string, id: string): ServiceResult<T> {
	return fail<T>(404, { message: `No ${noun} found for "${id}".` });
}

/** Map a {@link WriteRefusal} onto the service envelope, preserving the database's own wording. */
function refused<T>(refusal: WriteRefusal): ServiceResult<T> {
	return fail<T>(refusal.status, { message: refusal.message, errors: refusal.errors });
}

/**
 * Run a live write, or return `undefined` to mean "the caller should use the stub store".
 *
 * The mirror of {@link liveRead} with one deliberate asymmetry: a live read that throws falls back
 * to the fixtures, and a live WRITE that throws must not. Falling back would run the stub, store the
 * change in memory and answer `ok` for a mutation Postgres never accepted — reporting a save that
 * did not happen, which is the one outcome worse than reporting a failure. So a thrown live write
 * surfaces as a `502` and the caller is told to try again.
 */
async function liveWrite<T>(
	method: string,
	actor: ReadActor,
	subject: string,
	message: string,
	run: (actor: ReadActor & { accessToken: string }) => Promise<WriteOutcome<T>>,
	/** What `subject` names — see {@link notFound}. Defaults to a project, which most writes resolve. */
	noun = "project",
): Promise<ServiceResult<T> | undefined> {
	if (!isProjectsBackendLive() || !canReadLive(actor)) return undefined;
	try {
		const outcome = await run(actor);
		if (outcome === null) return notFound<T>(noun, subject);
		if ("refusal" in outcome) return refused<T>(outcome.refusal);
		invalidateProjects(actor);
		return ok(outcome.data, { message });
	} catch (error) {
		liveFailed(method, error);
		return fail<T>(502, { message: "That change could not be saved — please try again." });
	}
}

/**
 * The identity a stub-written row is authored by.
 *
 * Read out of the corpus rather than minted, by finding the viewer's own most recent message in the
 * channel. The fixture corpus already has a face and a name for the acting viewer, and a second
 * identity built here would put two different people's avatars on one person's messages inside a
 * single conversation.
 *
 * The fallback is deliberately plain. A message with an unnamed author is legible; one attributed to
 * a fabricated participant is a claim about who said it.
 */
function viewerSenderFor(projectId: string, channelId: string | null): MessageSender {
	const channels = channelId
		? [channelId]
		: findProjectDetail(projectId)?.channels.general.map((channel) => channel.id) ?? [];
	for (const id of channels) {
		const page = findMessagePage({ projectId, channelId: id });
		const own = page?.messages.filter((message) => message.isOwn).at(-1);
		if (own?.sender) return own.sender;
	}
	return { id: "viewer", name: "You", avatar: null, handle: null };
}
// #endregion

export class ProjectBackendService {
	/**
	 * The context-scoped `/projects` feed: matched engagement rows, context groups, and the scope +
	 * service option matrices for the filter panel.
	 */
	static async list(
		params: ProjectFeedParams,
		actor: ReadActor,
	): Promise<ServiceResult<ProjectFeedPayload>> {
		if (!isProjectsBackendLive() || !canReadLive(actor)) {
			// Stub mode: drop a phantom scope pin (a real auth contextId matches no fixture workspace)
			// so the lane shows the acting account's feed instead of stranding empty. See
			// {@link withResolvableScope}. This covers BOTH the SSR first paint and the thin
			// `/api/projects/list` refetch (a stale cached scopeId), the single chokepoint they share.
			//
			// It runs on the guest path too: an unauthenticated caller cannot reach the live branch,
			// and `anon` holds no USAGE on the `projects` schema anyway, so the query would fail 42501
			// rather than return an empty feed.
			return ok(overlayFeed(buildFeed(withResolvableScope(params)), actor));
		}
		try {
			// The ROWS are cached, not the composed payload: the filter/sort facets change on every
			// keystroke of the lane's search, and caching per-facet-combination would miss constantly
			// while holding many near-identical copies of one tenant's projects.
			const key = cacheKey(tenantOf(actor), "projects.rows");
			const rows = await cachedRead(projectsReadCache, key, () => fetchProjectRows(actor));
			return ok(buildLiveFeed(rows, params));
		} catch (error) {
			liveFailed("list", error);
			return ok(overlayFeed(buildFeed(withResolvableScope(params)), actor));
		}
	}

	/** Look up a single engagement by slug — backs deep-link prefetch / row focus. */
	static async item(
		slug: string,
		actor: ReadActor,
	): Promise<ServiceResult<{ item: ProjectSummary }>> {
		if (isProjectsBackendLive() && canReadLive(actor)) {
			try {
				const key = cacheKey(tenantOf(actor), "projects.item", { slug });
				const item = await cachedRead(
					projectsReadCache,
					key,
					() => fetchProjectBySlug(actor, slug),
				);
				// A live miss is a real 404 — the slug does not exist, or RLS withholds it. Falling
				// through to the fixtures would answer a genuine "no" with a fabricated "yes".
				if (item) return ok({ item });
				return fail(404, { message: `No project found for slug "${slug}".` });
			} catch (error) {
				liveFailed("item", error);
			}
		}
		const drafted = createdSummary(slug, actor);
		if (drafted) return ok({ item: drafted });

		const found = findProject(slug);
		if (!found) return fail(404, { message: `No project found for slug "${slug}".` });
		// The same overlay the feed takes. Without it a rename made on the setup surface was visible
		// there and stale on the card beside it, and an archived project answered as though it were
		// live — `overlaySummary` returns null for one, which is a 404 here.
		const item = overlaySummary(found, actor);
		if (!item) return fail(404, { message: `No project found for slug "${slug}".` });
		return ok({ item });
	}

	/**
	 * The deep single-engagement projection behind the Project Details sidebar
	 * (`/projects/[projectId]`): the contextual header, core view links data, member roster, and the
	 * four-group communication channel tree. SSR calls this directly for first paint; the sidebar
	 * island refines via the thin route.
	 *
	 * **Live behind `PROJECTS_BACKEND_LIVE`.** The contradiction below is now RESOLVED in the
	 * mapping layer rather than blocking the read; it is kept because it is why certain fields are
	 * neutral rather than absent:
	 * `projects.project_stages.status` is the 8-member `stage_status` enum (open/assigned/in_progress/
	 * submitted/approved/revisions/paid/cancelled) while `StageChannel.status` reuses the 5-member
	 * `ProjectStatus` (draft/active/on_hold/completed/cancelled). The ONLY member they share is
	 * `cancelled`, so every live stage would land on a value the projection cannot express, and
	 * `stageLocked(stage) = stage.status !== "draft"` is written against a value the database can
	 * never produce. A mapping table is a decision about what a stage MEANS, not a cast.
	 */
	static async detail(
		slug: string,
		actor?: ReadActor,
	): Promise<ServiceResult<{ detail: ProjectDetail }>> {
		const live = await liveRead(
			"detail",
			actor,
			"projects.detail",
			{ slug },
			(a) => fetchProjectDetail(a, slug),
		);
		if (live !== undefined) {
			if (!live) return fail(404, { message: `No project found for slug "${slug}".` });
			return ok({ detail: live });
		}
		// A project this viewer DRAFTED has no fixture underneath it. Asked first, because this is the
		// read the `/projects/[projectId]` role dispatcher branches on: a null detail defaults
		// `viewerIsClient` to false and sends the creator to the member dashboard, which then renders
		// "Project not found" over a project that was created perfectly well.
		const created = createdDetail(slug, actor);
		if (created) return ok({ detail: created });

		const detail = findProjectDetail(slug);
		if (!detail) {
			return fail(404, { message: `No project found for slug "${slug}".` });
		}
		return ok({ detail: overlayDetail(detail, actor) });
	}

	/**
	 * A page of a channel's conversation (`/projects/[projectId]/[channelId]/chat`): the message feed
	 * behind the bottom-anchored, virtualized chat view. Bottom-anchored history — `before` unset yields
	 * the latest page, a `before` cursor yields the strictly-older page (the scroll-up load). Also carries
	 * the sticky pinned set + the viewer's pin capability. SSR calls this directly for first paint; the
	 * feed island refines / paginates via the thin `MessagesService`.
	 *
	 * **Live behind `PROJECTS_BACKEND_LIVE`.** The contradiction below is now RESOLVED in the
	 * mapping layer rather than blocking the read; it is kept because it is why certain fields are
	 * neutral rather than absent:
	 * `comms.project_messages` IS readable (it has a real SELECT policy), but the projection is not
	 * reachable: `comms.message_attachments` is polymorphic with NO foreign key on `message_id`, so
	 * PostgREST cannot embed it (it needs its own keyed query); and a project channel has NO
	 * per-viewer read watermark anywhere, so `unread` has no backing. The pins/reactions/favourites
	 * tables are no longer a blocker — they had RLS switched off entirely and now carry policies.
	 * Separately, `trg_mask_message_pii` may have rewritten the body in place with no field on
	 * `ChatMessage` to disclose that it did.
	 */
	static async messages(
		params: MessagePageParams,
		actor?: ReadActor,
	): Promise<ServiceResult<{ page: MessagePage }>> {
		const live = await liveRead(
			"messages",
			actor,
			"projects.messages",
			params,
			(a) => fetchChannelMessagePage(a, params),
		);
		if (live !== undefined) {
			if (!live) return fail(404, { message: "No such project channel." });
			return ok({ page: live });
		}
		const page = findMessagePage(params);
		if (!page) return fail(404, { message: "No such project channel." });
		// Only the LATEST page takes the fold. A sent message postdates the whole channel, so folding
		// it into an older page fetched by the scroll-up cursor would insert it into history it comes
		// after — and the feed would then render the same message twice on the way back down.
		return ok({ page: overlayMessagePage(page, params.projectId, !params.before, actor) });
	}

	/**
	 * A page of files for the File Explorer — the attachments shared across a project's channels
	 * (`/projects/[projectId]/files`) or one channel (`/projects/[projectId]/[channelId]/files`).
	 * `channelId` unset/null selects the whole project (all channels, plus the channel index the tree
	 * navigator renders); set narrows to that channel. The page is already sorted + filtered + cursor-
	 * paged for the virtualized grid/list. SSR calls this directly for first paint; the explorer island
	 * refines (sort/filter/scroll-load) via the thin `FilesService`.
	 *
	 * **Live behind `PROJECTS_BACKEND_LIVE`.** The contradiction below is now RESOLVED in the
	 * mapping layer rather than blocking the read; it is kept because it is why certain fields are
	 * neutral rather than absent:
	 * `FileItem` is a NARROWING of `AssetItemSchema` that re-mandates `channelId`/`channelName`/
	 * `channelKind`/`messageId`/`messageText`/`sender` as non-null `min(1)`, and `comms.channel_files`
	 * has no `message_id` column at all — so a channel-level file can satisfy the broader `AssetItem`
	 * and can NEVER satisfy `FileItem`. Constructing one also needs the required 28-member
	 * `FileCategory` and fifteen hub facets that no column supplies.
	 */
	static async files(
		params: FileListParams,
		actor?: ReadActor,
	): Promise<ServiceResult<{ page: FileListPage }>> {
		const live = await liveRead(
			"files",
			actor,
			"projects.files",
			params,
			(a) => fetchFilePage(a, params),
		);
		if (live !== undefined) {
			if (!live) {
				return fail(404, { message: `No project found for id "${params.projectId}".` });
			}
			return ok({ page: live });
		}
		const page = findFilePage(params);
		if (!page) {
			return fail(404, { message: `No project found for id "${params.projectId}".` });
		}
		return ok({ page });
	}

	/**
	 * A page of the Submissions explorer — the deliverable hierarchy a client reviews, scoped to one
	 * channel (`/projects/[projectId]/[channelId]/submissions/…`) or the whole project (Stages as tree
	 * roots, `/projects/[projectId]/submissions/…`). Returns the navigation tree, the files under the
	 * requested `path` (already sorted + filtered + cursor-paged), the breadcrumb trail, and — when the
	 * path resolves to a submission unit — the review projection the review workspace modal renders. SSR
	 * calls this directly for first paint; the explorer island refines / navigates via the thin
	 * `SubmissionsService`.
	 *
	 * **Live behind `PROJECTS_BACKEND_LIVE`.** The contradiction below is now RESOLVED in the
	 * mapping layer rather than blocking the read; it is kept because it is why certain fields are
	 * neutral rather than absent:
	 * A hard spelling mismatch: Zod `SubmissionStatus` has `revision_requested` (singular) while the
	 * CHECK on `projects.stage_submissions.status` writes `revisions_requested` (plural). Every
	 * revision row would fail Zod parse. Compounding it, the column is NULLABLE and a SQL CHECK is
	 * NULL-tolerant, so an explicit NULL is storable, passes the constraint, and fails the required
	 * Zod field. Reconciling the two spellings is a data decision.
	 */
	static async submissions(
		params: SubmissionListParams,
		actor?: ReadActor,
	): Promise<ServiceResult<{ page: SubmissionListPage }>> {
		const live = await liveRead(
			"submissions",
			actor,
			"projects.submissions",
			params,
			(a) => fetchSubmissionPage(a, params),
		);
		if (live !== undefined) {
			if (!live) {
				return fail(404, { message: `No project found for id "${params.projectId}".` });
			}
			return ok({ page: live });
		}
		const page = findSubmissionPage(params);
		if (!page) {
			return fail(404, { message: `No project found for id "${params.projectId}".` });
		}
		return ok({ page: overlaySubmissionPage(page, actor) });
	}

	/**
	 * The Kanban board — the project-level pipeline (`/projects/[projectId]/board`, columns = New + the
	 * Stages + Completed) or a stage-level Tasks board (`/projects/[projectId]/[channelId]/tasks`, columns
	 * = the ticket-status lanes). Returns the columns, the ticket cards (already filtered), the stage list
	 * (for the ticket modal + Stages/Status toggle), and the viewer capability flags that gate client-only
	 * moves + creation. SSR calls this directly for first paint; the board island refines (search/filter/
	 * view) via the thin `BoardService`.
	 *
	 * **Live behind `PROJECTS_BACKEND_LIVE`.** The contradiction below is now RESOLVED in the
	 * mapping layer rather than blocking the read; it is kept because it is why certain fields are
	 * neutral rather than absent:
	 * `BoardStageRef.categoryWeight` is bounded 0..10 and has NO column anywhere — it drives the
	 * workload figure `W_i`, so inventing it makes the number plausible and wrong (already flagged by
	 * Decision #64(b)). `TicketPaymentEntry` needs the `finance` schema, on which `authenticated`
	 * holds no USAGE. And `BoardListParams` has no cursor at all, so a live board would serialise
	 * every ticket's full attachment/history/submission/payment graph in one unpaged response.
	 */
	static async board(
		params: BoardListParams,
		actor?: ReadActor,
	): Promise<ServiceResult<{ page: BoardPage }>> {
		const live = await liveRead(
			"board",
			actor,
			"projects.board",
			params,
			(a) => fetchBoardPage(a, params),
		);
		if (live !== undefined) {
			if (!live) {
				return fail(404, { message: `No project found for id "${params.projectId}".` });
			}
			return ok({ page: live });
		}
		const page = findBoardPage(params);
		if (!page) {
			return fail(404, { message: `No project found for id "${params.projectId}".` });
		}
		return ok({ page: overlayBoardPage(page, actor) });
	}

	/**
	 * The Members roster — the participants with access to the whole project
	 * (`/projects/[projectId]/members`) or one channel/stage (`/projects/[projectId]/[channelId]/members`),
	 * with their role, stage assignment (contributor/observer), presence, workload, contact + join date,
	 * the pending-invitation queue, and the viewer capability flags that gate the client/admin/manager
	 * management actions. Also honours the DEV-ONLY simulation hints (`simViewer`/`simProjectType`/
	 * `simPendingInvites`) so the surface can be exercised across every role/type/invite state. SSR calls
	 * this directly for first paint; the roster island refines / re-simulates via the thin `MembersService`.
	 *
	 * **Live behind `PROJECTS_BACKEND_LIVE`.** The contradiction below is now RESOLVED in the
	 * mapping layer rather than blocking the read; it is kept because it is why certain fields are
	 * neutral rather than absent:
	 * There is no presence column in either schema, so `MemberPresence` — which is required, not
	 * nullable — has no source. `InviteStatus` is `(pending, expired)` while the DB CHECK on
	 * `projects.project_invitations.role` allows `('pending','accepted','expired','revoked')`, so two
	 * storable values fail parse. `projects.project_participants.role` is unconstrained free text
	 * whose only written value is `'assignee'` — not a member of `ProjectViewerRole` at all. And
	 * `ProjectMemberRow.email` has no column on `org.users_public`.
	 */
	static async members(
		params: MemberRosterParams,
		actor?: ReadActor,
	): Promise<ServiceResult<{ page: MemberRosterPage }>> {
		const live = await liveRead(
			"members",
			actor,
			"projects.members",
			params,
			(a) => fetchLiveMemberRoster(a, params),
		);
		if (live !== undefined) {
			if (!live) {
				return fail(404, { message: `No project found for id "${params.projectId}".` });
			}
			return ok({ page: live });
		}
		const page = findMemberRoster(params);
		if (!page) {
			return fail(404, { message: `No project found for id "${params.projectId}".` });
		}
		return ok({ page });
	}

	/**
	 * The owner's editable configuration for one engagement, plus its derived setup ladder — the
	 * Details half of `/projects/[projectId]` and the progress bar in its header band.
	 *
	 * `steps`, `completeness` and `previewReady` are computed by `reconcileSetup` on both sides of
	 * the gate, so the bar the owner reads and the gate that unlocks Preview can never disagree about
	 * the same project. They are never accepted from a client (root CLAUDE.md §6).
	 */
	static async setup(
		slug: string,
		actor: ReadActor,
	): Promise<ServiceResult<{ setup: ProjectSetup }>> {
		const live = await liveRead(
			"setup",
			actor,
			"projects.setup",
			{ slug },
			(a) => fetchProjectSetup(a, slug),
		);
		if (live !== undefined) {
			if (!live) return noSuchProject(slug);
			return ok({ setup: live });
		}
		// An engagement this viewer DRAFTED has no fixture underneath it, so the store is asked first.
		// Without this the stub create persists and the read cannot see it — which is the same "Project
		// not found" over a project that was created perfectly well that the live path exists to fix,
		// reproduced one layer up and in the mode that ships by default.
		const created = createdSetup(slug, actor);
		if (created) return ok({ setup: created });

		const setup = findProjectSetup(slug);
		if (!setup) return noSuchProject(slug);
		return ok({ setup: overlaySetup(setup, actor) });
	}

	/**
	 * The member dashboard for one engagement — the half of `/projects/[projectId]` a viewer who is
	 * not the client sees: the hero, recent updates, channel quick-entries, their own assignments and
	 * their own money position.
	 *
	 * The finance block is VIEWER-PERTINENT and server-computed. It answers what this person is owed
	 * on this project and never what the project is worth, and every figure arrives as a `MoneyView`
	 * so the client renders a string rather than totalling anything itself.
	 */
	static async overview(
		slug: string,
		actor: ReadActor,
	): Promise<ServiceResult<{ overview: ProjectOverview }>> {
		const live = await liveRead(
			"overview",
			actor,
			"projects.overview",
			{ slug },
			(a) => fetchProjectOverview(a, slug),
		);
		if (live !== undefined) {
			if (!live) return noSuchProject(slug);
			return ok({ overview: live });
		}
		const found = findProjectOverview(slug);
		if (!found) return noSuchProject(slug);
		if (isStoredArchived(slug, actor)) return noSuchProject(slug);
		return ok({ overview: overlayOverview(found, slug, actor) });
	}

	/**
	 * Save the setup form — the PUT/PATCH behind the Details surface.
	 *
	 * Returns the RE-DERIVED configuration rather than echoing the payload, because the ladder and
	 * the percentage are functions of what is now stored: echoing would report a completeness the
	 * project does not have, and the footer's dirty state is measured against this response
	 * (Decision #61), so an echo would also leave the form permanently dirty after a successful save.
	 */
	static async updateProject(
		slug: string,
		input: UpdateProject,
		actor: ReadActor,
		/**
		 * Whether this is a FULL replace (`PUT`) rather than a merge (`PATCH`).
		 *
		 * It decides one thing and it is the destructive one: whether a stage or role the payload does
		 * not mention is DELETED. A PATCH sends the section that changed, so treating an absent stage
		 * as a removal turns a title-only save into a pipeline wipe — and deleting a stage releases its
		 * escrow. Only a caller who said "here is the whole resource" gets that.
		 */
		replace = false,
	): Promise<ServiceResult<{ setup: ProjectSetup }>> {
		const denied = requireIdentity<{ setup: ProjectSetup }>(actor, "edit this project");
		if (denied) return denied;

		const live = await liveWrite<{ setup: ProjectSetup }>(
			"updateProject",
			actor,
			slug,
			"Project saved.",
			async (a) => {
				const outcome = await applyProjectUpdate(a, slug, input, replace);
				if (outcome === null || "refusal" in outcome) return outcome;
				return { data: { setup: outcome.data } };
			},
		);
		if (live) return live;

		const base = findProjectSetup(slug);
		if (!base) return noSuchProject(slug);
		const owner = writeOwnerOf(actor);
		const merged = mergeSetupPatch(owner, slug, setupPatchFrom(input, overlaySetup(base, actor)));
		invalidateProjects(actor);
		return ok({ setup: reconcileSetup(base, merged) }, { message: "Project saved." });
	}

	/**
	 * Archive an engagement — the DELETE, which is a soft archive and never a row removal
	 * (root CLAUDE.md §5).
	 *
	 * Idempotent: archiving an already-archived project returns the ORIGINAL instant rather than
	 * restamping it, so a double-press or a retry after an unseen timeout cannot rewrite when the
	 * decision was taken.
	 */
	static async archiveProject(
		slug: string,
		input: ArchiveProject,
		actor: ReadActor,
	): Promise<ServiceResult<{ slug: string; archivedAt: string }>> {
		type Archived = { slug: string; archivedAt: string };
		const denied = requireIdentity<Archived>(actor, "archive this project");
		if (denied) return denied;

		const live = await liveWrite<Archived>(
			"archiveProject",
			actor,
			slug,
			"Project archived.",
			(a) => archiveProjectRow(a, slug, input),
		);
		if (live) return live;

		if (!findProjectSetup(slug)) return noSuchProject(slug);
		const archivedAt = recordProjectArchive(
			writeOwnerOf(actor),
			slug,
			new Date().toISOString(),
		);
		invalidateProjects(actor);
		return ok({ slug, archivedAt }, { message: "Project archived." });
	}

	/**
	 * Create or update one ticket, and return the card the board renders.
	 *
	 * The returned `id` is always SERVER-minted. The composer sends its own optimistic id so the
	 * answer can be reconciled against the card it spliced in, and echoing that id back would leave
	 * the board holding a key no later write could address.
	 *
	 * Two of `projects.tickets`' eleven triggers are mirrored here so the stub refuses exactly what
	 * the database refuses. A rule enforced on only one side of the gate is a rule whose violations
	 * appear the day the gate flips, in a save that was working the day before.
	 */
	static async commitTicket(
		input: CommitTicket,
		actor: ReadActor,
	): Promise<ServiceResult<{ card: BoardCard }>> {
		const denied = requireIdentity<{ card: BoardCard }>(actor, "save a ticket");
		if (denied) return denied;

		const live = await liveWrite<{ card: BoardCard }>(
			"commitTicket",
			actor,
			input.projectId,
			"Ticket saved.",
			async (a) => {
				const outcome = await commitTicketRow(a, input);
				if (outcome === null || "refusal" in outcome) return outcome;
				// Evicted the moment the row lands, not after the read-back. The ticket exists from here
				// on whatever happens next, so a re-read that fails must still leave the cache holding
				// nothing rather than the board as it was before the ticket was created.
				invalidateProjects(a);
				const page = await fetchBoardPage(a, { projectId: input.projectId, view: "stages" });
				const card = page?.cards.find((c) => c.id === outcome.data);
				// The board is re-read rather than a second card assembled here: composing one needs the
				// ticket's history, submissions, attachments and money trail, and a second assembler is a
				// second answer to what a ticket costs.
				if (!card) return { refusal: { status: 502, message: "Ticket saved but not readable." } };
				return { data: { card } };
			},
		);
		if (live) return live;

		const board = findBoardPage({ projectId: input.projectId, view: "stages" });
		if (!board) return noSuchProject(input.projectId);
		const page = overlayBoardPage(board, actor);
		// Overlaid, like its sibling reads. The base fixture has `allowDeadlineBonuses: false`, so
		// reading it raw meant an owner could turn deadline bonuses on, see the toggle stay on, and have
		// every due date refused anyway — the write they had just made was invisible to the check.
		const base = findProjectSetup(input.projectId);
		const setup = base ? overlaySetup(base, actor) : null;

		// `fn_enforce_ticket_due_date` RAISES when a due date is set on a project that has not agreed
		// to deadline bonus terms. Refusing with the reason is the difference between a form the owner
		// can correct and a save that aborts with nothing to act on.
		if (input.dueDate && setup && !setup.rules.allowDeadlineBonuses) {
			return fail(422, {
				message: "Turn on deadline bonuses for this project before setting a ticket due date.",
				errors: { dueDate: "deadline_bonuses_disabled" },
			});
		}
		// `fn_enforce_ticket_checkout_desc` RAISES on entering `claimed`/`in_progress` with an empty
		// description — the purchasing gate (PRODUCT_SPEC §Creation & Purchasing Gate), enforced in the
		// database as well as in the composer.
		const claiming = input.status === "claimed" || input.status === "in_progress";
		if (claiming && input.description.trim().length === 0) {
			return fail(422, {
				message: "Describe the work before it can be claimed.",
				errors: { description: "description_required" },
			});
		}

		const owner = writeOwnerOf(actor);
		const existing = storedTicketCard(owner, input.projectId, input.clientId) ??
			page.cards.find((card) => card.id === input.clientId);
		const id = existing?.id ?? mintTicketId();
		const card = buildStubCard(input, page.stages, existing, id, Date.now());
		putTicketCard(owner, input.projectId, card);
		invalidateProjects(actor);
		return ok({ card }, { message: "Ticket saved." });
	}

	/**
	 * Move one ticket between board columns.
	 *
	 * The live path goes through `projects.move_ticket` and NEVER a status column write, because
	 * `trg_ticket_escrow_sync` fires on one: a plain `UPDATE ... SET status = 'completed'` releases
	 * escrow to the freelancer. Status is a money-moving column, and `move_ticket` is where the
	 * delivery-authority check and the audit row live.
	 *
	 * The stub moves the card and moves no money. Nothing here may flip `escrowHeld` or write a
	 * payment line, because a ledger with no transaction behind it is worse than no ledger.
	 */
	static async moveTicket(
		input: MoveTicket,
		actor: ReadActor,
	): Promise<ServiceResult<{ card: BoardCard }>> {
		const denied = requireIdentity<{ card: BoardCard }>(actor, "move a ticket");
		if (denied) return denied;

		const live = await liveWrite<{ card: BoardCard }>(
			"moveTicket",
			actor,
			input.ticketId,
			"Ticket moved.",
			async (a) => {
				const outcome = await moveTicketRow(a, input);
				if (outcome === null || "refusal" in outcome) return outcome;
				// The move has committed — and it may have released escrow through
				// `trg_ticket_escrow_sync`. Evict before the read-back so a failed re-read cannot leave a
				// board cached in the column the ticket has already left.
				invalidateProjects(a);
				const page = await fetchBoardPage(a, { projectId: input.projectId, view: "stages" });
				const card = page?.cards.find((c) => c.id === outcome.data);
				if (!card) return { refusal: { status: 502, message: "Ticket moved but not readable." } };
				return { data: { card } };
			},
			"ticket",
		);
		if (live) return live;

		const board = findBoardPage({ projectId: input.projectId, view: "stages" });
		if (!board) return noSuchProject(input.projectId);
		const owner = writeOwnerOf(actor);
		const page = overlayBoardPage(board, actor);
		const current = storedTicketCard(owner, input.projectId, input.ticketId) ??
			page.cards.find((card) => card.id === input.ticketId);
		if (!current) return fail(404, { message: "That ticket is no longer on this board." });

		const card = movedStubCard(current, input, Date.now());
		putTicketCard(owner, input.projectId, card);
		invalidateProjects(actor);
		return ok({ card }, { message: "Ticket moved." });
	}

	/**
	 * Post one message into a project channel.
	 *
	 * Attachments arrive as `files.items` ids, never as bytes: the device upload already went through
	 * the files handshake before this call, which is why `/api/files/upload-init` exists. An
	 * application route is not a file transport.
	 */
	static async sendMessage(
		input: SendProjectMessage,
		actor: ReadActor,
	): Promise<ServiceResult<{ message: ChatMessage }>> {
		const denied = requireIdentity<{ message: ChatMessage }>(actor, "send a message");
		if (denied) return denied;

		const live = await liveWrite<{ message: ChatMessage }>(
			"sendMessage",
			actor,
			input.channelId,
			"Message sent.",
			async (a) => {
				const outcome = await insertProjectMessage(a, input);
				if (outcome === null || "refusal" in outcome) return outcome;
				return { data: { message: outcome.data } };
			},
			"channel",
		);
		if (live) return live;

		const page = findMessagePage({ projectId: input.projectId, channelId: input.channelId });
		if (!page) return fail(404, { message: "No such project channel." });

		const owner = writeOwnerOf(actor);
		const message = buildStubMessage(
			input,
			viewerSenderFor(input.projectId, input.channelId),
			sentMessageCount(owner, input.projectId, input.channelId),
			Date.now(),
		);
		appendChannelMessage(owner, input.projectId, input.channelId, message);
		invalidateProjects(actor);
		return ok({ message }, { message: "Message sent." });
	}

	/**
	 * Create one submission unit against a stage.
	 *
	 * `submit` is the whole difference between two outcomes. A draft is editable and makes no
	 * delivery claim; `pending_review` starts the reviewer's clock. Conflating them would tell a
	 * client that work is waiting on them which the freelancer has not finished.
	 */
	static async createSubmission(
		input: CreateSubmission,
		actor: ReadActor,
	): Promise<ServiceResult<{ unit: SubmissionUnit }>> {
		const denied = requireIdentity<{ unit: SubmissionUnit }>(actor, "create a submission");
		if (denied) return denied;

		const live = await liveWrite<{ unit: SubmissionUnit }>(
			"createSubmission",
			actor,
			input.stageId,
			input.submit ? "Submitted for review." : "Draft saved.",
			async (a) => {
				const outcome = await insertSubmission(a, input);
				if (outcome === null || "refusal" in outcome) return outcome;
				return { data: { unit: outcome.data } };
			},
			"stage",
		);
		if (live) return live;

		const detail = findProjectDetail(input.projectId);
		if (!detail) return noSuchProject(input.projectId);
		const stage = detail.channels.stages.find((s) => s.id === input.stageId);

		const owner = writeOwnerOf(actor);
		const unit = buildStubSubmissionUnit(
			input,
			viewerSenderFor(input.projectId, input.channelId),
			stage?.name ?? null,
			submissionCount(owner, input.projectId) + 1,
			Date.now(),
		);
		// Sending a draft that already exists is a transition here too, exactly as it is live: appending
		// would leave the freelancer looking at their delivery twice, once as a draft they can no longer
		// send and once as the submission.
		const sent = input.submit && input.submissionId
			? submitStoredSubmission(owner, input.projectId, input.submissionId, {
				...unit,
				path: [...unit.path.slice(0, -1), input.submissionId],
			})
			: null;
		if (!sent) {
			appendSubmission(owner, input.projectId, {
				unit,
				stageId: input.stageId,
				channelId: input.channelId,
			});
		}
		invalidateProjects(actor);
		return ok({ unit: sent?.unit ?? unit }, {
			status: sent ? 200 : 201,
			message: input.submit ? "Submitted for review." : "Draft saved.",
		});
	}

	/**
	 * Create a new engagement, and return the two identifiers it can be addressed by.
	 *
	 * `slug` is what the client navigates to — every `/projects/*` route resolves an engagement by
	 * slug — and `id` is the primary key, the only thing a later write may safely reference. Both are
	 * returned because a caller given one would have to read the row back for the other.
	 *
	 * The slug is NOT the title slugified and hoped for. It is whatever the database settled on, which
	 * may carry a disambiguating suffix (two people can name a project the same thing) or be the
	 * generated `p-<hex>` form (a title with no Latin characters slugifies to nothing). Returning the
	 * client's guess instead was the original defect: it navigated to an address that did not exist.
	 *
	 * A created engagement is always a `draft`, and always `unlisted`. Neither is read from the
	 * payload — see `projects.create_project`.
	 */
	static async create(
		input: CreateProject,
		actor: ReadActor,
	): Promise<ServiceResult<CreatedProject>> {
		const denied = requireIdentity<CreatedProject>(actor, "create a project");
		if (denied) return denied;

		const live = await liveWrite<CreatedProject>(
			"create",
			actor,
			input.title,
			"Project drafted.",
			(a) => insertProject(a, input),
			"workspace",
		);
		if (live) return { ...live, status: live.ok ? 201 : live.status };

		// STUB. It persists, and that is not decoration: stub mode is the default, and a create that
		// returns a slug the next request cannot resolve reproduces the exact 404 the live path exists
		// to fix. `reconcileSetup` builds the projection so a drafted engagement measures its own
		// completeness with the same function that measures a live one's.
		const owner = writeOwnerOf(actor);
		const id = crypto.randomUUID();
		const { format, structure } = createFormatToColumns(input.format);
		const slug = uniqueStubSlug(projectSlugFrom(input.title), actor);
		const setup = reconcileSetup({
			slug,
			title: input.title,
			format,
			structure,
			sessionKind: "none",
			status: "draft",
			archivedAt: null,
			description: input.scope,
			budget: input.budget
				? {
					budgetType: input.budget.budgetType,
					amountCents: input.budget.amountCents,
					currency: input.budget.currency,
				}
				: undefined,
			stages: input.stages.map((stage, index) => ({
				id: `stage-${index + 1}`,
				name: stage.name,
				order: index,
				description: stage.description,
				unitPriceCents: stage.unitPriceCents,
				milestone: stage.milestone,
				skills: [],
			})),
			roles: input.roles.map((role, index) => ({
				id: `role-${index + 1}`,
				name: role.name,
				skills: role.skills,
				budgetCents: null,
			})),
			viewerIsClient: true,
		});
		recordCreatedProject(owner, id, setup, Date.now());
		invalidateProjects(actor);
		return ok({ id, slug }, { status: 201, message: "Project drafted." });
	}

	/**
	 * Instantiate a **Pipeline service template** into the acting client's workspace as a draft
	 * project — the write behind "Add to Projects".
	 *
	 * What the live path will do, and what the shapes here already promise:
	 * - insert `projects.projects` with `status = 'draft'`, `visibility = 'unlisted'` and
	 *   `source_blueprint_id` pointing at the service;
	 * - copy the blueprint's stages into `projects.project_stages`;
	 * - leave every `projects.stage_assignments` row at `pending_funding`, so nobody is committed to
	 *   anything and no escrow exists until the client funds the first ticket.
	 *
	 * **No money moves and nothing is reserved.** That is the whole reason this is a draft rather than
	 * a basket line: a pipeline is not bought, it is staffed and then bought against, one ticket at a
	 * time (`PRODUCT_SPEC.md` §Creation & Purchasing Gate). A buyer must be able to open the board and
	 * read the stages before deciding anything, which a basket line cannot hold.
	 *
	 * Idempotent on `input.idempotencyKey`: a repeat returns the SAME draft with `created: false`
	 * rather than refusing, so a double-press or a retry after an unseen timeout cannot leave two
	 * identical pipelines in someone's workspace.
	 */
	static instantiateService(
		input: InstantiateServiceInput,
		actor: { userId: string | null },
	): ServiceResult<{ draft: PipelineDraft; created: boolean }> {
		const item = findItem(input.serviceId);
		if (!item || item.type !== "services") {
			return fail(404, { message: `No service found for id "${input.serviceId}".` });
		}
		if (item.serviceType !== "Pipeline") {
			return fail(422, {
				message: "Only a pipeline service can be added to your projects.",
				errors: { serviceId: "not_a_pipeline" },
			});
		}

		const view = buildViewPage(item);
		const stageCount = view.service?.stages.length ?? 0;

		const result = instantiateDraft(input, {
			serviceId: item.id,
			title: item.title,
			stageCount,
			userId: actor.userId,
			workspaceId: input.workspaceId,
		});

		if (!isProjectsBackendLive()) {
			return ok(result, {
				status: result.created ? 201 : 200,
				message: result.created
					? "Added to your projects as a draft."
					: "This service is already in your projects.",
			});
		}
		// LIVE: insert the project + copy the blueprint stages through the RLS-scoped RPC (not yet
		// implemented) — fall through to the store so behaviour is preserved either side of the gate.
		return ok(result, {
			status: result.created ? 201 : 200,
			message: result.created
				? "Added to your projects as a draft."
				: "This service is already in your projects.",
		});
	}

	/**
	 * Soft-archive a draft pipeline — the "Remove / Archive draft" secondary control.
	 *
	 * Nothing is hard-deleted (root CLAUDE.md §7): the status becomes `archived`, the row and its audit
	 * trail stay, and the listing's primary control reverts to "Add to Projects" because
	 * {@link findDraft} deliberately does not return archived rows.
	 *
	 * It refuses a draft that has already been funded. That is not caution — an archived project whose
	 * stage holds escrowed money is a project whose money has nowhere to go, and the recovery path for
	 * one is a support ticket rather than a button.
	 */
	static archiveDraft(
		input: ArchiveDraftInput,
		actor: { userId: string | null },
	): ServiceResult<{ draft: PipelineDraft }> {
		const current = getDraft(input.projectId, actor.userId);
		if (!current) return fail(404, { message: "That draft is no longer in your projects." });
		if (current.fundedStageCount > 0) {
			return fail(409, {
				message: "This project has funded work in it and cannot be archived from here.",
				errors: { projectId: "has_funded_stages" },
			});
		}
		const draft = archiveDraft(input.projectId, actor.userId);
		if (!draft) return fail(404, { message: "That draft is no longer in your projects." });
		return ok({ draft }, { message: "Draft archived." });
	}

	/**
	 * Archive every un-funded service draft idle for {@link DRAFT_IDLE_DAYS} days.
	 *
	 * The scheduled counterpart of {@link ProjectBackendService.archiveDraft}, and the TypeScript twin
	 * of `projects.fn_archive_stale_service_drafts`. Both call the SSOT's own `draftIsStale`, so the
	 * job and the app cannot drift into different definitions of stale.
	 *
	 * It exists on this side as well as in SQL because with `PROJECTS_BACKEND_LIVE` off there is no
	 * database to run the job — and a rule that only exists on the path nobody is exercising is a rule
	 * nobody has tested.
	 */
	static sweepStaleDrafts(now?: number): ServiceResult<{ archived: PipelineDraft[] }> {
		const archived = sweepStaleDrafts(now);
		return ok({ archived }, {
			message: archived.length === 0
				? "No stale drafts to archive."
				: `Archived ${archived.length} stale ${archived.length === 1 ? "draft" : "drafts"}.`,
		});
	}
}
