import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isProjectsBackendLive } from "../../core/supabase.ts";
import { cachedRead, cacheKey, projectsReadCache } from "../../core/cache.ts";
import { canReadLive, type ReadActor, tenantOf } from "../read-actor.ts";
import { fetchProjectBySlug, fetchProjectRows, scopesFromRows } from "./live-queries.ts";
import { fetchBoardPage } from "./live-board.ts";
import { fetchProjectDetail } from "./live-detail.ts";
import { fetchFilePage } from "./live-files.ts";
import { fetchMemberRoster as fetchLiveMemberRoster } from "./live-members.ts";
import { fetchChannelMessagePage } from "./live-messages.ts";
import { fetchSubmissionPage } from "./live-submissions.ts";
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
import type {
	BoardListParams,
	BoardPage,
	CreateProject,
	FileListPage,
	FileListParams,
	MemberRosterPage,
	MemberRosterParams,
	MessagePage,
	MessagePageParams,
	ProjectDetail,
	ProjectFeedParams,
	ProjectFeedPayload,
	ProjectSummary,
	SubmissionListPage,
	SubmissionListParams,
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
			return ok(buildFeed(withResolvableScope(params)));
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
			return ok(buildFeed(withResolvableScope(params)));
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
		const item = findProject(slug);
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
		const detail = findProjectDetail(slug);
		if (!detail) {
			return fail(404, { message: `No project found for slug "${slug}".` });
		}
		return ok({ detail });
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
		return ok({ page });
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
		return ok({ page });
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
		return ok({ page });
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
	 * Create a new engagement. STUB: validation + shaping is real, but persistence is deferred to the
	 * live path (the `fn_create_project` RPC + escrow wiring). Returns the slug the client routes to.
	 */
	static create(input: CreateProject): ServiceResult<{ slug: string }> {
		const slug = input.title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 80) || "untitled-project";
		if (!isProjectsBackendLive()) {
			return ok({ slug }, { status: 201, message: "Project drafted." });
		}
		// LIVE: insert via the RLS-scoped `projects.create_project` RPC (not yet implemented).
		return ok({ slug }, { status: 201, message: "Project drafted." });
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
