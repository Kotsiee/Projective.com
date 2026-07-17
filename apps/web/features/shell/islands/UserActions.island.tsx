import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { UserContext } from "@projective/types/auth";
import { PERSONAL_MEMBER_CONTEXT } from "@projective/types/auth";
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

export interface UserActionsProps {
	/**
	 * The hydrated user context — gates the Create menu (seller-only Business/Service/Product; Team
	 * hidden in an organisation) and resolves the profile links. Chrome only; access is re-checked
	 * server-side + under RLS. Defaults to a personal member so the tray is never empty.
	 */
	context?: UserContext;
}

/**
 * UserActions — the unified header's trailing action tray (DESIGN_SYSTEM.md Part D.1, "Right Block"),
 * left→right: **Create** (context-aware quick-create Popover menu) · **Notifications** (right-side
 * blurring Drawer) · **Basket** (right-side blurring Drawer) · **Profile** (circular avatar opening a
 * padded menu: View profile, the relocated dark/light ToggleSwitch, an icon-only Settings button, and
 * Log out). All controls vertically centre in the header and use soft circular hover highlights.
 * Notifications/Basket are fixture-backed (thin-frontend pattern) behind `nav-fixtures`; a later pass
 * swaps them for `/api/*` calls with no component churn. Dumb island — no data access.
 *
 * **Responsive (Part D.3).** Below `--bp-md` the tray swaps via `.shell-util__slot--desktop/--mobile`
 * (pure CSS — no JS breakpoint branch, so no hydration mismatch): Create + Basket + the Profile
 * Popover give way to **Messages · Notifications · Profile-avatar**, and the avatar opens a right-side
 * account **side-sheet** (`Drawer`) instead of the Popover. Both surfaces share one `accountBody`.
 */
export default function UserActions(
	{ context = PERSONAL_MEMBER_CONTEXT }: UserActionsProps,
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

	// The account menu body — shared by the desktop Popover and the mobile side-sheet Drawer so the two
	// never drift. `onNavigate` closes whichever surface is open.
	const accountBody = (onNavigate: () => void): JSX.Element => (
		<>
			<a class="shell-account__id" href={links.viewProfile} role="menuitem" onClick={onNavigate}>
				<Avatar label="You" size="md" />
				<span class="shell-account__name">{links.displayName}</span>
			</a>

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

			<a class="shell-menu__item shell-menu__item--danger" href={links.logout} role="menuitem">
				<span class="shell-menu__icon">
					<NavIcon name="logout" />
				</span>
				<span class="shell-menu__label">Log out</span>
			</a>
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
				<Avatar label="You" size="sm" />
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
				<Avatar label="You" size="sm" />
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
