import type { JSX } from "preact";
import "../styles/profile.css";
import TabCreateButton from "../islands/TabCreateButton.island.tsx";
import { TAB_LABEL } from "../core/profile-model.ts";
import {
	ArticlesTab,
	DepartmentsTab,
	EducationTab,
	Empty,
	EntitiesTab,
	ExperienceTab,
	MembersTab,
	ProductsTab,
	ProjectsTab,
	ReviewsTab,
	ServicesTab,
} from "./tabs/mod.ts";
import type {
	ArticleItem,
	ProductItem,
	ProfileItem,
	ProfileTab,
	ProfileTabPayload,
	ProfileView,
	ServiceItem,
} from "../types/profile-types.ts";

/**
 * ProfileTabContent — the thin dispatcher for one profile tab (root CLAUDE.md Part 2). It paints the
 * shared panel header (title + the owner's "+ New …" trigger where the tab is creatable) and delegates
 * the body to the matching partial view in {@link ./tabs/mod.ts}. The tab bodies themselves live as
 * focused partial components so this file stays a routing table, not a render dump.
 */

// #region Owner create triggers
/** The "+ New …" action for a creatable tab, or null when the tab isn't owner-creatable. */
function createFor(tab: ProfileTab): { label: string; noun: string } | null {
	switch (tab) {
		case "services":
			return { label: "New service", noun: "service" };
		case "products":
			return { label: "New product", noun: "product" };
		case "projects":
			return { label: "New project", noun: "project" };
		case "portfolio":
			return { label: "Add work", noun: "portfolio piece" };
		case "articles":
			return { label: "Write article", noun: "article" };
		case "education":
			return { label: "Add education", noun: "education entry" };
		case "experience":
			return { label: "Add experience", noun: "experience entry" };
		default:
			return null;
	}
}
// #endregion

// #region Tab body dispatch
function tabBody(
	tab: ProfileTab,
	profile: ProfileView,
	payload: ProfileTabPayload,
	authed: boolean,
): JSX.Element {
	const items = payload.items;
	switch (tab) {
		case "services":
			return (
				<ServicesTab
					items={items.filter((i): i is ServiceItem => i.type === "services")}
					authed={authed}
				/>
			);
		case "products":
		case "portfolio":
			return (
				<ProductsTab
					items={items.filter((i): i is ProductItem => i.type === "products")}
					authed={authed}
				/>
			);
		case "articles":
			return (
				<ArticlesTab
					items={items.filter((i): i is ArticleItem => i.type === "articles")}
					authed={authed}
				/>
			);
		case "projects":
			return <ProjectsTab payload={payload} authed={authed} />;
		case "teams":
			return (
				<EntitiesTab
					items={items.filter((i): i is ProfileItem => i.type === "teams")}
					handle={profile.handle}
					label="Teams"
					authed={authed}
				/>
			);
		case "businesses":
			return (
				<EntitiesTab
					items={items.filter((i): i is ProfileItem => i.type === "businesses")}
					handle={profile.handle}
					label="Businesses"
					authed={authed}
				/>
			);
		case "education":
			return <EducationTab entries={payload.education} />;
		case "experience":
			return <ExperienceTab entries={payload.experience} />;
		case "members":
			return (
				<MembersTab profile={profile} members={payload.members} departments={payload.departments} />
			);
		case "departments":
			return <DepartmentsTab departments={payload.departments} />;
		case "reviews":
			return <ReviewsTab reviews={payload.reviews} summary={payload.reviewSummary} />;
		case "about":
		default:
			return <Empty />;
	}
}
// #endregion

export function ProfileTabContent(
	{ profile, tab, payload, canEdit, authed }: {
		profile: ProfileView;
		tab: ProfileTab;
		payload: ProfileTabPayload;
		canEdit: boolean;
		authed: boolean;
	},
): JSX.Element {
	const create = createFor(tab);
	return (
		<div class="pf-panel">
			<div class="pf-panel__head">
				<h2 class="pf-panel__title">{TAB_LABEL[tab]}</h2>
				{canEdit && create ? <TabCreateButton label={create.label} noun={create.noun} /> : null}
			</div>
			<div class="pf-panel__body">{tabBody(tab, profile, payload, authed)}</div>
		</div>
	);
}
