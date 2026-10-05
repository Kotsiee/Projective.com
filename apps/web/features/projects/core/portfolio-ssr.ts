import type { UserContext } from "@projective/types/auth";
import type { ProjectSummary } from "@projective/types/projects";
import type { ReadActor } from "@server/services/read-actor.ts";
import { resolveProjectsFeed } from "./feed-ssr.ts";
import { parsePortfolioFilter, PORTFOLIO_PARAM, type PortfolioFilter } from "./portfolio-model.ts";

/**
 * portfolio-ssr — the SERVER-ONLY bootstrap for the `/projects` portfolio index.
 *
 * The rows come from the SAME read the lane beside the page paints from — `resolveProjectsFeed`, i.e.
 * `ProjectBackendService.list` — but with a query of the index's own: `scope=global` and nothing else.
 *
 *   - GLOBAL, because a portfolio is everything the reader is involved in. The lane defaults to the
 *     active workspace (the Implicit User Context rule), which is right for a navigator and wrong for
 *     an overview: a client whose briefs are posted under their business would open "Projects" and see
 *     their personal drafts only. Each row names its workspace instead.
 *   - NOTHING ELSE, because the lane's own search and facets (`?q=`, `?statuses=`, …) narrow the lane
 *     and must not quietly narrow the index beside it.
 *
 * The service caches the tenant's rows, so this is not a second database read.
 *
 * Never imported by an island (it reaches `@server/services` through `feed-ssr`).
 */

/** Everything the portfolio page renders, resolved for the first byte. */
export interface PortfolioBootstrap {
	/** Every project in every workspace the reader belongs to, newest activity first. */
	items: ProjectSummary[];
	/** The status filter the URL asked for. */
	filter: PortfolioFilter;
	/** Which workspaces the list spans — the one workspace's name, or "N workspaces". */
	contextLabel: string;
}

/** Resolve the portfolio for a request. */
export async function resolvePortfolio(
	url: URL,
	context: UserContext,
	actor: ReadActor,
	displayCurrency?: string | null,
): Promise<PortfolioBootstrap> {
	const feed = await resolveProjectsFeed(
		new URL("/projects?scope=global", url),
		context,
		actor,
		displayCurrency,
	);
	const items = feed.payload.items.filter((it) => it.kind === "project");
	const workspaces = new Set(items.map((it) => it.scopeId));
	return {
		items,
		filter: parsePortfolioFilter(url.searchParams.get(PORTFOLIO_PARAM)),
		contextLabel: workspaces.size === 1 ? items[0].scopeLabel : `${workspaces.size} workspaces`,
	};
}
