import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { ContextType, UserContext } from "@projective/types/auth";
import { PERSONAL_MEMBER_CONTEXT } from "@projective/types/auth";
import type { AccountSetup, CurrentUser } from "@projective/types/user";
import { calculateProfileCompleteness, resolveAccountRole } from "@projective/types/user";
// The shell header CSS lives in a server component (UserShell) whose import never reaches a client
// bundle; riding it on this always-present header island injects it (same pattern as ShellSidebar).
import "@web/features/shell/styles/user-shell.css";
import { Drawer, Popover, ProgressBar, Tooltip } from "@projective/ui/feedback";
import { Avatar } from "@projective/ui/display";
import { Button } from "@projective/ui/fields";
import { cycleThemePreference, type ThemePreference, themePreference } from "@projective/ui/system";
import { type IconName, NavIcon } from "@web/features/shell/core/nav-icons.tsx";
import { createMenuOptions, profileLinks } from "@web/features/shell/core/actions-model.ts";
import { getNotifications } from "@web/features/shell/core/nav-fixtures.ts";
import {
	type ActingOrganisation,
	roleLabel as workspaceRoleLabel,
	workspaceHref,
	type WorkspaceKind,
	type WorkspaceSummary,
} from "@projective/types/workspace";
import { WorkspaceService } from "@web/features/workspaces/core/WorkspaceService.ts";
import { useContextSwitch } from "@web/features/workspaces/core/useContextSwitch.ts";
import BasketDrawer from "@web/features/checkout/islands/BasketDrawer.island.tsx";
import { basketCount } from "@web/features/checkout/core/basket-state.ts";
import { defaultOwnerParam, isCheckoutPath } from "@web/features/checkout/core/basket-model.ts";
import { AccountService } from "@web/features/shell/core/AccountService.ts";
import {
	presenceAt,
	setupStepHref,
	simulatedSetup,
} from "@web/features/shell/core/account-setup.ts";
import { useEffectiveContext } from "@web/features/shell/core/effective-context.ts";
import { AuthService } from "@web/features/auth/core/AuthService.ts";
import { onAvatarChanged } from "@web/utils/avatar-sync.ts";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import { ProfileProgressAvatar } from "@web/features/shell/components/ProfileProgressAvatar.tsx";

// #region Popover sub-views + vocabulary
/** The states the account popover's `ui-popover__content` can render. */
type AccountView = "main" | "context";

/** How an acting context's kind is named on the "Acting as" row and in the switcher. */
const CONTEXT_KIND_LABEL: Record<ContextType, string> = {
	personal: "Personal",
	team: "Team",
	business: "Business",
	organisation: "Organisation",
};

/** The theme control's glyph + spoken name per preference, and the one a press moves to. */
const THEME_CONTROL: Record<ThemePreference, { icon: IconName; label: string; next: string }> = {
	light: { icon: "sun", label: "Light", next: "Dark" },
	dark: { icon: "moon", label: "Dark", next: "System" },
	system: { icon: "monitor", label: "System", next: "Light" },
};

/** How often the presence pip re-derives from the clock — a band edge is never more than a minute late. */
const PRESENCE_TICK_MS = 60_000;
// #endregion

export interface UserActionsProps {
	/**
	 * The hydrated user context — gates the Create menu (seller-only Business/Service/Product; Team
	 * hidden in an organisation), the "Become a Freelancer" action (shown only for a client context), and
	 * seeds the profile links + the account popover's fallback identity. Chrome only; access is
	 * re-checked server-side + under RLS. Defaults to a personal member so the tray is never empty.
	 */
	context?: UserContext;
	/**
	 * Whether this shell renders a PROTECTED route (a `(dashboard)` surface). Drives the smart-logout
	 * redirect: on a protected route, signing out leaves the private area for the public landing (`/`);
	 * on a public route it reloads in place so the user simply continues as a guest. Set by the layout
	 * that owns the route group (the reliable public/protected source of truth). Defaults to public.
	 */
	protectedRoute?: boolean;
	/**
	 * Current pathname — the only thing the tray needs it for is the **Basket** control's active
	 * state across the basket ⁄ checkout flow, which is now that control's alone: the global rail no
	 * longer carries a Basket entry, so this is the surface's single wayfinding cue for it.
	 *
	 * Optional, and `undefined` reads as "no active state" rather than as a path — a caller that has
	 * not threaded it must leave the control unmarked, never mark it wrongly.
	 */
	path?: string;
}

/**
 * UserActions — the unified header's trailing action tray (DESIGN_SYSTEM.md Part D.1, "Right Block"),
 * left→right: **Create** · **Notifications** · **Basket** · **Profile**. The Profile control is the
 * person's avatar inside a **profile-completion ring** with a **presence pip**, and opens the account
 * popover, a state-driven view container with two sub-views:
 *  - **main** — top to bottom: the identity block (ringed avatar · name · `@handle` · Standing ·
 *    the derived presence line, whose tooltip is the working-hours schedule); the **Acting as** row;
 *    the **profile-setup nudge** (a progress track plus an inline checklist) while setup is under 100%;
 *    the destinations (View profile · Become a Freelancer · Availability & hours · Wallet & payouts ·
 *    Settings); and a footer with a light ⁄ dark ⁄ system theme control and Log out.
 *  - **context** — the switcher: the person themself, then their Teams, Businesses and
 *    Organisations; choosing one re-stamps the session through `useContextSwitch`.
 *
 * Presence is DERIVED from the person's published working hours and the clock (the same rule a
 * visitor's "Available now ⁄ Away" badge reads), never chosen — there is no presence service, and a
 * pip the viewer sets by hand would say something the calendar contradicts. Display currency is not
 * here: it is switched from the wallet and at checkout (Decision #149).
 *
 * Identity binds **live account data** fetched once on hydration from the thin {@link AccountService}
 * (`me` for identity, `setup` for completeness · hours · Standing), falling back to the SSR
 * {@link UserContext} until each resolves. **Responsive (Part D.3):** below `--bp-md` the avatar opens
 * a right-side account `Drawer` that shares the very same view-driven body.
 */
export default function UserActions(
	{ context = PERSONAL_MEMBER_CONTEXT, protectedRoute = false, path }: UserActionsProps,
): JSX.Element {
	const createOpen = useSignal(false);
	const profileOpen = useSignal(false);
	const notifOpen = useSignal(false);
	const basketOpen = useSignal(false);
	// Mobile-only account side-sheet (the avatar's tap target below --bp-md, replacing the desktop
	// Popover — see Part D.3 "Mobile User").
	const accountOpen = useSignal(false);
	const createBtn = useRef<HTMLButtonElement>(null);
	const profileBtn = useRef<HTMLButtonElement>(null);
	// The desktop popover's first focus: the Acting-as row, so the presence link (whose tooltip opens on
	// focus) is never focused programmatically on every open.
	const actingRef = useRef<HTMLButtonElement>(null);

	// The account popover's active sub-view, and whether the setup checklist is unfolded.
	const view = useSignal<AccountView>("main");
	const checklistOpen = useSignal(false);
	/**
	 * The viewer's real teams and businesses, read through the live roster the first time the switcher
	 * is shown — `null` until then. Read lazily because most opens of the popover never visit it, and a
	 * membership list that paid for itself on every page load would be the header's slowest part.
	 */
	const memberships = useSignal<Record<WorkspaceKind, readonly WorkspaceSummary[] | null>>({
		team: null,
		business: null,
	});
	const organisations = useSignal<readonly ActingOrganisation[] | null>(null);
	const membershipsError = useSignal<string | null>(null);
	// The acting-context switch: POST /api/context/switch → re-mint the token → hard navigation.
	const contextSwitch = useContextSwitch();

	// Reset to the main view (checklist folded) whenever both account surfaces are closed, so reopening
	// always starts on the identity screen. Reads only the open signals, so it can't loop.
	useSignalEffect(() => {
		if (!profileOpen.value && !accountOpen.value) {
			view.value = "main";
			checklistOpen.value = false;
		}
	});

	// The acting user's live account projection (name/avatar/role/workspace) and their profile setup,
	// each fetched once on hydration. `null` until it resolves — and if the read fails — so the popover
	// falls back to the context-derived placeholders and draws no ring (chrome only; a failed load is
	// never an access failure).
	const account = useSignal<CurrentUser | null>(null);
	const setup = useSignal<AccountSetup | null>(null);
	const loggingOut = useSignal(false);
	// The clock the presence pip derives from; ticks once a minute so a band edge flips the pip.
	const now = useSignal(Date.now());
	useEffect(() => {
		let alive = true;
		AccountService.current().then((user) => {
			if (alive && user) account.value = user;
		});
		AccountService.setup().then((value) => {
			if (alive && value) setup.value = value;
		});
		const tick = setInterval(() => (now.value = Date.now()), PRESENCE_TICK_MS);
		return () => {
			alive = false;
			clearInterval(tick);
		};
	}, []);

	// A profile photo changed on THIS page (the owner's editor broadcasts it): show the new face — and
	// the photo step it completes — now rather than on the next navigation.
	useEffect(() =>
		onAvatarChanged(({ userId, url }) => {
			const current = account.peek();
			if (current && current.userId === userId) account.value = { ...current, avatar: url };
			const known = setup.peek();
			if (current?.userId === userId && known) {
				setup.value = { ...known, facts: { ...known.facts, hasPhoto: !!url } };
			}
		}), []);

	// Live effective context (SSR base → DEV Context Switcher override). Every capability-gated surface
	// below — the Create menu, the Acting-as row, the Become-a-Freelancer action, the switcher's active
	// row, and the simulated profile setup — reads this, so flipping the simulated persona re-gates the
	// popover with no reload. Inert in production (the seam degrades to the base context).
	const effective = useEffectiveContext(context);
	const effCtx = effective.value.context;
	const devOverride = effective.value.overridden;
	const devSetup = effective.value.profileSetup;

	const createOptions = createMenuOptions(effCtx);
	const links = profileLinks(effCtx);
	const notifications = getNotifications();
	const hasUnread = notifications.some((n) => n.unread);

	// The REAL basket line count, read by the drawer through the thin `BasketService` and published on
	// the shared store. Drives the Basket control's state dot and its accessible name only — the figure
	// itself never renders (see the control below).
	const basketLines = basketCount.value;
	// Whose basket the drawer opens. Follows the effective context, so a simulated persona flip
	// re-scopes the drawer with the rest of the header rather than leaving it on the real session's.
	const basketOwner = defaultOwnerParam(effCtx);
	// Whether the reader is INSIDE the basket flow, which is what makes this control the current
	// destination. Answered by `isCheckoutPath` — the same guard every checkout slot resolver opens
	// with — so the control and the lane, header and footer bands the flow mounts cannot disagree
	// about where the flow begins and ends.
	const onBasketFlow = path !== undefined && isCheckoutPath(path);

	// #region Resolved account display
	// The live projection when present, else the context-derived fallback. A dev persona override wins
	// over the fetched account for the role display, so the Context Switcher visibly re-personas the
	// popover (the live fetch reflects the real, unswitched session and would otherwise mask it).
	const acct = account.value;
	const fallbackBadge = resolveAccountRole(effCtx);
	const displayName = acct?.name ?? links.displayName;
	const avatarUrl = acct?.avatar ?? undefined;
	const roleKey = devOverride ? fallbackBadge.role : (acct?.role ?? fallbackBadge.role);
	// A client context gets the "Become a Freelancer" action.
	const isClient = roleKey === "client";

	// The PERSON's handle. In an entity context `UserContext.handle` is the entity's slug, so only the
	// setup read (or a personal context) can name the person.
	const personalHandle = setup.value?.handle ??
		(effCtx.contextType === "personal" ? (acct?.handle ?? effCtx.handle) : null);

	// The setup the ring and nudge run on: the real read, or — under a Dev Context Switcher position —
	// simulated FACTS run through the same rule. A persona override also decides which checklist
	// (seller or buyer) applies, so the checklist follows the simulated persona with everything else.
	const realSetup = setup.value;
	const sellerNow = devOverride
		? effCtx.isFreelancer
		: (realSetup?.facts.seller ?? effCtx.isFreelancer);
	const activeSetup: AccountSetup | null = devSetup !== "auto"
		? simulatedSetup(devSetup, {
			handle: personalHandle ?? "you",
			seller: sellerNow,
			standing: realSetup?.standing ?? null,
		})
		: realSetup && { ...realSetup, facts: { ...realSetup.facts, seller: sellerNow } };
	const completeness = activeSetup ? calculateProfileCompleteness(activeSetup.facts) : null;
	const presence = activeSetup ? presenceAt(activeSetup.hours, now.value) : null;
	const setupHandle = activeSetup?.handle ?? personalHandle;
	const standing = sellerNow ? activeSetup?.standing ?? null : null;

	// "Acting as" — the persona in a personal context, the entity's display name otherwise. Under a
	// simulated entity persona the real session has no such entity, so only its kind is named.
	const workspace = acct?.workspace ?? null;
	const actingName = effCtx.contextType === "personal"
		? `Personal · ${roleKey === "freelancer" ? "Freelancer" : "Client"}`
		: workspace && workspace.kind === effCtx.contextType
		? `${CONTEXT_KIND_LABEL[effCtx.contextType]} · ${workspace.name}`
		: CONTEXT_KIND_LABEL[effCtx.contextType];

	// The trigger's spoken name carries what its ring and pip draw, so neither is sight-only.
	const triggerLabel = [
		"Your account",
		completeness && !completeness.complete ? `profile ${completeness.percent}% set up` : null,
		presence ? presence.label.toLowerCase() : null,
	].filter(Boolean).join(", ");

	const theme = THEME_CONTROL[themePreference.value];
	// #endregion

	/**
	 * Smart logout — revoke + clear the session, then route-aware redirect: leave a protected route for
	 * the public landing; reload a public route in place so the user continues as a guest. The fetch
	 * resolves even on a network error (the cookies are cleared server-side), so the redirect always runs.
	 */
	async function handleLogout(): Promise<void> {
		if (loggingOut.value) return;
		loggingOut.value = true;
		await AuthService.logout();
		if (protectedRoute) {
			globalThis.location.href = "/";
		} else {
			globalThis.location.reload();
		}
	}

	/**
	 * Move between sub-views and land focus on the new view's entry control — the old one unmounts with
	 * the view, and a keyboard user must not be dropped onto `<body>`. Resolved inside the surface the
	 * press came from, because the popover and the mobile sheet render the same body twice.
	 */
	function goTo(next: AccountView, event: JSX.TargetedMouseEvent<HTMLElement>): void {
		const surface = event.currentTarget.closest(".shell-account");
		view.value = next;
		const selector = next === "context" ? ".shell-subview__back" : ".shell-account__acting";
		setTimeout(() => surface?.querySelector<HTMLElement>(selector)?.focus(), 0);
	}

	/** Read the viewer's memberships of one kind, once, through the live roster route. */
	async function loadMemberships(kind: WorkspaceKind): Promise<void> {
		if (memberships.peek()[kind] !== null) return;
		const res = await WorkspaceService.roster(kind);
		if (!res.ok || !res.data) {
			membershipsError.value = res.message ??
				`Couldn't load your ${kind === "team" ? "teams" : "businesses"} just now.`;
			return;
		}
		// Archived entities are restorable from the roster, but nobody acts as one.
		const live = res.data.items.filter((item) => item.status !== "archived");
		memberships.value = { ...memberships.peek(), [kind]: live };
	}

	/** Read the organisations the viewer may act as, once. */
	async function loadOrganisations(): Promise<void> {
		if (organisations.peek() !== null) return;
		const res = await WorkspaceService.actingOrganisations();
		organisations.value = res.ok && res.data ? res.data.organisations : [];
	}

	// Load every list the first time the switcher shows.
	useSignalEffect(() => {
		if (view.value !== "context") return;
		membershipsError.value = null;
		void loadMemberships("team");
		void loadMemberships("business");
		void loadOrganisations();
	});

	/**
	 * Switch the acting context through the shared hook: the session is re-stamped server-side, the
	 * token re-minted, then a hard navigation lands on the entity's console (an organisation, which has
	 * no console of its own, lands on its profile). The popover stays open while that runs so the busy
	 * state is visible rather than a menu that simply vanished.
	 */
	function switchTo(kind: Exclude<ContextType, "personal">, id: string, handle: string): void {
		void contextSwitch.switchTo(kind, id, {
			destination: kind === "organisation" ? `/${handle}` : workspaceHref(kind, handle),
			handle,
		});
	}

	// #region Sub-view renderers
	/** The identity block — ringed avatar, name, `@handle` · Standing, and the derived presence line. */
	const identity = (onNavigate: () => void): JSX.Element => {
		const meta = [
			setupHandle ? `@${setupHandle}` : null,
			standing ? `${standing.label} standing` : null,
		].filter(Boolean).join(" · ");
		return (
			<div class="shell-account__identity">
				<ProfileProgressAvatar
					label={displayName}
					image={avatarUrl}
					size="md"
					percent={completeness?.percent ?? null}
					presence={presence?.tone ?? null}
				/>
				<div class="shell-account__ident">
					<span class="shell-account__name">{displayName}</span>
					{meta ? <span class="shell-account__meta">{meta}</span> : null}
					{presence && setupHandle
						? (
							<Tooltip content={presence.schedule} placement="bottom-start">
								<a
									class="shell-account__presence"
									data-presence={presence.tone}
									href={setupStepHref("hours", setupHandle)}
									onClick={onNavigate}
								>
									<span class="shell-account__presence-dot" aria-hidden="true" />
									<span>{presence.label}</span>
									{presence.next
										? <span class="shell-account__presence-next">· {presence.next}</span>
										: null}
								</a>
							</Tooltip>
						)
						: null}
				</div>
			</div>
		);
	};

	/** The profile-setup nudge — a progress track and an inline checklist, shown only below 100%. */
	const setupNudge = (onNavigate: () => void): JSX.Element | null => {
		if (!completeness || completeness.complete || !setupHandle) return null;
		const toGoLive = completeness.goLive.applies && !completeness.goLive.met;
		const count = toGoLive ? completeness.goLive.remaining : completeness.remaining;
		const hint = `${count} ${count === 1 ? "step" : "steps"} ${toGoLive ? "to go live" : "left"}`;
		const open = checklistOpen.value;
		return (
			<div class="shell-setup">
				<button
					type="button"
					class="shell-setup__head"
					aria-expanded={open}
					aria-controls="shell-setup-steps"
					onClick={() => (checklistOpen.value = !open)}
				>
					<span class="shell-setup__title">
						Profile setup <span class="shell-setup__pct">{completeness.percent}%</span>
					</span>
					<span class="shell-setup__hint">{hint}</span>
					<NavIcon name="chevron" class="shell-setup__chevron" />
				</button>
				<ProgressBar
					class="shell-setup__bar"
					value={completeness.percent}
					aria-label={`Profile setup, ${completeness.percent}% complete`}
				/>
				{open
					? (
						<ul class="shell-setup__steps" id="shell-setup-steps">
							{completeness.steps.map((step) => (
								<li key={step.id}>
									{step.done
										? (
											<span class="shell-setup__step" data-done="true">
												<NavIcon name="check" class="shell-setup__mark" />
												<span>{step.label}</span>
												<span class="ui-visually-hidden">(done)</span>
											</span>
										)
										: (
											<a
												class="shell-setup__step"
												href={setupStepHref(step.id, setupHandle)}
												onClick={onNavigate}
											>
												<span
													class="shell-setup__mark shell-setup__mark--todo"
													aria-hidden="true"
												/>
												<span>{step.label}</span>
												{step.goLive && completeness.goLive.applies
													? <span class="shell-setup__live">Go-live</span>
													: null}
											</a>
										)}
								</li>
							))}
						</ul>
					)
					: null}
			</div>
		);
	};

	/** The identity view — the default popover body. */
	const mainView = (
		onNavigate: () => void,
		focusRef?: { current: HTMLButtonElement | null },
	): JSX.Element => (
		<>
			{identity(onNavigate)}

			{/* Acting as — the active session context, and the way into the switcher. */}
			<button
				ref={focusRef}
				type="button"
				class="shell-account__acting"
				onClick={(e) => goTo("context", e)}
			>
				<span class="shell-account__acting-text">
					<span class="shell-account__acting-label">Acting as</span>
					<span class="shell-account__acting-name">{actingName}</span>
				</span>
				<span class="shell-account__acting-action">Switch</span>
				<NavIcon name="chevron" class="shell-account__acting-chevron" />
			</button>

			{setupNudge(onNavigate)}

			<div class="shell-menu__sep" role="separator" />

			<a class="shell-menu__item" href={links.viewProfile} onClick={onNavigate}>
				<span class="shell-menu__icon">
					<NavIcon name="user" />
				</span>
				<span class="shell-menu__label">View profile</span>
			</a>
			{isClient
				? (
					<a
						class="shell-menu__item shell-menu__item--accent"
						href="/become-partner"
						onClick={onNavigate}
					>
						<span class="shell-menu__icon">
							<NavIcon name="services" />
						</span>
						<span class="shell-menu__label">Become a Freelancer</span>
					</a>
				)
				: null}
			{setupHandle
				? (
					<a
						class="shell-menu__item"
						href={setupStepHref("hours", setupHandle)}
						onClick={onNavigate}
					>
						<span class="shell-menu__icon">
							<NavIcon name="clock" />
						</span>
						<span class="shell-menu__label">Availability &amp; hours</span>
					</a>
				)
				: null}
			<a class="shell-menu__item" href="/wallet" onClick={onNavigate}>
				<span class="shell-menu__icon">
					<NavIcon name="wallet" />
				</span>
				<span class="shell-menu__label">Wallet &amp; payouts</span>
			</a>
			<a class="shell-menu__item" href={links.settings} onClick={onNavigate}>
				<span class="shell-menu__icon">
					<NavIcon name="settings" />
				</span>
				<span class="shell-menu__label">Settings</span>
			</a>

			<div class="shell-menu__sep" role="separator" />

			{/* Footer rig — the theme preference (light → dark → system) and Log out. */}
			<div class="shell-account__foot">
				<Button
					variant="text"
					severity="secondary"
					size="sm"
					iconOnly
					class="shell-account__theme"
					icon={<NavIcon name={theme.icon} />}
					aria-label={`Theme: ${theme.label}. Switch to ${theme.next}`}
					title={`Theme: ${theme.label}`}
					onClick={() => cycleThemePreference()}
				/>
				<Button
					variant="text"
					severity="danger"
					size="sm"
					class="shell-account__logout"
					icon={<NavIcon name="logout" />}
					label={loggingOut.value ? "Signing out…" : "Log out"}
					disabled={loggingOut.value}
					onClick={() => {
						onNavigate();
						void handleLogout();
					}}
				/>
			</div>
		</>
	);

	/** One switchable row in the context switcher. */
	const contextRow = (
		key: string,
		mark: JSX.Element,
		name: string,
		detail: string,
		active: boolean,
		onPick: () => void,
	): JSX.Element => (
		<li key={key} role="none">
			<button
				type="button"
				class="shell-ctx__item"
				data-active={active ? "true" : undefined}
				aria-current={active ? "true" : undefined}
				disabled={active || contextSwitch.switching.value}
				onClick={onPick}
			>
				{mark}
				<span class="shell-ctx__body">
					<span class="shell-ctx__name">{name}</span>
					<span class="shell-ctx__detail">{detail}</span>
				</span>
				{active ? <NavIcon name="check" class="shell-ctx__check" /> : null}
			</button>
		</li>
	);

	/** A titled section of the switcher (Teams · Businesses · Organisations). */
	const contextSection = (
		title: string,
		manage: { href: string; label: string } | null,
		onNavigate: () => void,
		body: JSX.Element | JSX.Element[],
	): JSX.Element => (
		<section class="shell-ctx__section" aria-label={title}>
			<div class="shell-ctx__section-head">
				<span class="shell-ctx__section-title">{title}</span>
				{manage
					? (
						<a class="shell-ctx__manage" href={manage.href} onClick={onNavigate}>
							{manage.label}
						</a>
					)
					: null}
			</div>
			<ul class="shell-ctx__list">{body}</ul>
		</section>
	);

	/** A team or business list, with its loading / empty / error states. */
	const workspaceRows = (kind: WorkspaceKind): JSX.Element | JSX.Element[] => {
		const list = memberships.value[kind];
		const noun = kind === "team" ? "teams" : "businesses";
		if (list === null) {
			return (
				<li class="shell-ctx__empty" role="status">
					{membershipsError.value ?? `Loading your ${noun}…`}
				</li>
			);
		}
		if (list.length === 0) return <li class="shell-ctx__empty">No {noun} yet.</li>;
		return list.map((m) =>
			contextRow(
				m.id,
				<Avatar label={m.name} image={m.avatar || undefined} size="sm" shape="square" />,
				m.name,
				`${workspaceRoleLabel(m.role)} · ${
					m.memberCount === 1 ? "1 member" : `${m.memberCount} members`
				}`,
				effCtx.contextType === kind && effCtx.contextId === m.id,
				() => switchTo(kind, m.id, m.handle),
			)
		);
	};

	/** The in-popover context switcher view. */
	const contextView = (onNavigate: () => void): JSX.Element => {
		const switching = contextSwitch.switching.value;
		const orgs = organisations.value;
		// Teams are the freelancer side of the platform (PRODUCT_SPEC §Freelancer-Only Space), gated
		// exactly as the sidebar gates its Teams entry.
		const showTeams = effCtx.isFreelancer || effCtx.contextType === "team";
		const canCreateTeam = showTeams && effCtx.contextType !== "organisation";
		const canCreateBusiness = effCtx.isFreelancer;

		return (
			<div class="shell-subview">
				<div class="shell-subview__head">
					<button
						type="button"
						class="shell-subview__back"
						aria-label="Back"
						onClick={(e) => goTo("main", e)}
					>
						<NavIcon name="arrowLeft" />
					</button>
					<span class="shell-subview__title">Switch context</span>
				</div>

				<div class="shell-ctx" aria-busy={switching ? "true" : undefined}>
					<ul class="shell-ctx__list">
						{contextRow(
							"personal",
							<UserAvatar label={displayName} image={avatarUrl} size="sm" />,
							displayName,
							`Personal · ${effCtx.isFreelancer ? "Freelancer" : "Client"}`,
							effCtx.contextType === "personal",
							() => void contextSwitch.exitToPersonal(),
						)}
					</ul>

					{showTeams
						? contextSection(
							"Teams",
							{ href: "/teams", label: "Manage" },
							onNavigate,
							workspaceRows("team"),
						)
						: null}
					{contextSection(
						"Businesses",
						{ href: "/businesses", label: "Manage" },
						onNavigate,
						workspaceRows("business"),
					)}
					{
						/* Organisations appear only when the viewer has one — most people never will, and an
						   empty "Organisations" heading would advertise a kind of account they cannot open. */
					}
					{orgs && orgs.length > 0
						? contextSection(
							"Organisations",
							null,
							onNavigate,
							orgs.map((o) =>
								contextRow(
									o.id,
									<Avatar label={o.name} size="sm" shape="square" />,
									o.name,
									o.owner ? "Owner" : "Member",
									effCtx.contextType === "organisation" && effCtx.contextId === o.id,
									() => switchTo("organisation", o.id, o.handle),
								)
							),
						)
						: null}
				</div>

				{(switching || contextSwitch.error.value) && (
					<p class="shell-account__note" role="status" aria-live="polite">
						{switching ? "Switching…" : contextSwitch.error.value}
					</p>
				)}

				{canCreateTeam || canCreateBusiness
					? (
						<>
							<div class="shell-menu__sep" role="separator" />
							{canCreateTeam
								? (
									<a class="shell-menu__item" href="/teams/create" onClick={onNavigate}>
										<span class="shell-menu__icon">
											<NavIcon name="create" />
										</span>
										<span class="shell-menu__label">Create a team</span>
									</a>
								)
								: null}
							{canCreateBusiness
								? (
									<a
										class="shell-menu__item"
										href="/businesses/create"
										onClick={onNavigate}
									>
										<span class="shell-menu__icon">
											<NavIcon name="create" />
										</span>
										<span class="shell-menu__label">Create a business</span>
									</a>
								)
								: null}
						</>
					)
					: null}
			</div>
		);
	};

	/** The view-driven account body — shared by the desktop Popover and the mobile side-sheet Drawer. */
	const accountBody = (
		onNavigate: () => void,
		focusRef?: { current: HTMLButtonElement | null },
	): JSX.Element =>
		view.value === "context" ? contextView(onNavigate) : mainView(onNavigate, focusRef);
	// #endregion

	return (
		<div class="shell-util">
			{/* Create — context-aware quick-create menu (desktop; Create is a bottom-nav primary on mobile) */}
			<button
				ref={createBtn}
				type="button"
				class="shell-util__btn shell-util__slot--desktop"
				aria-label="Create"
			>
				<NavIcon name="create" />
			</button>
			<Popover open={createOpen} targetRef={createBtn} placement="bottom-end" class="shell-pop">
				<ul class="shell-menu" role="menu" aria-label="Create">
					{createOptions.map((opt) => (
						<li key={opt.key} role="none">
							<a
								role="menuitem"
								class="shell-menu__item"
								href={opt.href}
								onClick={() => (createOpen.value = false)}
							>
								<span class="shell-menu__icon">
									<NavIcon name={opt.icon} />
								</span>
								<span class="shell-menu__label">{opt.label}</span>
							</a>
						</li>
					))}
				</ul>
			</Popover>

			{/* Messages — mobile-only header action (a top-level destination in the mobile shell) */}
			<a
				class="shell-util__btn shell-util__slot--mobile"
				href="/messages"
				aria-label="Messages — new updates"
			>
				<NavIcon name="messages" />
				<span class="shell-util__dot" aria-hidden="true" />
			</a>

			{/* Notifications — right-side blurring drawer (both breakpoints) */}
			<button
				type="button"
				class="shell-util__btn"
				aria-label={hasUnread ? "Notifications — new updates" : "Notifications"}
				aria-haspopup="dialog"
				onClick={() => (notifOpen.value = true)}
			>
				<NavIcon name="notifications" />
				{hasUnread ? <span class="shell-util__dot" aria-hidden="true" /> : null}
			</button>

			{
				/*
			  Basket — right-side blurring drawer (desktop; not a mobile header action).

			  **A pulsing dot, never a count.** DESIGN_SYSTEM Part D.1 is explicit for this exact control
			  ("Notifications and Basket … unseen state shows as a pulsing dot, never a count"), and the
			  same section's Update-indicators rule folds the state a sighted reader loses into the
			  `aria-label`. So the tally is announced and never printed — which is also the honest choice
			  for a figure this control cannot keep live between reads.
			*/
			}
			<button
				type="button"
				class={`shell-util__btn shell-util__slot--desktop${
					onBasketFlow ? " shell-util__btn--active" : ""
				}`}
				aria-label={basketLines > 0
					? `Basket — ${basketLines} ${basketLines === 1 ? "item" : "items"}`
					: "Basket"}
				aria-current={onBasketFlow ? "page" : undefined}
				aria-haspopup="dialog"
				onClick={() => (basketOpen.value = true)}
			>
				<NavIcon name="basket" />
				{basketLines > 0 ? <span class="shell-util__dot" aria-hidden="true" /> : null}
			</button>

			{/* Profile (desktop) — the ringed avatar opening the account Popover */}
			<button
				ref={profileBtn}
				type="button"
				class="shell-util__profile shell-util__slot--desktop"
				aria-label={triggerLabel}
			>
				<ProfileProgressAvatar
					label={displayName}
					image={avatarUrl}
					size="sm"
					percent={completeness?.percent ?? null}
					presence={presence?.tone ?? null}
				/>
			</button>
			<Popover
				open={profileOpen}
				targetRef={profileBtn}
				placement="bottom-end"
				label="Account"
				initialFocusRef={actingRef}
				class="shell-pop shell-pop--account"
			>
				<div class="shell-account">
					{accountBody(() => (profileOpen.value = false), actingRef)}
				</div>
			</Popover>

			{/* Profile (mobile) — the avatar toggles the account side-sheet instead of the Popover */}
			<button
				type="button"
				class="shell-util__profile shell-util__slot--mobile"
				aria-label={triggerLabel}
				aria-haspopup="dialog"
				onClick={() => (accountOpen.value = true)}
			>
				<ProfileProgressAvatar
					label={displayName}
					image={avatarUrl}
					size="sm"
					percent={completeness?.percent ?? null}
					presence={presence?.tone ?? null}
				/>
			</button>
			<Drawer
				visible={accountOpen}
				position="right"
				header="Account"
				class="shell-drawer shell-drawer--account"
				size="min(20rem, 88vw)"
			>
				<div class="shell-account shell-account--sheet">
					{accountBody(() => (accountOpen.value = false))}
				</div>
			</Drawer>

			<Drawer
				visible={notifOpen}
				position="right"
				header="Notifications"
				class="shell-drawer"
				size="min(25rem, 92vw)"
			>
				<ul class="shell-feed">
					{notifications.map((n) => (
						<li key={n.id} class={`shell-feed__item${n.unread ? " shell-feed__item--unread" : ""}`}>
							<span class="shell-feed__lead">
								<UserAvatar image={n.avatar} alt={n.actor ?? ""} label={n.actor ?? ""} size="sm" />
							</span>
							<span class="shell-feed__body">
								<span class="shell-feed__title">{n.title}</span>
								<span class="shell-feed__text">{n.body}</span>
								<span class="shell-feed__time">{n.time} ago</span>
							</span>
							{n.unread ? <span class="shell-feed__dot" aria-hidden="true" /> : null}
						</li>
					))}
				</ul>
				<a class="shell-drawer__all" href="/notifications">View all notifications</a>
			</Drawer>

			{
				/*
			  The real basket, through the thin `BasketService`. It replaces the `nav-fixtures` list that
			  used to sit inline here and drew three hard-coded rows with hard-coded prices that belonged
			  to nothing anyone could pay for. Mounted unconditionally (not behind `basketOpen`) because
			  it is what reads the count the control above indicates, and because its stylesheet reaches
			  the page only through this island's client bundle.
			*/
			}
			<BasketDrawer open={basketOpen} owner={basketOwner} />
		</div>
	);
}
