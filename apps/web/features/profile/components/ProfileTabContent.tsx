import type { JSX } from "preact";
import OwnerExperience from "../islands/OwnerExperience.island.tsx";
import { type ReviewStance, TAB_LABEL } from "../core/profile-model.ts";
import { canEditBlock } from "../core/owner-edit.ts";
import type { OwnerContext } from "../core/owner-ssr.ts";
import { tabIcon } from "./profile-glyphs.tsx";
import { ExperienceTab, PostsTab, ReviewsTab, WorkTab } from "./tabs/mod.ts";
import type {
	ProfileKind,
	ProfileTab,
	ProfileTabPayload,
	ProfileView,
} from "../types/profile-types.ts";

/**
 * ProfileTabContent — the thin dispatcher for one profile section (root CLAUDE.md §8 Decision #96).
 * It decides emptiness once and renders either the teaching empty state or the section body from
 * {@link ./tabs/mod.ts}.
 *
 * There is no visible panel title: the tab strip directly above already names the section in its
 * active state. The heading survives visually-hidden so the panel keeps its landmark name.
 *
 * For the owner (Decision #439) the sections they fill are never "empty": the Experience section is
 * the {@link OwnerExperience} island and Work carries the owner's portfolio, each with its own Add
 * and a stub where a visitor would see nothing.
 */
export interface ProfileTabContentProps {
	profile: ProfileView;
	tab: ProfileTab;
	payload: ProfileTabPayload;
	authed: boolean;
	/** Reviews only — the stance the URL asked for (`?as=`), so SSR paints the filtered list. */
	reviewStance?: ReviewStance;
	/** The owner's rights and stored model; `null` for a visitor. */
	owner?: OwnerContext | null;
}

// #region Empty state
/**
 * How many rows the section actually holds. Work counts every collection the body can render — the
 * client-proof strip alone does not make a Work section, so it is deliberately left out, and so are
 * the services, which the layout now renders as their own region above the tabs.
 */
function countFor(tab: ProfileTab, payload: ProfileTabPayload): number {
	switch (tab) {
		case "work":
			return payload.openProjects.length +
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
	work: "Completed projects and selected work — what this profile has shipped.",
	experience: "Roles held, qualifications earned, and the certifications behind them.",
	reviews: "Reviews arrive once an engagement completes — on both sides of it.",
	posts: "Written pieces — process notes, case studies, guides.",
};

/**
 * A business's own sentences where the generic one would mislead (Decision #244): it ships nothing
 * itself — it commissions — and it is reviewed from one side only.
 */
const BUSINESS_EMPTY_NOTE: Partial<Record<ProfileTab, string>> = {
	work: "Projects it commissioned and the people behind it.",
	reviews: "Freelancers review a business once an engagement completes.",
};

/**
 * A team's own sentence for its Reviews (Teams P1): it is reviewed as a whole, by its clients, and
 * its members' personal reviews live on their own pages.
 */
const TEAM_EMPTY_NOTE: Partial<Record<ProfileTab, string>> = {
	reviews: "Clients review the team as a whole once an engagement completes.",
};

/** The empty state's sentence for a section on a profile of `kind`. */
function emptyNoteFor(tab: ProfileTab, kind: ProfileKind): string {
	const own = kind === "business"
		? BUSINESS_EMPTY_NOTE[tab]
		: kind === "team"
		? TEAM_EMPTY_NOTE[tab]
		: undefined;
	return own ?? EMPTY_NOTE[tab];
}

function EmptySection({ tab, kind }: { tab: ProfileTab; kind: ProfileKind }): JSX.Element {
	return (
		<div class="pf-empty">
			<span class="pf-empty__mark" aria-hidden="true">{tabIcon(tab)}</span>
			<span class="pf-empty__title">No {TAB_LABEL[tab].toLowerCase()} yet</span>
			<p class="pf-empty__note">{emptyNoteFor(tab, kind)}</p>
		</div>
	);
}
// #endregion

// #region Body dispatch
function sectionBody(
	{ profile, tab, payload, authed, reviewStance, owner }: ProfileTabContentProps,
): JSX.Element {
	switch (tab) {
		case "work":
			return (
				<WorkTab
					profile={profile}
					payload={payload}
					authed={authed}
					portfolio={owner && canEditBlock(owner.edit, "work") ? owner.edit : null}
				/>
			);
		case "experience":
			return owner && canEditBlock(owner.edit, "experience")
				? (
					<OwnerExperience
						profile={profile}
						model={owner.model}
						payload={payload}
						edit={owner.edit}
					/>
				)
				: <ExperienceTab payload={payload} />;
		case "reviews":
			return <ReviewsTab payload={payload} stance={reviewStance} kind={profile.kind} />;
		case "posts":
			return <PostsTab payload={payload} authed={authed} />;
	}
}
// #endregion

/** Whether the owner fills this section on the page, so it is never drawn as empty for them. */
function ownerFills(tab: ProfileTab, owner: ProfileTabContentProps["owner"]): boolean {
	if (!owner) return false;
	if (tab === "experience") return canEditBlock(owner.edit, "experience");
	if (tab === "work") return canEditBlock(owner.edit, "work");
	return false;
}

export function ProfileTabContent(props: ProfileTabContentProps): JSX.Element {
	const { tab, payload, profile } = props;
	const empty = countFor(tab, payload) === 0 && !ownerFills(tab, props.owner);
	return (
		<div class="pf-panel">
			<h2 class="ui-visually-hidden">{TAB_LABEL[tab]}</h2>
			<div class="pf-panel__body">
				{empty ? <EmptySection tab={tab} kind={profile.kind} /> : sectionBody(props)}
			</div>
		</div>
	);
}
