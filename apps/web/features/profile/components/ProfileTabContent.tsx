import type { JSX } from "preact";
import TabCreateButton from "../islands/TabCreateButton.island.tsx";
import { TAB_LABEL } from "../core/profile-model.ts";
import { tabIcon } from "./profile-glyphs.tsx";
import { ExperienceTab, PostsTab, ReviewsTab, WorkTab } from "./tabs/mod.ts";
import type { ProfileTab, ProfileTabPayload, ProfileView } from "../types/profile-types.ts";

/**
 * ProfileTabContent — the thin dispatcher for one profile section (root CLAUDE.md §8 Decision #96).
 * It decides emptiness once, renders either the teaching empty state or the section body from
 * {@link ./tabs/mod.ts}, and carries the owner's "+ …" trigger where the section is creatable.
 *
 * There is no visible panel title: the tab strip directly above already names the section in its
 * active state. The heading survives visually-hidden so the panel keeps its landmark name.
 */
export interface ProfileTabContentProps {
	profile: ProfileView;
	tab: ProfileTab;
	payload: ProfileTabPayload;
	canEdit: boolean;
	authed: boolean;
}

// #region Owner create triggers
/** The owner's create action for a section, or `null` when the section is not owner-creatable. */
function createFor(tab: ProfileTab): { label: string; noun: string } | null {
	switch (tab) {
		case "work":
			return { label: "Add work", noun: "portfolio piece" };
		case "experience":
			return { label: "Add experience", noun: "experience entry" };
		case "posts":
			return { label: "Write post", noun: "post" };
		case "reviews":
			return null;
	}
}
// #endregion

// #region Empty state
/**
 * How many rows the section actually holds. Work counts every collection the body can render — the
 * client-proof strip alone does not make a Work section, so it is deliberately left out.
 */
function countFor(tab: ProfileTab, payload: ProfileTabPayload): number {
	switch (tab) {
		case "work":
			return payload.services.length +
				payload.openProjects.length +
				payload.pastProjects.length +
				payload.pieces.length +
				payload.members.length;
		case "experience":
			return payload.experience.length +
				payload.education.length +
				payload.certifications.length;
		case "reviews":
			return payload.reviews.length;
		case "posts":
			return payload.articles.length;
	}
}

/** What the section is FOR, in the visitor's terms — the one sentence the empty state teaches. */
const EMPTY_NOTE: Record<ProfileTab, string> = {
	work: "Services, completed projects and selected work — what this profile can be hired for.",
	experience: "Roles held, qualifications earned, and the certifications behind them.",
	reviews: "Reviews arrive once an engagement completes — on both sides of it.",
	posts: "Written pieces — process notes, case studies, guides.",
};

function EmptySection(
	{ tab, action }: { tab: ProfileTab; action: JSX.Element | null },
): JSX.Element {
	return (
		<div class="pf-empty">
			<span class="pf-empty__mark" aria-hidden="true">{tabIcon(tab)}</span>
			<span class="pf-empty__title">No {TAB_LABEL[tab].toLowerCase()} yet</span>
			<p class="pf-empty__note">{EMPTY_NOTE[tab]}</p>
			{action ? <div class="pf-empty__action">{action}</div> : null}
		</div>
	);
}
// #endregion

// #region Body dispatch
function sectionBody(
	{ profile, tab, payload, canEdit, authed }: ProfileTabContentProps,
): JSX.Element {
	switch (tab) {
		case "work":
			return <WorkTab profile={profile} payload={payload} authed={authed} canEdit={canEdit} />;
		case "experience":
			return <ExperienceTab payload={payload} />;
		case "reviews":
			return <ReviewsTab payload={payload} />;
		case "posts":
			return <PostsTab payload={payload} authed={authed} />;
	}
}
// #endregion

export function ProfileTabContent(props: ProfileTabContentProps): JSX.Element {
	const { tab, payload, canEdit } = props;
	const create = createFor(tab);
	const createButton = canEdit && create
		? <TabCreateButton label={create.label} noun={create.noun} />
		: null;
	const empty = countFor(tab, payload) === 0;
	return (
		<div class="pf-panel">
			<h2 class="ui-visually-hidden">{TAB_LABEL[tab]}</h2>
			{createButton && !empty ? <div class="pf-panel__head">{createButton}</div> : null}
			<div class="pf-panel__body">
				{empty ? <EmptySection tab={tab} action={createButton} /> : sectionBody(props)}
			</div>
		</div>
	);
}
