import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import type { ReadActor } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";
import { once, resolveWorkspaceDetail } from "@features/workspaces/core/workspace-memo.ts";
import { readCookies } from "@web/utils/auth-cookies.ts";
import { CookieKeys } from "@web/utils/storage-keys.ts";
import CatalogueLane, { type LaneTeam } from "../islands/CatalogueLane.island.tsx";
import { type CatalogueBootstrap, resolveCataloguePage } from "./catalogue-ssr.ts";
import { listParamsOf } from "./console-store.ts";
import {
	type LaneListingsRead,
	laneReadOf,
	parseLaneMemory,
	teamSection,
	visibleTeams,
} from "./lane-model.ts";
import { teamSellerActor } from "./seller-scope.ts";
import { type ConsoleUrlState, parseConsoleUrl } from "../types/catalogue-types.ts";

/**
 * catalogue-lane-slot — the middle-nav lane on `/catalogue` and `/catalogue/[id]` (one layout, see
 * `CatalogueLane`). On `/catalogue` the filter is the address and Your listings shares the page's
 * memoised read; on `/catalogue/[id]` the filter is the lane memory cookie, so the lane paints as it
 * was left. The team sections are the teams whose Catalogue the viewer may open (the team console's
 * gate), less the one the session is acting as; the open ones are read here, as the team, so they
 * paint in the first byte. Returns `null` off `/catalogue`. Server-only.
 *
 * A lane whose read failed still renders — it is the way to the other listings and to New listing,
 * and the canvas beside it already says the catalogue could not be reached.
 */

interface SellableTeam {
	team: LaneTeam;
	actor: ReadActor;
}

function readOf(bootstrap: CatalogueBootstrap): LaneListingsRead {
	return bootstrap.error ? { ok: false, message: bootstrap.error } : laneReadOf(bootstrap.page);
}

async function sellableTeams(url: URL, actor: ReadActor): Promise<SellableTeam[]> {
	const roster = await once(
		url,
		actor,
		"catalogue-lane:teams",
		() => WorkspaceBackendService.roster("team", actor),
	);
	if (!roster.ok || !roster.data) return [];
	const actingId = roster.data.actingId;
	const candidates = roster.data.items.filter((t) => t.status !== "archived" && t.id !== actingId);
	const details = await Promise.all(
		candidates.map((t) => resolveWorkspaceDetail("team", t.handle, actor, url)),
	);
	return details.flatMap((detail) => {
		const teamActor = detail ? teamSellerActor(detail, actor) : null;
		return detail && teamActor
			? [{ team: { handle: detail.handle, name: detail.name }, actor: teamActor }]
			: [];
	});
}

/** The lane for a `/catalogue*` request, or `null` off the catalogue. */
export async function catalogueLaneFor(
	url: URL,
	context: UserContext,
	actor: ReadActor,
	req: Request,
): Promise<ComponentChildren> {
	const segs = url.pathname.split("/").filter(Boolean);
	if (segs[0] !== "catalogue") return null;

	const onConsole = segs.length < 2;
	const memory = parseLaneMemory(readCookies(req)[CookieKeys.CATALOGUE_LANE]);
	const filter: ConsoleUrlState = onConsole ? parseConsoleUrl(url) : memory.filter;
	const params = listParamsOf(filter);

	const [own, teams] = await Promise.all([
		resolveCataloguePage(context, url, actor, params),
		sellableTeams(url, actor),
	]);

	const handles = teams.map((t) => t.team.handle);
	const selectedTeams = memory.teams.filter((h) => handles.includes(h));
	const openTeams = visibleTeams(teams.map((t) => ({ ...t, handle: t.team.handle })), selectedTeams)
		.filter((t) => memory.open.includes(teamSection(t.handle)));
	const teamReads = Object.fromEntries(
		await Promise.all(
			openTeams.map(async (t) =>
				[t.handle, readOf(await resolveCataloguePage(context, url, t.actor, params))] as const
			),
		),
	);

	return (
		<CatalogueLane
			mode={onConsole ? "console" : "outline"}
			filter={filter}
			own={readOf(own)}
			activeId={onConsole ? null : segs[1]}
			teams={teams.map((t) => t.team)}
			teamReads={teamReads}
			selectedTeams={selectedTeams}
			open={memory.open}
		/>
	);
}
