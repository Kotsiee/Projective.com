import type { ComponentChildren, JSX } from "preact";
import { ServicesGrid } from "@features/explore/components/collections/ServicesGrid.tsx";
import { ProjectsList } from "@features/explore/components/collections/ProjectsList.tsx";
import { ClientProofStrip } from "../work/ClientProofStrip.tsx";
import { WorkMasonry } from "../work/WorkMasonry.tsx";
import { WorkRoster } from "../work/WorkRoster.tsx";
import type { ProfileTabPayload, ProfileView } from "../../types/profile-types.ts";

/**
 * WorkTab — the profile's index section, as a stack of sections each omitted when its data is
 * empty: the client-proof strip · Selected work (the portfolio masonry, first because it is the
 * thing a visitor came to look at) · Services (the seller's listings, through the SAME explore grid
 * `/explore` renders) · Hiring now (a buyer's open briefs) · Completed projects · People (the
 * roster of a team / business / organisation). Every collection is
 * a server component; the sheet is `profile-work.css`, which reaches the page through the profile
 * islands' barrel import.
 */
export function WorkTab(
	{ profile, payload, authed }: {
		profile: ProfileView;
		payload: ProfileTabPayload;
		authed: boolean;
		canEdit: boolean;
	},
): JSX.Element {
	const multiMember = profile.kind === "team" || profile.kind === "business" ||
		profile.kind === "organisation";
	return (
		<div class="pf-work">
			<ClientProofStrip clients={profile.notableClients} />
			{payload.pieces.length > 0 && (
				<WorkSection title="Selected work">
					<WorkMasonry pieces={payload.pieces} />
				</WorkSection>
			)}
			{payload.services.length > 0 && (
				<WorkSection title="Services" count={payload.services.length}>
					<ServicesGrid items={payload.services} authed={authed} />
				</WorkSection>
			)}
			{payload.openProjects.length > 0 && (
				<WorkSection title="Hiring now">
					<ProjectsList items={payload.openProjects} authed={authed} />
				</WorkSection>
			)}
			{payload.pastProjects.length > 0 && (
				<WorkSection title="Completed projects">
					<ProjectsList items={payload.pastProjects} authed={authed} />
				</WorkSection>
			)}
			{multiMember && payload.members.length > 0 && (
				<WorkSection title="People">
					<WorkRoster
						members={payload.members}
						departments={payload.departments}
						kind={profile.kind}
					/>
				</WorkSection>
			)}
		</div>
	);
}

function WorkSection(
	{ title, count, children }: { title: string; count?: number; children: ComponentChildren },
): JSX.Element {
	return (
		<section class="pf-work__section">
			<h2 class="pf-h">
				{title}
				{count !== undefined && <span class="pf-h__count">{count}</span>}
			</h2>
			{children}
		</section>
	);
}
