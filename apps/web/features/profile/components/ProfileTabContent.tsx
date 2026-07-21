import type { JSX } from "preact";
import { Avatar, RatingStars } from "@projective/ui/display";
import "../styles/profile.css";
import { ServicesGrid } from "@features/explore/components/collections/ServicesGrid.tsx";
import { ProductsMasonry } from "@features/explore/components/collections/ProductsMasonry.tsx";
import { ProjectsList } from "@features/explore/components/collections/ProjectsList.tsx";
import { ArticlesGridList } from "@features/explore/components/collections/ArticlesGridList.tsx";
import { profileHref } from "@features/explore/core/routing.ts";
import ProfileEntityGrid from "../islands/ProfileEntityGrid.island.tsx";
import TabCreateButton from "../islands/TabCreateButton.island.tsx";
import { TAB_LABEL } from "../core/profile-model.ts";
import type {
	ArticleItem,
	EducationEntry,
	ExperienceEntry,
	MemberEntry,
	ProductItem,
	ProfileItem,
	ProfileTab,
	ProfileTabPayload,
	ProfileView,
	ReviewEntry,
	ServiceItem,
} from "../types/profile-types.ts";

/**
 * ProfileTabContent — renders one profile tab's body inside the left column of the split view (root
 * CLAUDE.md Part 2). Item grids REUSE the explore collections (Services grid · Products/Portfolio
 * masonry · Projects list w/ Open+Past sub-views · Articles list) and the toggleable Teams/Businesses
 * {@link ProfileEntityGrid}; Education/Experience/Members/Reviews render as structured lists. The panel
 * header carries the owner's direct "+ New …" trigger where the tab is creatable (Part 3.3).
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

// #region Structured lists
function formatDate(iso: string): string {
	try {
		return new Intl.DateTimeFormat("en-GB", {
			timeZone: "UTC",
			year: "numeric",
			month: "short",
			day: "numeric",
		}).format(new Date(iso));
	} catch {
		return iso;
	}
}

function EducationList({ entries }: { entries: EducationEntry[] }): JSX.Element {
	if (!entries.length) return <p class="pf-empty">No education listed yet.</p>;
	return (
		<ul class="pf-timeline" role="list">
			{entries.map((e) => (
				<li class="pf-tl" key={e.id}>
					<Avatar image={e.logo} label={e.school} size="md" shape="square" class="pf-tl__logo" />
					<div class="pf-tl__body">
						<span class="pf-tl__title">{e.credential} · {e.field}</span>
						<span class="pf-tl__org">{e.school}</span>
						<span class="pf-tl__dates">{e.start} – {e.end ?? "Present"}</span>
					</div>
				</li>
			))}
		</ul>
	);
}

function ExperienceList({ entries }: { entries: ExperienceEntry[] }): JSX.Element {
	if (!entries.length) return <p class="pf-empty">No experience listed yet.</p>;
	return (
		<ul class="pf-timeline" role="list">
			{entries.map((e) => (
				<li class="pf-tl" key={e.id}>
					<Avatar image={e.logo} label={e.org} size="md" shape="square" class="pf-tl__logo" />
					<div class="pf-tl__body">
						<span class="pf-tl__title">{e.role}</span>
						<span class="pf-tl__org">{e.org}</span>
						<span class="pf-tl__dates">{e.start} – {e.current ? "Present" : e.end ?? "Present"}</span>
						<p class="pf-tl__summary">{e.summary}</p>
					</div>
				</li>
			))}
		</ul>
	);
}

function MembersGrid({ members }: { members: MemberEntry[] }): JSX.Element {
	if (!members.length) return <p class="pf-empty">No members listed yet.</p>;
	return (
		<ul class="pf-members" role="list">
			{members.map((m) => (
				<li class="pf-member" key={m.handle}>
					<a class="pf-member__link" href={profileHref(m.handle)}>
						<Avatar image={m.avatar} label={m.name} size="xl" shape="circle" />
						<span class="pf-member__name">{m.name}</span>
						<span class="pf-member__role">{m.role}</span>
					</a>
				</li>
			))}
		</ul>
	);
}

function ReviewsList(
	{ reviews, summary }: { reviews: ReviewEntry[]; summary?: ProfileTabPayload["reviewSummary"] },
): JSX.Element {
	return (
		<div class="pf-reviews">
			{summary && (summary.asHelper || summary.asClient)
				? (
					<div class="pf-reviews__summary">
						{summary.asHelper && (
							<div class="pf-rep__track">
								<span class="pf-rep__role">As a freelancer</span>
								<RatingStars
									value={summary.asHelper.value}
									count={summary.asHelper.count}
									size="md"
								/>
							</div>
						)}
						{summary.asClient && (
							<div class="pf-rep__track">
								<span class="pf-rep__role">As a client</span>
								<RatingStars
									value={summary.asClient.value}
									count={summary.asClient.count}
									size="md"
								/>
							</div>
						)}
					</div>
				)
				: null}
			{reviews.length
				? (
					<ul class="pf-review-list" role="list">
						{reviews.map((r) => (
							<li class="pf-review" key={r.id}>
								<Avatar image={r.authorAvatar} label={r.authorName} size="md" shape="circle" />
								<div class="pf-review__body">
									<div class="pf-review__head">
										<a class="pf-review__author" href={profileHref(r.authorHandle)}>
											{r.authorName}
										</a>
										<span class="pf-review__role" data-role={r.role}>
											{r.role === "client" ? "As a client" : "As a freelancer"}
										</span>
									</div>
									<div class="pf-review__meta">
										<RatingStars value={r.rating} size="sm" label={`Rated ${r.rating} out of 5`} />
										<time class="pf-review__date">{formatDate(r.date)}</time>
									</div>
									<p class="pf-review__text">{r.body}</p>
									{r.contextTitle
										? <span class="pf-review__context">on {r.contextTitle}</span>
										: null}
								</div>
							</li>
						))}
					</ul>
				)
				: <p class="pf-empty">No reviews yet.</p>}
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
		case "services": {
			const rows = items.filter((i): i is ServiceItem => i.type === "services");
			return rows.length ? <ServicesGrid items={rows} authed={authed} /> : <Empty />;
		}
		case "products": {
			const rows = items.filter((i): i is ProductItem => i.type === "products");
			return rows.length ? <ProductsMasonry items={rows} authed={authed} /> : <Empty />;
		}
		case "portfolio": {
			const rows = items.filter((i): i is ProductItem => i.type === "products");
			return rows.length ? <ProductsMasonry items={rows} authed={authed} /> : <Empty />;
		}
		case "articles": {
			const rows = items.filter((i): i is ArticleItem => i.type === "articles");
			return rows.length ? <ArticlesGridList items={rows} authed={authed} /> : <Empty />;
		}
		case "projects": {
			return (
				<div class="pf-projects">
					<section class="pf-projects__group" aria-label="Open projects">
						<h3 class="pf-projects__sub">Open &amp; available</h3>
						{payload.openProjects.length
							? <ProjectsList items={payload.openProjects} authed={authed} />
							: <Empty note="No open projects." />}
					</section>
					<section class="pf-projects__group" aria-label="Past projects">
						<h3 class="pf-projects__sub">Past &amp; completed</h3>
						{payload.pastProjects.length
							? <ProjectsList items={payload.pastProjects} authed={authed} />
							: <Empty note="No completed projects yet." />}
					</section>
				</div>
			);
		}
		case "teams": {
			const rows = items.filter((i): i is ProfileItem => i.type === "teams");
			return <ProfileEntityGrid items={rows} handle={profile.handle} label="Teams" authed={authed} />;
		}
		case "businesses": {
			const rows = items.filter((i): i is ProfileItem => i.type === "businesses");
			return (
				<ProfileEntityGrid items={rows} handle={profile.handle} label="Businesses" authed={authed} />
			);
		}
		case "education":
			return <EducationList entries={payload.education} />;
		case "experience":
			return <ExperienceList entries={payload.experience} />;
		case "members":
			return <MembersGrid members={payload.members} />;
		case "reviews":
			return <ReviewsList reviews={payload.reviews} summary={payload.reviewSummary} />;
		case "about":
		default:
			return <Empty />;
	}
}

function Empty({ note }: { note?: string }): JSX.Element {
	return <p class="pf-empty">{note ?? "Nothing here yet."}</p>;
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
