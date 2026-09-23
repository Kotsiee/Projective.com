import type { ComponentChildren } from "preact";
import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { GuestShell } from "@web/features/shell/components/GuestShell.tsx";
import { UserShell } from "@web/features/shell/components/UserShell.tsx";
import TicketDeepLinkHost from "@web/features/projects/islands/TicketDeepLinkHost.island.tsx";
import ChatPopoutHost from "@web/features/messaging/islands/ChatPopoutHost.island.tsx";
import ProfileHero from "@features/profile/islands/ProfileHero.island.tsx";
import ProfileStickyHeader from "@features/profile/islands/ProfileStickyHeader.island.tsx";
import ProfileTabs from "@features/profile/islands/ProfileTabs.island.tsx";
import ProfileStyleAnchor from "@features/profile/islands/ProfileStyleAnchor.island.tsx";
import { ProfileContextBar } from "@features/profile/components/ProfileContextBar.tsx";
import { ProfileServicesSection } from "@features/profile/components/ProfileServicesSection.tsx";
import { ProfileProductsSection } from "@features/profile/components/ProfileProductsSection.tsx";
import { ProfileCalendarHead } from "@features/profile/components/ProfileCalendarHead.tsx";
import { OwnerNav, type OwnerNavTab } from "@features/profile/components/OwnerNav.tsx";
import {
	viewLaneFor,
	viewLaneOptionsFor,
	viewOwnsLaneSlot,
} from "@features/view/core/view-lane-slot.tsx";
import { viewHeaderFor } from "@features/view/core/view-header-slot.tsx";
import { publicFooterFor } from "@features/marketing/core/footer-slot.tsx";
import { readActor } from "@web/utils/api-session.ts";
import { toDisplayCurrency } from "@projective/types/finance";
import {
	resolveConsultationOffer,
	resolveHireProjects,
	resolveProfileProducts,
	resolveProfileServices,
} from "@features/profile/core/profile-ssr.ts";
import {
	activeTabOf,
	defaultTabFor,
	estimatedSpendFor,
	isSellerKind,
	TABS_ANCHOR,
} from "@features/profile/core/profile-model.ts";

/**
 * Profile shell (`/[handle]` wildcard namespace) — one layout for every profile entity (individual,
 * team, business, organisation) resolved by `@handle`.
 *
 * The surface is ONE column in the native window scroll (root CLAUDE.md §8 Decision #96): the split
 * hero → the context bar → a seller's Services row → the four-section tab bar → the routed section
 * body. There is no middle-nav lane and no splitter — the profile mounts nothing in the shell's lane
 * slot — but it DOES register a migrated sticky header (Decision #111): the {@link ProfileStickyHeader}
 * is threaded into the shell's header slot (the authenticated frame's `ui-middle-nav__header` band,
 * the guest shell's floating sub-header — the same two homes the entity view's band has) and
 * reveals as the hero's action rig scrolls away, carrying the identity, the live availability and
 * the same rig. The section tab bar is the page's own sticky element, pinning a small gap beneath
 * that band and floating as a glass pill while stuck.
 *
 * The services are resolved HERE, once, because they render on every section (above the tabs) and
 * feed two other regions: the hero's Hire popover (which lists them) and the hero's metrics strip
 * (the spend floor). A buyer entity resolves to an empty list and none of the three render anything
 * for it. The seller's call offer is resolved here for the same popover's consultation row, and
 * the VIEWER's open projects for the Add-to-project popover: the first byte must already carry
 * every row a control can open (§3 gate 11) — so they are server reads, not island fetches.
 *
 * Two routes under the namespace keep their own chrome: the profile-scoped item viewer
 * (`/[handle]/view/[id]`, which resolves ITS lane from the URL like the public `/view/[id]`) and the
 * full-page availability calendar (`/[handle]/availability`, which fills the content region and gets
 * only a one-line identity strip with a way back).
 *
 * # The owner's three views
 *
 * When the DATABASE says the viewer owns the profile (`profile.viewer.isOwner`, read under their own
 * session — never the unverified chrome token), an {@link OwnerNav} sits above the page with three
 * tabs: **Preview** (the public page, rendered exactly as a visitor sees it — the rig explains
 * itself rather than acting), **Edit profile & settings** (`/[handle]/edit`) and **Availability**
 * (`/[handle]/edit/availability`). The two edit routes render only the owner nav and their own body;
 * their pages refuse anyone who is not the owner.
 */
export default define.page(async function ProfileLayout(ctx) {
	const profile = ctx.state.profile;
	const path = ctx.url.pathname;
	const authed = !!ctx.state.isAuthenticated;
	const context = ctx.state.userContext;
	const handleParam = ctx.params.handle ?? path.split("/").filter(Boolean)[0] ?? "";

	/**
	 * Wrap body content in the auth-appropriate shell. `lane` is only ever set by the item viewer
	 * branch; `header` by the item viewer AND the profile itself (its migrated sticky header).
	 *
	 * `footer` renders the marketing footer at the body's end — off for the full-page calendars, which
	 * fill the content region and own their own scrolling. The authed branch composes it with the
	 * URL-keyed `publicFooterFor` resolver (the same one the sibling `(public)` layout uses), NARROWING
	 * only — the flag can withhold a footer the resolver agreed to, never add one it refused.
	 */
	const shell = (
		children: ComponentChildren,
		options: { lane?: ComponentChildren; header?: ComponentChildren; footer?: boolean } = {},
	): ComponentChildren => {
		const footer = options.footer ?? true;
		if (authed) {
			return (
				<UserShell
					path={path}
					context={asAuthenticatedContext(context)}
					lane={options.lane}
					laneOptions={options.lane ? viewLaneOptionsFor(ctx.url) : undefined}
					middleNavHeader={options.header}
					bodyFooter={footer ? publicFooterFor(ctx.url) : null}
				>
					{/* The `?tkv=` ticket deep link — same host as the dashboard, same rules. */}
					<TicketDeepLinkHost authed />
					{
						/* The global floating chat window. The hero's Message control opens a conversation
					    into it on desktop, and it survives every navigation because each authenticated
					    layout mounts this same host. */
					}
					<ChatPopoutHost path={path} />
					{children}
				</UserShell>
			);
		}
		return (
			<GuestShell
				lane={options.lane}
				header={options.header}
				footer={footer}
				returnTo={ctx.url.pathname + ctx.url.search}
			>
				{/* A guest only ever loses the parameter; the host opens nothing for them. */}
				<TicketDeepLinkHost authed={false} />
				{children}
			</GuestShell>
		);
	};

	// Reserved route word / unresolved or hidden handle → a calm not-found (no profile chrome). A
	// profile that could not be READ is a different fact and says so.
	if (!profile) {
		const down = ctx.state.profileStatus === 503;
		return shell(
			<div class="pf pf-notfound">
				{/* No profile island mounts on this branch, so the sheet needs its own carrier. */}
				<ProfileStyleAnchor />
				<h1 class="pf-notfound__title">{down ? "Profile unavailable" : "Profile not found"}</h1>
				<p class="pf-notfound__note">
					{down
						? "Profiles can't be loaded right now. Try again in a moment."
						: `“/${handleParam}” isn’t a profile on Projective.`}
				</p>
				<a class="pf-notfound__link" href="/explore">Explore Projective</a>
			</div>,
		);
	}

	/** The database's answer, under the viewer's own session — never the chrome token. */
	const owner = profile.viewer?.isOwner === true;
	const segments = path.split("/").filter(Boolean);

	// The profile-scoped Entity View page renders its own layout: mount the item's own action lane
	// (pricing/CTAs/trust) — resolved from the URL like the public `/view/[id]` — and no profile chrome.
	if (segments[1] === "view") {
		// The session-schedule leaf (/[handle]/view/[id]/schedule) is a full-page calendar surface —
		// no lane/footer; the schedule island fills the region itself.
		if (segments[3] === "schedule") {
			return shell(<ctx.Component />, { footer: false });
		}
		/*
		 * `viewLaneFor` owns the slot for any id that RESOLVES, and for a commerce archetype it returns a
		 * collapsed back rail on the authenticated shell and `null` on the guest one — that listing's
		 * conversion rail is the view page's own end column, so the shell must never mount a second
		 * panel beside it. An id that resolves to nothing gets no lane at all now (the profile no
		 * longer has one to fall back to).
		 */
		const lane = viewOwnsLaneSlot(ctx.url)
			? viewLaneFor(ctx.url, authed, ctx.state.userContext)
			: undefined;
		// The Projects view mirrors its own scroll-migrated sticky header in the middle-nav band (null
		// for articles / the generic view — no band).
		const header = viewHeaderFor(ctx.url, authed, ctx.state.userContext);
		return shell(<ctx.Component />, { lane: lane ?? undefined, header });
	}

	// The owner's edit surfaces: the owner nav and the page's own body, no profile chrome. The pages
	// themselves refuse a non-owner (a redirect from their handler), so this branch never paints an
	// editor around somebody else's profile.
	if (segments[1] === "edit") {
		const tab: OwnerNavTab = segments[2] === "availability" ? "availability" : "edit";
		return shell(
			<div class="pf-scope pf-scope--edit">
				{/* The owner nav is server-rendered; the sheet it needs rides this anchor even when the
				    page below it (a refusal note) mounts no island. */}
				<ProfileStyleAnchor />
				{owner && <OwnerNav handle={profile.handle} active={tab} />}
				<ctx.Component />
			</div>,
		);
	}

	// The Availability calendar fills the content region; it gets a one-line identity strip so the
	// page still says whose calendar it is and carries a way back to the profile.
	if (segments[1] === "availability") {
		return shell(
			<div class="pf-scope pf-scope--calendar">
				{/* The calendar and its identity strip are server-rendered here, so the profile sheet
				    needs a carrier of its own on this branch (the island-carrier rule, Decision #39). */}
				<ProfileStyleAnchor />
				<ProfileCalendarHead profile={profile} />
				<ctx.Component />
			</div>,
			{ footer: false },
		);
	}

	// The active section highlighted in the tab bar — the URL segment, or Work on the bare index.
	const active = activeTabOf(path) ?? defaultTabFor(profile.kind);
	// The listings render on every section, so they are resolved here, together.
	const [services, products] = await Promise.all([
		resolveProfileServices(profile.handle),
		resolveProfileProducts(profile.handle),
	]);
	const seller = isSellerKind(profile.kind);
	const actor = readActor(ctx);
	// A seller's call offer feeds the Hire popover's consultation row (and the owner's preview shows
	// the row their visitors see); a buyer entity takes none.
	const consultation = seller ? await resolveConsultationOffer(profile, actor) : null;
	// Only a signed-in VISITOR of a seller can add them to a project, so only that viewer pays for
	// the read.
	const hireProjects = authed && !owner && seller
		? await resolveHireProjects(actor, profile.handle)
		: [];
	// The migrated sticky header — resolved HERE, from the same reads the hero takes, so the band's
	// rig and the hero's rig are hydrated from one answer and cannot offer different controls.
	const stickyHeader = (
		<ProfileStickyHeader
			profile={profile}
			preview={owner}
			authed={authed}
			services={services}
			consultation={consultation}
			hireProjects={hireProjects}
		/>
	);
	return shell(
		<div class="pf-scope">
			{owner && <OwnerNav handle={profile.handle} active="preview" />}
			<div class="pf">
				<ProfileHero
					profile={profile}
					services={services}
					consultation={consultation}
					spend={estimatedSpendFor(services)}
					preview={owner}
					authed={authed}
					hireProjects={hireProjects}
					defaultCurrency={toDisplayCurrency(context?.displayCurrency)}
					scopeId={context?.contextId ?? ""}
				/>
				<ProfileContextBar profile={profile} />
				<ProfileServicesSection services={services} authed={authed} />
				<ProfileProductsSection products={products} authed={authed} />
				<section id={TABS_ANCHOR} class="pf-sections" aria-label="Profile sections">
					<ProfileTabs profile={profile} active={active} />
					{
						/* `.ex` establishes the explore-card `--ex-*` token context for the reused
					    collections (neutralised to a bare token-carrier in profile-work.css). */
					}
					<div class="ex pf-tabpanel">
						<ctx.Component />
					</div>
				</section>
			</div>
		</div>,
		{ header: stickyHeader },
	);
});
