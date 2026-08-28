import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isProjectsBackendLive } from "../../core/supabase.ts";
import {
	findProject,
	getFeed,
	groupFeed,
	incomingCount,
	scopeOptions,
	serviceOptions,
	withResolvableScope,
} from "./query.ts";
import { findProjectDetail } from "./detail-fixtures.ts";
import { findMessagePage } from "./messages-fixtures.ts";
import { findFilePage } from "./files-fixtures.ts";
import { findSubmissionPage } from "./submissions-fixtures.ts";
import { findBoardPage } from "./board-fixtures.ts";
import { findMemberRoster } from "./members-fixtures.ts";
import {
	archiveDraft,
	getDraft,
	instantiateDraft,
	sweepStaleDrafts,
} from "./draft-store.ts";
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

export class ProjectBackendService {
	/**
	 * The context-scoped `/projects` feed: matched engagement rows, context groups, and the scope +
	 * service option matrices for the filter panel.
	 */
	static list(params: ProjectFeedParams): ServiceResult<ProjectFeedPayload> {
		if (!isProjectsBackendLive()) {
			// Stub mode: drop a phantom scope pin (a real auth contextId matches no fixture workspace)
			// so the lane shows the acting account's feed instead of stranding empty. See
			// {@link withResolvableScope}. This covers BOTH the SSR first paint and the thin
			// `/api/projects/list` refetch (a stale cached scopeId), the single chokepoint they share.
			return ok(buildFeed(withResolvableScope(params)));
		}
		// LIVE: query the RLS-scoped projects.* + org.* membership tables (not yet implemented) — fall
		// back to the fixture-backed query so behaviour is preserved until that path lands.
		return ok(buildFeed(params));
	}

	/** Look up a single engagement by slug — backs deep-link prefetch / row focus. */
	static item(slug: string): ServiceResult<{ item: ProjectSummary }> {
		const item = findProject(slug);
		if (!item) return fail(404, { message: `No project found for slug "${slug}".` });
		return ok({ item });
	}

	/**
	 * The deep single-engagement projection behind the Project Details sidebar
	 * (`/projects/[projectId]`): the contextual header, core view links data, member roster, and the
	 * four-group communication channel tree. SSR calls this directly for first paint; the sidebar
	 * island refines via the thin route.
	 */
	static detail(slug: string): ServiceResult<{ detail: ProjectDetail }> {
		if (!isProjectsBackendLive()) {
			const detail = findProjectDetail(slug);
			if (!detail) return fail(404, { message: `No project found for slug "${slug}".` });
			return ok({ detail });
		}
		// LIVE: read the RLS-scoped projects.* + projects.channels + assigned org.team_members graph
		// (not yet implemented) — fall back to the fixture-backed projection so behaviour is preserved.
		const detail = findProjectDetail(slug);
		if (!detail) return fail(404, { message: `No project found for slug "${slug}".` });
		return ok({ detail });
	}

	/**
	 * A page of a channel's conversation (`/projects/[projectId]/[channelId]/chat`): the message feed
	 * behind the bottom-anchored, virtualized chat view. Bottom-anchored history — `before` unset yields
	 * the latest page, a `before` cursor yields the strictly-older page (the scroll-up load). Also carries
	 * the sticky pinned set + the viewer's pin capability. SSR calls this directly for first paint; the
	 * feed island refines / paginates via the thin `MessagesService`.
	 */
	static messages(params: MessagePageParams): ServiceResult<{ page: MessagePage }> {
		if (!isProjectsBackendLive()) {
			const page = findMessagePage(params);
			if (!page) return fail(404, { message: "No such project channel." });
			return ok({ page });
		}
		// LIVE: read the RLS-scoped `messages.*` thread unified by `chatId` (not yet implemented) — fall
		// back to the fixture-backed page so behaviour is preserved until that path lands.
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
	 */
	static files(params: FileListParams): ServiceResult<{ page: FileListPage }> {
		if (!isProjectsBackendLive()) {
			const page = findFilePage(params);
			if (!page) return fail(404, { message: `No project found for id "${params.projectId}".` });
			return ok({ page });
		}
		// LIVE: read the RLS-scoped `files.*` / `messages.*` attachments (not yet implemented) — fall
		// back to the fixture-backed page so behaviour is preserved until that path lands.
		const page = findFilePage(params);
		if (!page) return fail(404, { message: `No project found for id "${params.projectId}".` });
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
	 */
	static submissions(params: SubmissionListParams): ServiceResult<{ page: SubmissionListPage }> {
		if (!isProjectsBackendLive()) {
			const page = findSubmissionPage(params);
			if (!page) return fail(404, { message: `No project found for id "${params.projectId}".` });
			return ok({ page });
		}
		// LIVE: read the RLS-scoped `submissions.*` / `files.*` graph (not yet implemented) — fall back
		// to the fixture-backed page so behaviour is preserved until that path lands.
		const page = findSubmissionPage(params);
		if (!page) return fail(404, { message: `No project found for id "${params.projectId}".` });
		return ok({ page });
	}

	/**
	 * The Kanban board — the project-level pipeline (`/projects/[projectId]/board`, columns = New + the
	 * Stages + Completed) or a stage-level Tasks board (`/projects/[projectId]/[channelId]/tasks`, columns
	 * = the ticket-status lanes). Returns the columns, the ticket cards (already filtered), the stage list
	 * (for the ticket modal + Stages/Status toggle), and the viewer capability flags that gate client-only
	 * moves + creation. SSR calls this directly for first paint; the board island refines (search/filter/
	 * view) via the thin `BoardService`.
	 */
	static board(params: BoardListParams): ServiceResult<{ page: BoardPage }> {
		if (!isProjectsBackendLive()) {
			const page = findBoardPage(params);
			if (!page) return fail(404, { message: `No project found for id "${params.projectId}".` });
			return ok({ page });
		}
		// LIVE: read the RLS-scoped `projects.tickets` / `project_stages` graph and drive moves through the
		// `projects.move_ticket` / `reorder_stages` RPCs (not yet implemented) — fall back to the fixture-
		// backed page so behaviour is preserved until that path lands.
		const page = findBoardPage(params);
		if (!page) return fail(404, { message: `No project found for id "${params.projectId}".` });
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
	 */
	static members(params: MemberRosterParams): ServiceResult<{ page: MemberRosterPage }> {
		if (!isProjectsBackendLive()) {
			const page = findMemberRoster(params);
			if (!page) return fail(404, { message: `No project found for id "${params.projectId}".` });
			return ok({ page });
		}
		// LIVE: read the RLS-scoped `projects.project_participants` + `org.*_members` + `projects.invitations`
		// graph (not yet implemented) — fall back to the fixture-backed roster so behaviour is preserved.
		const page = findMemberRoster(params);
		if (!page) return fail(404, { message: `No project found for id "${params.projectId}".` });
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
