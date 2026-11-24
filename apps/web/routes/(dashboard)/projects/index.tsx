import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { resolveRequestContext } from "@web/utils/user-context.ts";
import ProjectNoticeHost from "@features/projects/islands/ProjectNoticeHost.island.tsx";
import { ProjectPortfolio } from "@features/projects/components/portfolio/ProjectPortfolio.tsx";
import { resolvePortfolio } from "@features/projects/core/portfolio-ssr.ts";
import ProposalList from "@features/proposals/islands/ProposalList.island.tsx";
import WorkloadGauge from "@features/projects/islands/WorkloadGauge.island.tsx";
import { ProjectWorkloadService } from "@server/services/projects/ProjectWorkloadService.ts";

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
 * A freelancer sees their own Σ W_i against their cap beside the title ({@link WorkloadGauge},
 * PROJECTS ST4), read here through the fat {@link ProjectWorkloadService.mine} so the server draws the
 * figures; the read takes no subject, so it can only ever answer about the signed-in caller.
 *
 * {@link ProjectNoticeHost} turns a `?notice=` flash left by a redirect into a single toast and then
 * takes the parameter back out of the address bar. It is mounted here rather than in the dashboard
 * layout because this route is the only target the flash is ever sent to.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const context = ctx.state.userContext ?? resolveRequestContext(ctx.req);
		const actor = readActor(ctx);
		const [data, workload] = await Promise.all([
			resolvePortfolio(ctx.url, context, actor),
			context.isFreelancer ? ProjectWorkloadService.mine(actor) : null,
		]);
		ctx.state.title = "Projects · Projective";
		return page({
			...data,
			isFreelancer: context.isFreelancer,
			workload: workload?.ok ? workload.data ?? null : null,
		});
	},
});

export default define.page<typeof handler>(function ProjectsPage({ data }) {
	return (
		<>
			<ProjectNoticeHost />
			<ProjectPortfolio
				items={data.items}
				filter={data.filter}
				contextLabel={data.contextLabel}
				loadError={data.loadError}
				retryHref={data.retryHref}
				headerAside={data.isFreelancer ? <WorkloadGauge initial={data.workload} /> : undefined}
			>
				<ProposalList />
			</ProjectPortfolio>
		</>
	);
});
