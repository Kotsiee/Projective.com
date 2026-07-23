import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { UserContext } from "@projective/types/auth";
import { PERSONAL_MEMBER_CONTEXT } from "@projective/types/auth";
import type { CurrentUser } from "@projective/types/user";
import { resolveAccountRole } from "@projective/types/user";
// The shell header CSS lives in a server component (UserShell) whose import never reaches a client
// bundle; riding it on this always-present header island injects it (same pattern as ShellSidebar).
import "@web/features/shell/styles/user-shell.css";
import { Drawer, Popover } from "@projective/ui/feedback";
import { ToggleSwitch } from "@projective/ui/fields";
import { Avatar } from "@projective/ui/display";
import { dsConfig, toggleMode } from "@projective/ui/system";
import { NavIcon } from "@web/features/shell/core/nav-icons.tsx";
import { createMenuOptions, profileLinks } from "@web/features/shell/core/actions-model.ts";
import { getBasketItems, getNotifications } from "@web/features/shell/core/nav-fixtures.ts";
import { AccountService } from "@web/features/shell/core/AccountService.ts";
import { AuthService } from "@web/features/auth/core/AuthService.ts";

export interface UserActionsProps {
	/**
	 * The hydrated user context — gates the Create menu (seller-only Business/Service/Product; Team
	 * hidden in an organisation) and seeds the profile links + the account popover's fallback identity.
	 * Chrome only; access is re-checked server-side + under RLS. Defaults to a personal member so the
	 * tray is never empty.
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
 * left→right: **Create** (context-aware quick-create Popover menu) · **Notifications** (right-side
 * blurring Drawer) · **Basket** (right-side blurring Drawer) · **Profile** (circular avatar opening a
 * padded menu). The Profile menu binds **live account data** — the acting user's real name, avatar,
 * email, role badge, online status, and active workspace — fetched once on hydration from the thin
 * {@link AccountService} (`/api/user/me` → the fat `UserBackendService`); until it resolves (and if it
 * can't) it falls back to the SSR-hydrated {@link UserContext} placeholders, so the tray is never
 * empty. The **Log out** control runs the smart-logout pipeline (revoke + clear cookies, then a
 * route-aware redirect). Notifications/Basket remain fixture-backed (thin-frontend) via `nav-fixtures`.
 *
 * **Responsive (Part D.3).** Below `--bp-md` the tray swaps via `.shell-util__slot--desktop/--mobile`
 * (pure CSS — no JS breakpoint branch, so no hydration mismatch): Create + Basket + the Profile
 * Popover give way to **Messages · Notifications · Profile-avatar**, and the avatar opens a right-side
 * account **side-sheet** (`Drawer`) instead of the Popover. Both surfaces share one `accountBody`.
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

	// The acting user's live account projection (name/avatar/email/role/status/workspace), fetched once
	// on hydration. `null` until it resolves — and if the read fails — so the menu falls back to the
	// context-derived placeholders below (chrome only; a failed load is never an access failure).
	const account = useSignal<CurrentUser | null>(null);
	const loggingOut = useSignal(false);
	useEffect(() => {
		let alive = true;
		AccountService.current().then((user) => {
			if (alive && user) account.value = user;
		});
		return () => {
			alive = false;
		};
	}, []);

	// Mirror the design-system mode into a bound signal for the profile ToggleSwitch (reading
	// `dsConfig.value` re-renders this island when the mode flips from any surface).
	const dark = dsConfig.value.mode === "dark";
	const darkSig = useSignal(dark);
	useEffect(() => {
		darkSig.value = dark;
	}, [dark]);

	const createOptions = createMenuOptions(context);
	const links = profileLinks(context);
	const notifications = getNotifications();
	const basket = getBasketItems();
	const hasUnread = notifications.some((n) => n.unread);

	// Resolved account display — the live projection when present, else the context-derived fallback
	// (the role badge/status are always derivable from `context`, so they render even before the fetch).
	const acct = account.value;
	const fallbackBadge = resolveAccountRole(context);
	const displayName = acct?.name ?? links.displayName;
	const displaySub = acct?.email ?? "";
	const avatarUrl = acct?.avatar ?? undefined;
	const roleLabel = acct?.roleLabel ?? fallbackBadge.label;
	const roleKey = acct?.role ?? fallbackBadge.role;
	const online = acct?.online ?? true;
	const workspace = acct?.workspace ?? null;

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

	// The account menu body — shared by the desktop Popover and the mobile side-sheet Drawer so the two
	// never drift. `onNavigate` closes whichever surface is open.
	const accountBody = (onNavigate: () => void): JSX.Element => (
		<>
			<a class="shell-account__id" href={links.viewProfile} role="menuitem" onClick={onNavigate}>
				<Avatar label={displayName} image={avatarUrl} size="md" />
				<span class="shell-account__ident">
					<span class="shell-account__name">{displayName}</span>
					{displaySub ? <span class="shell-account__sub">{displaySub}</span> : null}
					<span class="shell-account__meta">
						<span class="shell-account__badge" data-role={roleKey}>{roleLabel}</span>
						<span class="shell-account__status" data-online={online ? "true" : "false"}>
							<span class="shell-account__status-dot" aria-hidden="true" />
							{online ? "Online" : "Away"}
						</span>
					</span>
				</span>
			</a>

			{workspace
				? (
					<div class="shell-account__workspace">
						<span class="shell-account__workspace-label">Workspace</span>
						<span class="shell-account__workspace-name">{workspace.name}</span>
					</div>
				)
				: null}

			<div class="shell-menu__sep" role="separator" />

			<a class="shell-menu__item" href={links.viewProfile} role="menuitem" onClick={onNavigate}>
				<span class="shell-menu__icon">
					<NavIcon name="user" />
				</span>
				<span class="shell-menu__label">View profile</span>
			</a>
			<a class="shell-menu__item" href="/settings/profiles" role="menuitem" onClick={onNavigate}>
				<span class="shell-menu__icon">
					<NavIcon name="teams" />
				</span>
				<span class="shell-menu__label">Switch profiles</span>
			</a>
			<a class="shell-menu__item" href={links.settings} role="menuitem" onClick={onNavigate}>
				<span class="shell-menu__icon">
					<NavIcon name="settings" />
				</span>
				<span class="shell-menu__label">Settings</span>
			</a>

			<div class="shell-account__row">
				<span class="shell-account__row-label">Dark mode</span>
				<ToggleSwitch
					value={darkSig}
					onValueChange={() => toggleMode()}
					aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
				/>
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
				<div class="shell-account" role="menu" aria-label="Account">
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
