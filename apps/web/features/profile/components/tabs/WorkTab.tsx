import type { ComponentChildren, JSX } from "preact";
import { ProjectsList } from "@features/explore/components/collections/ProjectsList.tsx";
import { ClientProofStrip } from "../work/ClientProofStrip.tsx";
import { WorkMasonry } from "../work/WorkMasonry.tsx";
import { WorkRoster } from "../work/WorkRoster.tsx";
import OwnerPortfolio from "../../islands/OwnerPortfolio.island.tsx";
import type { OwnerEdit } from "../../core/owner-edit.ts";
import type { ProfileTabPayload, ProfileView } from "../../types/profile-types.ts";

/**
 * WorkTab — the profile's index section, as a stack of sections each omitted when its data is
 * empty: the client-proof strip · Selected work (the portfolio masonry, first because it is the
 * thing a visitor came to look at) · Hiring now (a buyer's open briefs) · Completed projects ·
 * People (the roster of a team / business / enterprise). On a business the completed projects are
 * its client proof and come before Hiring now (Decision #244). The seller's Services are NOT here: the
 * layout renders them as their own region above the section tabs (`ProfileServicesSection`), so
 * they stay on screen whichever section is routed. Every collection is a server component; the
 * sheet is `profile-work.css`, which reaches the page through the profile islands' barrel import.
 * For a freelancer's owner, Selected work is the {@link OwnerPortfolio} island, drawn even when empty
 * so its Add stands where the work will (Decision #439).
 */
export function WorkTab(
	{ profile, payload, authed, portfolio = null }: {
		profile: ProfileView;
		payload: ProfileTabPayload;
		authed: boolean;
		/** The owner's rights when they may edit the portfolio here; `null` for a visitor. */
		portfolio?: OwnerEdit | null;
	},
): JSX.Element {
	const multiMember = profile.kind === "team" || profile.kind === "business" ||
		profile.kind === "enterprise";
	// A business's completed projects ARE its client proof (BP1, Decision #244): the work it
	// commissioned and saw through leads, ahead of what it is hiring for now.
	const proofFirst = profile.kind === "business";
	const hiring = payload.openProjects.length > 0 && (
		<WorkSection title="Hiring now">
			<ProjectsList items={payload.openProjects} authed={authed} />
		</WorkSection>
	);
	const completed = payload.pastProjects.length > 0 && (
		<WorkSection title="Completed projects">
			<ProjectsList items={payload.pastProjects} authed={authed} />
		</WorkSection>
	);
	return (
		<div class="pf-work">
			<ClientProofStrip clients={profile.notableClients} />
			{portfolio
				? <OwnerPortfolio pieces={payload.pieces} edit={portfolio} />
				: payload.pieces.length > 0 && (
					<WorkSection title="Selected work">
						<WorkMasonry pieces={payload.pieces} />
					</WorkSection>
				)}
			{proofFirst ? completed : hiring}
			{proofFirst ? hiring : completed}
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
	{ title, children }: { title: string; children: ComponentChildren },
): JSX.Element {
	return (
		<section class="pf-work__section">
			<h2 class="pf-h">{title}</h2>
			{children}
		</section>
	);
}
