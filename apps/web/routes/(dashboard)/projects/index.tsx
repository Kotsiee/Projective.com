import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { resolveRequestContext } from "@web/utils/user-context.ts";
import ProjectNoticeHost from "@features/projects/islands/ProjectNoticeHost.island.tsx";
import { ProjectPortfolio } from "@features/projects/components/portfolio/ProjectPortfolio.tsx";
import { resolvePortfolio } from "@features/projects/core/portfolio-ssr.ts";
import ProposalList from "@features/proposals/islands/ProposalList.island.tsx";

/**
 * `/projects` — the portfolio index, and the place every bounced engagement URL lands.
 *
 * Thin route: the handler resolves the active workspace's projects through `resolvePortfolio` (the
 * same `ProjectBackendService.list` read the lane beside it paints from) and the status filter from
 * `?status=`; {@link ProjectPortfolio} renders the aggregate stage burn, the filter and the list. An
 * empty workspace gets one action — Create a project — which opens the Quick-Init modal the lane hosts.
 *
 * Below the list, {@link ProposalList} — the proposals the viewer has sent, each pending one with
 * **Withdraw proposal** (Decision #154). An island: it reads `GET /api/projects/applications/mine` and
 * shares the allowance store with the header popover, so a withdrawal moves both without a reload.
 *
 * {@link ProjectNoticeHost} turns a `?notice=` flash left by a redirect into a single toast and then
 * takes the parameter back out of the address bar. It is mounted here rather than in the dashboard
 * layout because this route is the only target the flash is ever sent to.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const data = await resolvePortfolio(
			ctx.url,
			ctx.state.userContext ?? resolveRequestContext(ctx.req),
			readActor(ctx),
			ctx.state.currency?.displayCurrency,
		);
		ctx.state.title = "Projects · Projective";
		return page(data);
	},
});

export default define.page<typeof handler>(function ProjectsPage({ data }) {
	return (
		<>
			<ProjectNoticeHost />
			<ProjectPortfolio items={data.items} filter={data.filter} contextLabel={data.contextLabel}>
				<ProposalList />
			</ProjectPortfolio>
		</>
	);
});
