import type { JSX } from "preact";
import "../styles/profile.css";
import TabCreateButton from "../islands/TabCreateButton.island.tsx";
import AmbientPalette from "@features/explore/islands/AmbientPalette.island.tsx";
import { TAB_LABEL } from "../core/profile-model.ts";
import { tabIcon } from "./profile-glyphs.tsx";
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
 * ProfileTabContent — the thin dispatcher for one profile tab (root CLAUDE.md Part 2). It resolves the
 * tab's row count, renders either the teaching empty state or the matching partial view from
 * {@link ./tabs/mod.ts}, and carries the owner's "+ New …" trigger where the tab is creatable. The tab
 * bodies live as focused partial components so this file stays a routing table, not a render dump.
 *
 * There is no visible panel title: the tab strip directly above already names the section in its active
 * state, so an `<h2>` restating it put the page's largest type on a word the eye had just read and
 * pushed the work down a row. The heading survives visually-hidden, so the panel keeps its landmark name.
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

// #region Empty state
/**
 * How many rows this tab actually has. Mirrors the filters {@link tabBody} applies, so the dispatcher
 * can decide emptiness once rather than leaving each partial to render a bare grey sentence.
 */
function countFor(tab: ProfileTab, payload: ProfileTabPayload): number {
	const of = (type: string) => payload.items.filter((i) => i.type === type).length;
	switch (tab) {
		case "services":
			return of("services");
		case "products":
		case "portfolio":
			return of("products");
		case "articles":
			return of("articles");
		// Projects is the one tab whose body does NOT read `payload.items` — it splits into the Open and
		// Past sub-views, which live on their own payload fields.
		case "projects":
			return payload.openProjects.length + payload.pastProjects.length;
		case "teams":
			return of("teams");
		case "businesses":
			return of("businesses");
		case "education":
			return payload.education.length;
		case "experience":
			return payload.experience.length;
		case "members":
			return payload.members.length;
		case "departments":
			return payload.departments.length;
		case "reviews":
			return payload.reviews.length;
		default:
			return 0;
	}
}

/**
 * What this section is FOR, in the visitor's terms. An empty section is the cheapest place on a profile
 * to teach the next action, and it used to say "Nothing here yet." in the smallest grey type available.
 */
const EMPTY_NOTE: Partial<Record<ProfileTab, string>> = {
	services:
		"Packaged offers a client can hire directly — a pipeline, a one-off, or a booked session.",
	products: "Finished, ready-to-buy work — templates, assets, kits.",
	portfolio: "Selected work that shows what this profile can do.",
	projects: "Open and past engagements, with the stages they ran through.",
	articles: "Written pieces — process notes, case studies, guides.",
	education: "Qualifications and training.",
	experience: "Roles held, and what was delivered in them.",
	teams: "Teams this profile builds with.",
	businesses: "Businesses this profile works through.",
	members: "The people who make up this entity.",
	departments: "How this organisation is structured.",
	reviews: "Reviews arrive once an engagement completes — on both sides of it.",
};

/** The teaching empty state: what the section holds, plus the owner's way to fill it. */
function EmptySection(
	{ tab, action }: { tab: ProfileTab; action: JSX.Element | null },
): JSX.Element {
	return (
		<div class="pf-empty">
			<span class="pf-empty__mark" aria-hidden="true">{tabIcon(tab)}</span>
			<span class="pf-empty__title">No {TAB_LABEL[tab].toLowerCase()} yet</span>
			<p class="pf-empty__note">{EMPTY_NOTE[tab] ?? "Nothing here yet."}</p>
			{action ? <div class="pf-empty__action">{action}</div> : null}
		</div>
	);
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
	const createButton = canEdit && create
		? <TabCreateButton label={create.label} noun={create.noun} />
		: null;
	const empty = countFor(tab, payload) === 0;
	return (
		<div class="pf-panel">
			{
				/* Extracts each discovery card's dominant media colour into `--ex-ambient` for the hover
			    wash. Renders nothing; the cards paint a token-derived fallback without it. */
			}
			<AmbientPalette />
			{
				/* The tab strip 24px above already names this section, in its active state — an `<h2>`
			    repeating it put the largest type on the page on a word the eye had just read, and pushed
			    the work down another row. Kept for assistive tech so the panel retains its name. */
			}
			<h2 class="ui-visually-hidden">{TAB_LABEL[tab]}</h2>
			{createButton && !empty ? <div class="pf-panel__head">{createButton}</div> : null}
			<div class="pf-panel__body">
				{empty
					? <EmptySection tab={tab} action={createButton} />
					: tabBody(tab, profile, payload, authed)}
			</div>
		</div>
	);
}
