import type { JSX } from "preact";
import type {
	WorkspaceDetail,
	WorkspaceKind,
	WorkspaceRoster as RosterPage,
} from "@projective/types/workspace";
import type { ReadActor } from "@server/services/read-actor.ts";
import type { BusinessBillingView } from "@projective/types/finance";
import { BillingBackendService } from "@server/services/finance/BillingBackendService.ts";
import type { ModuleKey } from "./module-registry.tsx";
import { type ConsoleRedirect, routeConsole, toRosterNotice } from "./console-route.ts";
import { resolveRoster, resolveWorkspaceConsole } from "./workspace-ssr.ts";
import { ROSTER_DIR_PARAM, ROSTER_SORT_PARAM, rosterTabFromSearch } from "./roster-model.ts";
import { resolveSubView } from "./sub-views.ts";
import WorkspaceRoster from "../islands/WorkspaceRoster.island.tsx";

/**
 * workspace-route — what every `/teams*` and `/businesses*` route resolves before rendering.
 *
 * The routes stay thin (root CLAUDE.md §2) and the two kinds share ONE implementation:
 * `/teams/[teamHandle]/members` and `/businesses/[businessHandle]/members` differ by a single argument,
 * so there is no second copy to keep in step.
 *
 * **Console resolution returns DATA, not markup.** In Fresh a page component renders JSX, so a
 * `Response` returned from one is dead code — a redirect has to be issued from the route's `handler`.
 * Keeping this a data resolver means the handler can redirect and the component can render, each doing
 * the one thing it is able to do.
 *
 * Server-only — reaches `@server/services` through `workspace-ssr`; never imported by an island.
 */

/** Everything a console page needs, already corrected. Plain JSON, so it survives `page()`. */
export interface ConsoleData {
	workspace: WorkspaceDetail;
	module: ModuleKey;
	view: string | null;
	/** The Billing module's projection — read only for a business's `billing` module, else `null`. */
	billing?: BusinessBillingView | null;
}

/**
 * What a console route resolved to: `data` to render exactly what was asked for, or one of the
 * {@link ConsoleRedirect} outcomes (`canonical` 308 · `redirect` / `missing` / `unavailable` 303) the
 * handler answers with `consoleResponse` — see `console-route.ts` for when each applies.
 */
export type ConsoleOutcome = { kind: "data"; data: ConsoleData } | ConsoleRedirect;

/** The roster index body, for `/teams` and `/businesses` (and their `create` deep links). */
export async function rosterBody(
	kind: WorkspaceKind,
	url: URL,
	actor: ReadActor,
): Promise<JSX.Element> {
	const read = await resolveRoster(kind, actor, url);
	const initial: RosterPage = read.ok ? read.roster : {
		kind,
		items: [],
		invitations: [],
		actingId: null,
		canCreate: true,
		createBlockedReason: null,
	};
	// `/teams/create` and `/businesses/create` land here with the modal open, so the sitemap's deep link
	// and a shared URL both work without a second page to keep in step with the modal.
	const autoCreate = url.pathname.endsWith("/create");
	return (
		<WorkspaceRoster
			kind={kind}
			initial={initial}
			initialError={read.ok ? null : read.message}
			initialTab={rosterTabFromSearch(url.searchParams)}
			initialSearch={url.searchParams.get("q") ?? ""}
			initialSort={url.searchParams.get(ROSTER_SORT_PARAM)}
			initialDir={url.searchParams.get(ROSTER_DIR_PARAM)}
			initialNotice={toRosterNotice(url.searchParams.get("notice"))}
			autoCreate={autoCreate}
		/>
	);
}

/**
 * Resolve a console route to data, a redirect, or a miss. Called from a route `handler`; `rawModule` is
 * the `[module]` segment, or `null` from the console root's own route.
 */
export async function consoleOutcome(
	kind: WorkspaceKind,
	ref: string,
	rawModule: string | null,
	url: URL,
	actor: ReadActor,
): Promise<ConsoleOutcome> {
	const route = await routeConsole(
		kind,
		ref,
		rawModule,
		url,
		(module) => resolveWorkspaceConsole(kind, ref, module, actor, url),
	);
	if (route.kind !== "render") return route;

	const bootstrap = route.resolved;
	const { workspace } = bootstrap;

	const billing = kind === "business" && bootstrap.activeModule === "billing"
		? (await BillingBackendService.view(workspace.id, actor)).data ?? null
		: null;

	return {
		kind: "data",
		data: {
			workspace,
			module: bootstrap.activeModule,
			view: resolveSubView(
				bootstrap.activeModule,
				kind,
				workspace.viewerCapabilities,
				url.searchParams.get("view"),
			),
			billing,
		},
	};
}
