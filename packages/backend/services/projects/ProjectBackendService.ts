import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isProjectsBackendLive } from "../../core/supabase.ts";
import {
	findProject,
	getFeed,
	groupFeed,
	incomingCount,
	scopeOptions,
	serviceOptions,
} from "./query.ts";
import { findProjectDetail } from "./detail-fixtures.ts";
import { findMessagePage } from "./messages-fixtures.ts";
import type {
	CreateProject,
	MessagePage,
	MessagePageParams,
	ProjectDetail,
	ProjectFeedParams,
	ProjectFeedPayload,
	ProjectSummary,
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
			return ok(buildFeed(params));
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
}
