import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { UserContext } from "@projective/types/auth";
import { PERSONAL_MEMBER_CONTEXT } from "@projective/types/auth";
import type { CurrentUser } from "@projective/types/user";
import { resolveAccountRole } from "@projective/types/user";
// The shell header CSS lives in a server component (UserShell) whose import never reaches a client
// bundle; riding it on this always-present header island injects it (same pattern as ShellSidebar).
import "@web/features/shell/styles/user-shell.css";
import { Drawer, Popover } from "@projective/ui/feedback";
import { Avatar } from "@projective/ui/display";
import { dsConfig, toggleMode } from "@projective/ui/system";
import { NavIcon } from "@web/features/shell/core/nav-icons.tsx";
import { createMenuOptions, profileLinks } from "@web/features/shell/core/actions-model.ts";
import {
	getBasketItems,
	getBusinessMemberships,
	getNotifications,
	getTeamMemberships,
	type MembershipEntry,
} from "@web/features/shell/core/nav-fixtures.ts";
import { AccountService } from "@web/features/shell/core/AccountService.ts";
import { useEffectiveContext } from "@web/features/shell/core/effective-context.ts";
import { AuthService } from "@web/features/auth/core/AuthService.ts";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";

// #region Popover sub-views + presence model
/** The three states the account popover's `ui-popover__content` can render (task §2). */
type AccountView = "main" | "status" | "context";

/** A presence status the user can select from the status picker (task §2B). */
type StatusKey = "online" | "away" | "dnd" | "invisible";

interface StatusOption {
	key: StatusKey;
	label: string;
	/** Short qualifier under the label. */
	desc: string;
}

/** The presence options, in menu order. The leading dot tone is driven by CSS off `data-status`. */
const STATUS_OPTIONS: readonly StatusOption[] = [
	{ key: "online", label: "Online", desc: "Available to everyone" },
	{ key: "away", label: "Away", desc: "Idle — replies may be slow" },
	{ key: "dnd", label: "Do Not Disturb", desc: "Notifications muted" },
	{ key: "invisible", label: "Invisible", desc: "Appear offline" },
];

/** Narrow a stored string to a known {@link StatusKey}, defaulting to `online`. */
function toStatus(raw: string | null): StatusKey {
	return raw === "away" || raw === "dnd" || raw === "invisible" || raw === "online"
		? raw
		: "online";
}
// #endregion

export interface UserActionsProps {
	/**
	 * The hydrated user context — gates the Create menu (seller-only Business/Service/Product; Team
	 * hidden in an organisation), the "Become a Freelancer" CTA (shown only for a client context), and
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
}

/**
 * UserActions — the unified header's trailing action tray (DESIGN_SYSTEM.md Part D.1, "Right Block"),
 * left→right: **Create** · **Notifications** · **Basket** · **Profile**. The Profile control opens a
 * **state-driven account popover** (task §2) that switches its `ui-popover__content` between three
 * sub-views without ever closing:
 *  - **main** — identity (no "Client" tag; a **Become a Freelancer** CTA for a client context), a
 *    dedicated clickable **online-status row**, View profile / Settings, a single **Sun/Moon** theme
 *    icon-button, and Log out. A header **context-switch** icon opens the context switcher.
 *  - **status** — the presence picker (Online · Away · Do Not Disturb · Invisible); selecting returns
 *    to `main` and persists the choice.
 *  - **context** — Teams ⁄ Businesses tabs listing the memberships the user can switch into, with
 *    Create-New / Manage footer actions.
 *
 * The menu binds **live account data** (name/avatar/email/role/status/workspace) fetched once on
 * hydration from the thin {@link AccountService}, falling back to the SSR {@link UserContext} until it
 * resolves. **Responsive (Part D.3):** below `--bp-md` the avatar opens a right-side account `Drawer`
 * that shares the very same view-driven body, so the two surfaces never drift.
 */
export default function UserActions(
	{ context = PERSONAL_MEMBER_CONTEXT, protectedRoute = false }: UserActionsProps,
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

	// The account popover's active sub-view + the context switcher's active tab.
	const view = useSignal<AccountView>("main");
	const ctxTab = useSignal<"teams" | "businesses">("teams");
	// The selected presence status — a durable local preference (task §2B), hydrated after mount.
	const status = useSignal<StatusKey>("online");

	// Reset to the main view whenever both account surfaces are closed, so reopening always starts on
	// the identity screen (never a stale status/context sub-view). Reads only the open signals — never
	// `view` — so it can't loop.
	useSignalEffect(() => {
		if (!profileOpen.value && !accountOpen.value) view.value = "main";
	});

	// The acting user's live account projection (name/avatar/email/role/status/workspace), fetched once
	// on hydration. `null` until it resolves — and if the read fails — so the menu falls back to the
	// context-derived placeholders below (chrome only; a failed load is never an access failure).
	const account = useSignal<CurrentUser | null>(null);
	const loggingOut = useSignal(false);
	useEffect(() => {
		status.value = toStatus(readStored("local", LocalKeys.ACCOUNT_STATUS));
		let alive = true;
		AccountService.current().then((user) => {
			if (alive && user) account.value = user;
		});
		return () => {
			alive = false;
		};
	}, []);

	// Live effective context (SSR base → DEV Context Switcher override). Every capability-gated surface
	// below — the Create menu, the role badge, the Become-a-Freelancer CTA, the context switcher's
	// active-row detection — reads this, so flipping the simulated persona re-gates the popover with no
	// reload. Inert in production (the seam degrades to the base context).
	const effective = useEffectiveContext(context);
	const effCtx = effective.value.context;
	const devOverride = effective.value.overridden;

	// Reading `dsConfig.value` re-renders this island when the mode flips from any surface.
	const dark = dsConfig.value.mode === "dark";

	const createOptions = createMenuOptions(effCtx);
	const links = profileLinks(effCtx);
	const notifications = getNotifications();
	const basket = getBasketItems();
	const hasUnread = notifications.some((n) => n.unread);

	// Resolved account display — the live projection when present, else the context-derived fallback.
	// A dev persona override wins over the fetched account for the role/identity display, so the
	// Context Switcher visibly re-personas the popover (the live fetch reflects the real, unswitched
	// session and would otherwise mask the simulation).
	const acct = account.value;
	const fallbackBadge = resolveAccountRole(effCtx);
	const displayName = acct?.name ?? links.displayName;
	const displaySub = acct?.email ?? "";
	const avatarUrl = acct?.avatar ?? undefined;
	const roleLabel = devOverride ? fallbackBadge.label : (acct?.roleLabel ?? fallbackBadge.label);
	const roleKey = devOverride ? fallbackBadge.role : (acct?.role ?? fallbackBadge.role);
	const workspace = acct?.workspace ?? null;
	// A client context shows no role tag — it gets the "Become a Freelancer" CTA instead (task §2A).
	const isClient = roleKey === "client";
	const activeStatus = STATUS_OPTIONS.find((o) => o.key === status.value) ?? STATUS_OPTIONS[0];

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

	/** Persist + apply a presence status, then return to the identity view. */
	function pickStatus(next: StatusKey): void {
		status.value = next;
		writeStored("local", LocalKeys.ACCOUNT_STATUS, next);
		view.value = "main";
	}

	/**
	 * Switch the acting context into a team/business (task §2C). Chrome-only stub: it remembers the
	 * choice and enters that workspace; the authoritative active-context switch is owned server-side by
	 * the access-token hook — a later pass POSTs `/api/context/switch` here. `onNavigate` closes the
	 * surface first so the menu isn't left open behind the navigation.
	 */
	function switchContext(
		kind: "team" | "business",
		entry: MembershipEntry,
		onNavigate: () => void,
	): void {
		writeStored("local", LocalKeys.LAST_ACTIVE_CONTEXT, entry.handle);
		onNavigate();
		const base = kind === "team" ? "/teams" : "/businesses";
		globalThis.location.href = `${base}/${entry.id}`;
	}

	// #region Sub-view renderers
	/** The identity view — the default popover body. */
	const mainView = (onNavigate: () => void): JSX.Element => (
		<>
			<div class="shell-account__head">
				<a class="shell-account__id" href={links.viewProfile} role="menuitem" onClick={onNavigate}>
					<Avatar label={displayName} image={avatarUrl} size="md" />
					<span class="shell-account__ident">
						<span class="shell-account__name">{displayName}</span>
						{displaySub ? <span class="shell-account__sub">{displaySub}</span> : null}
						{!isClient
							? (
								<span class="shell-account__meta">
									<span class="shell-account__badge" data-role={roleKey}>{roleLabel}</span>
								</span>
							)
							: null}
					</span>
				</a>
				<button
					type="button"
					class="shell-account__switch"
					aria-label="Switch team or business"
					onClick={() => {
						ctxTab.value = "teams";
						view.value = "context";
					}}
				>
					<NavIcon name="switch" />
				</button>
			</div>

			{isClient
				? (
					<a class="shell-account__cta" href={links.settings} role="menuitem" onClick={onNavigate}>
						<NavIcon name="services" class="shell-account__cta-icon" />
						<span>Become a Freelancer</span>
					</a>
				)
				: null}

			{workspace
				? (
					<div class="shell-account__workspace">
						<span class="shell-account__workspace-label">Workspace</span>
						<span class="shell-account__workspace-name">{workspace.name}</span>
					</div>
				)
				: null}

			{/* Online-status — its own dedicated row; opens the status picker (task §2B). */}
			<button
				type="button"
				class="shell-status"
				data-status={status.value}
				aria-haspopup="menu"
				onClick={() => (view.value = "status")}
			>
				<span class="shell-status__dot" aria-hidden="true" />
				<span class="shell-status__label">{activeStatus.label}</span>
				<NavIcon name="chevron" class="shell-status__chevron" />
			</button>

			<div class="shell-menu__sep" role="separator" />

			<a class="shell-menu__item" href={links.viewProfile} role="menuitem" onClick={onNavigate}>
				<span class="shell-menu__icon">
					<NavIcon name="user" />
				</span>
				<span class="shell-menu__label">View profile</span>
			</a>
			<a class="shell-menu__item" href={links.settings} role="menuitem" onClick={onNavigate}>
				<span class="shell-menu__icon">
					<NavIcon name="settings" />
				</span>
				<span class="shell-menu__label">Settings</span>
			</a>

			{/* Theme — a single Sun/Moon icon-button toggle (task §2D), replacing the old switch. */}
			<div class="shell-account__row">
				<span class="shell-account__row-label">Theme</span>
				<button
					type="button"
					class="shell-theme-btn"
					aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
					onClick={() => toggleMode()}
				>
					<NavIcon name={dark ? "sun" : "moon"} />
				</button>
			</div>

			<div class="shell-menu__sep" role="separator" />

			<button
				type="button"
				class="shell-menu__item shell-menu__item--danger"
				role="menuitem"
				disabled={loggingOut.value}
				onClick={() => {
					onNavigate();
					handleLogout();
				}}
			>
				<span class="shell-menu__icon">
					<NavIcon name="logout" />
				</span>
				<span class="shell-menu__label">{loggingOut.value ? "Signing out…" : "Log out"}</span>
			</button>
		</>
	);

	/** The presence picker view (task §2B). */
	const statusView = (): JSX.Element => (
		<div class="shell-subview">
			<div class="shell-subview__head">
				<button
					type="button"
					class="shell-subview__back"
					aria-label="Back"
					onClick={() => (view.value = "main")}
				>
					<NavIcon name="arrowLeft" />
				</button>
				<span class="shell-subview__title">Set status</span>
			</div>
			<ul class="shell-picker" role="radiogroup" aria-label="Presence status">
				{STATUS_OPTIONS.map((opt) => {
					const selected = opt.key === status.value;
					return (
						<li key={opt.key} role="none">
							<button
								type="button"
								role="radio"
								aria-checked={selected}
								class="shell-picker__item"
								data-status={opt.key}
								onClick={() => pickStatus(opt.key)}
							>
								<span class="shell-status__dot" aria-hidden="true" />
								<span class="shell-picker__text">
									<span class="shell-picker__label">{opt.label}</span>
									<span class="shell-picker__desc">{opt.desc}</span>
								</span>
								{selected ? <NavIcon name="check" class="shell-picker__check" /> : null}
							</button>
						</li>
					);
				})}
			</ul>
		</div>
	);

	/** The in-popover context switcher view (task §2C). */
	const contextView = (onNavigate: () => void): JSX.Element => {
		const tab = ctxTab.value;
		const kind = tab === "teams" ? "team" : "business";
		const memberships = tab === "teams" ? getTeamMemberships() : getBusinessMemberships();
		const manageHref = tab === "teams" ? "/teams" : "/businesses";
		const createHref = tab === "teams" ? "/teams/create" : "/businesses/create";
		const createLabel = tab === "teams" ? "Create New Team" : "Create New Business";
		const manageLabel = tab === "teams" ? "Manage Teams" : "Manage Businesses";
		const activeType = effCtx.contextType;

		return (
			<div class="shell-subview">
				<div class="shell-subview__head">
					<button
						type="button"
						class="shell-subview__back"
						aria-label="Back"
						onClick={() => (view.value = "main")}
					>
						<NavIcon name="arrowLeft" />
					</button>
					<span class="shell-subview__title">Switch context</span>
				</div>

				<div class="shell-ctx__tabs" role="tablist" aria-label="Context kind">
					<button
						type="button"
						role="tab"
						class="shell-ctx__tab"
						aria-selected={tab === "teams"}
						data-active={tab === "teams" ? "true" : undefined}
						onClick={() => (ctxTab.value = "teams")}
					>
						Teams
					</button>
					<button
						type="button"
						role="tab"
						class="shell-ctx__tab"
						aria-selected={tab === "businesses"}
						data-active={tab === "businesses" ? "true" : undefined}
						onClick={() => (ctxTab.value = "businesses")}
					>
						Businesses
					</button>
				</div>

				<ul class="shell-ctx__list">
					{memberships.length === 0
						? <li class="shell-ctx__empty">No {tab} yet.</li>
						: memberships.map((m) => {
							const active = activeType === kind && effCtx.handle === m.handle;
							return (
								<li key={m.id} role="none">
									<button
										type="button"
										class="shell-ctx__item"
										data-active={active ? "true" : undefined}
										aria-current={active ? "true" : undefined}
										onClick={() => switchContext(kind, m, onNavigate)}
									>
										<Avatar label={m.name} image={m.avatar} size="sm" shape="square" />
										<span class="shell-ctx__body">
											<span class="shell-ctx__name">{m.name}</span>
											<span class="shell-ctx__detail">{m.detail}</span>
										</span>
										{active ? <NavIcon name="check" class="shell-ctx__check" /> : null}
									</button>
								</li>
							);
						})}
				</ul>

				<div class="shell-menu__sep" role="separator" />
				<div class="shell-ctx__foot">
					<a class="shell-menu__item" href={createHref} role="menuitem" onClick={onNavigate}>
						<span class="shell-menu__icon">
							<NavIcon name="create" />
						</span>
						<span class="shell-menu__label">{createLabel}</span>
					</a>
					<a class="shell-menu__item" href={manageHref} role="menuitem" onClick={onNavigate}>
						<span class="shell-menu__icon">
							<NavIcon name={tab === "teams" ? "teams" : "business"} />
						</span>
						<span class="shell-menu__label">{manageLabel}</span>
					</a>
				</div>
			</div>
		);
	};

	/** The view-driven account body — shared by the desktop Popover and the mobile side-sheet Drawer. */
	const accountBody = (onNavigate: () => void): JSX.Element => {
		if (view.value === "status") return statusView();
		if (view.value === "context") return contextView(onNavigate);
		return mainView(onNavigate);
	};
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

			{/* Basket — right-side blurring drawer (desktop; not a mobile header action) */}
			<button
				type="button"
				class="shell-util__btn shell-util__slot--desktop"
				aria-label="Basket"
				aria-haspopup="dialog"
				onClick={() => (basketOpen.value = true)}
			>
				<NavIcon name="basket" />
				{basket.length > 0 ? <span class="shell-util__dot" aria-hidden="true" /> : null}
			</button>

			{/* Profile (desktop) — circular avatar opening the account Popover */}
			<button
				ref={profileBtn}
				type="button"
				class="shell-util__profile shell-util__slot--desktop"
				aria-label="Your account"
			>
				<Avatar label={displayName} image={avatarUrl} size="sm" />
			</button>
			<Popover open={profileOpen} targetRef={profileBtn} placement="bottom-end" class="shell-pop">
				<div class="shell-account" aria-label="Account">
					{accountBody(() => (profileOpen.value = false))}
				</div>
			</Popover>

			{/* Profile (mobile) — the avatar toggles the account side-sheet instead of the Popover */}
			<button
				type="button"
				class="shell-util__profile shell-util__slot--mobile"
				aria-label="Your account"
				aria-haspopup="dialog"
				onClick={() => (accountOpen.value = true)}
			>
				<Avatar label={displayName} image={avatarUrl} size="sm" />
			</button>
			<Drawer
				visible={accountOpen}
				position="right"
				header="Account"
				class="shell-drawer shell-drawer--account"
				size="min(20rem, 88vw)"
			>
				<div class="shell-account shell-account--sheet" aria-label="Account">
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
								<Avatar image={n.avatar} alt={n.actor ?? ""} label={n.actor} size="sm" />
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

			<Drawer
				visible={basketOpen}
				position="right"
				header="Basket"
				class="shell-drawer"
				size="min(25rem, 92vw)"
			>
				<ul class="shell-basket">
					{basket.map((line) => (
						<li key={line.id} class="shell-basket__item">
							<img class="shell-basket__thumb" src={line.image} alt="" loading="lazy" />
							<span class="shell-basket__body">
								<span class="shell-basket__title">{line.title}</span>
								<span class="shell-basket__seller">{line.seller}</span>
							</span>
							<span class="shell-basket__price">{line.price}</span>
						</li>
					))}
				</ul>
				<a class="shell-drawer__cta" href="/basket">Go to basket</a>
			</Drawer>
		</div>
	);
}
