import { cloneElement, type JSX, type RefObject, type VNode } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Popover, Tooltip } from "@projective/ui/feedback";
import "../styles/profile.css";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import { ProfileIcon, tabIcon } from "../components/profile-glyphs.tsx";
import {
	availabilityHref,
	ctaFor,
	managementTabsFor,
	TAB_LABEL,
	tabHref,
} from "../core/profile-model.ts";
import { editMode, following, quickMessageOpen } from "../core/profile-state.ts";
import ProfileMessagePopover from "./ProfileMessagePopover.island.tsx";
import type { ProfileView } from "../types/profile-types.ts";

/**
 * ProfileActionLane — the contextual middle-nav lane for a profile (root CLAUDE.md — Part 4), mirroring
 * `ui-app-shell__sidebar` visually. It renders BOTH presentations at once and lets CSS reveal exactly
 * one via `.ui-splitter[data-mode="collapsed"]` (a drag OR the toggle flips it). The collapse/expand
 * toggle dispatches the shared `MIDDLE_LANE_TOGGLE_EVENT` the `MiddleNavSplitter` listens for.
 *
 * Expanded structure (Part 4.2/4.3):
 *  - A `.proj-detail__header`-style header: Back (only from `/explore`) · Share Profile · Settings (owner).
 *  - Action stack, top→bottom: the Profile ⁄ Availability toggle pill (only when availability is set up)
 *    · the Follow | Message row · the full-width primary CTA (Hire for sellers).
 *  - Owner: Edit profile (primary) toggles the management tabs + Profile/Availability/Settings quick-links.
 */

// #region Small action model (collapsed rail)
interface RailAction {
	key: string;
	label: string;
	icon: VNode;
	href?: string;
	onClick?: () => void;
	active?: boolean;
	on?: boolean;
}

function cls(...parts: Array<string | false | undefined>): string {
	return parts.filter(Boolean).join(" ");
}

/** The global site sidebar the header's `bottom-end` kebab menu must never slide under. */
const SHELL_AVOID = [".ui-app-shell__sidebar"] as const;
// #endregion

export interface ProfileActionLaneProps {
	profile: ProfileView;
	/** Whether the viewer owns this profile. */
	canEdit: boolean;
	/** Pathname at SSR — seeds active-state on the management/quick links + the availability toggle. */
	path: string;
}

export default function ProfileActionLane(
	{ profile, canEdit, path }: ProfileActionLaneProps,
): JSX.Element {
	const currentPath = useSignal<string>(path);
	const fromExplore = useSignal<boolean>(false);
	// Header controls: favourite toggle (client-only stub) + the kebab menu's open state.
	const favorited = useSignal<boolean>(false);
	const menuOpen = useSignal<boolean>(false);
	useEffect(() => {
		try {
			fromExplore.value = document.referrer.includes("/explore");
			currentPath.value = globalThis.location?.pathname ?? path;
		} catch { /* SSR / no referrer — leave the default */ }
	}, []);

	function setLaneCollapsed(next: boolean): void {
		try {
			globalThis.dispatchEvent(
				new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
			);
		} catch { /* SSR / no window — non-fatal */ }
	}

	function share(): void {
		try {
			const url = globalThis.location?.href ?? "";
			const nav = globalThis.navigator as Navigator & {
				share?: (d: { title: string; url: string }) => Promise<void>;
			};
			if (nav?.share) nav.share({ title: profile.name, url }).catch(() => {});
			else nav?.clipboard?.writeText(url).catch(() => {});
		} catch { /* non-fatal */ }
	}

	function copyLink(): void {
		try {
			const url = globalThis.location?.href ?? "";
			globalThis.navigator?.clipboard?.writeText(url).catch(() => {});
		} catch { /* clipboard unavailable — non-fatal */ }
	}

	// #region Derived
	const cta = ctaFor(profile.kind);
	const seller = cta.primary === "Hire";
	const isFollowing = following.value;
	const inEdit = canEdit && editMode.value;
	const p = currentPath.value;
	const profileRoot = `/${profile.handle}`;
	const availHref = availabilityHref(profile.handle);
	const onAvailability = p === availHref;
	const hireHref = `/${profile.handle}/services`;
	// #endregion

	// #region Collapsed rail actions (flat)
	const shareAction: RailAction = {
		key: "share",
		label: "Share profile",
		icon: <ProfileIcon name="share" />,
		onClick: share,
	};
	const availabilityAction: RailAction = {
		key: "availability",
		label: "Availability",
		icon: <ProfileIcon name="availability" />,
		href: availHref,
		active: onAvailability,
	};
	const settingsAction: RailAction = {
		key: "settings",
		label: "Settings",
		icon: <ProfileIcon name="settings" />,
		href: "/settings",
	};

	let railActions: RailAction[];
	if (inEdit) {
		railActions = [
			shareAction,
			...managementTabsFor(profile.kind).map((tab): RailAction => ({
				key: tab,
				label: TAB_LABEL[tab],
				icon: tabIcon(tab),
				href: tabHref(profile.handle, tab),
				active: p === tabHref(profile.handle, tab),
			})),
			{
				key: "profile",
				label: "Profile",
				icon: <ProfileIcon name="overview" />,
				href: profileRoot,
				active: p === profileRoot,
			},
			settingsAction,
			{
				key: "done",
				label: "Done editing",
				icon: <ProfileIcon name="edit" />,
				onClick: () => (editMode.value = false),
			},
		];
	} else if (canEdit) {
		railActions = [
			shareAction,
			{
				key: "edit",
				label: "Edit profile",
				icon: <ProfileIcon name="edit" />,
				onClick: () => (editMode.value = true),
			},
			settingsAction,
			...(profile.hasAvailability ? [availabilityAction] : []),
		];
	} else {
		railActions = [
			shareAction,
			{
				key: "follow",
				label: isFollowing ? "Following" : "Follow",
				icon: <ProfileIcon name={isFollowing ? "following" : "follow"} />,
				onClick: () => (following.value = !isFollowing),
				on: isFollowing,
			},
			{
				key: "message",
				label: "Message",
				icon: <ProfileIcon name="message" />,
				onClick: () => (quickMessageOpen.value = true),
			},
			...(seller
				? [{ key: "hire", label: "Hire", icon: <ProfileIcon name="hire" />, href: hireHref }]
				: []),
			...(profile.hasAvailability ? [availabilityAction] : []),
		];
	}
	// #endregion

	// #region Renderers
	function railBtn(item: RailAction): VNode {
		const glyph = cloneElement(item.icon);
		const className = cls("pf-railbtn", item.active && "pf-railbtn--active");
		return (
			<Tooltip key={item.key} content={item.label} placement="right">
				{item.href
					? (
						<a
							class={className}
							href={item.href}
							aria-label={item.label}
							data-active={item.active ? "true" : undefined}
							data-on={item.on ? "true" : undefined}
						>
							{glyph}
						</a>
					)
					: (
						<button
							type="button"
							class={className}
							onClick={item.onClick}
							aria-label={item.label}
							data-on={item.on ? "true" : undefined}
						>
							{glyph}
						</button>
					)}
			</Tooltip>
		);
	}

	/** The Profile ⁄ Availability segmented toggle (Part 4.3) — only when availability is configured. */
	function availabilityToggle(): VNode {
		return (
			<div class="pf-availtoggle" role="group" aria-label="Profile or availability view">
				<a
					class="pf-availtoggle__opt"
					href={profileRoot}
					data-active={!onAvailability ? "true" : undefined}
					aria-current={!onAvailability ? "page" : undefined}
				>
					Profile
				</a>
				<a
					class="pf-availtoggle__opt"
					href={availHref}
					data-active={onAvailability ? "true" : undefined}
					aria-current={onAvailability ? "page" : undefined}
				>
					Availability
				</a>
			</div>
		);
	}

	/** Owner management nav (edit mode) — the tabs + quick-links, mirroring `.ui-nav-item`. */
	function managementNav(): VNode {
		const mgmt = managementTabsFor(profile.kind);
		return (
			<>
				<nav class="pf-lane__nav" aria-label="Manage profile">
					{mgmt.map((tab) => (
						<a
							key={tab}
							class={cls(
								"ui-nav-item",
								"pf-laneitem",
								p === tabHref(profile.handle, tab) && "ui-nav-item--active",
							)}
							href={tabHref(profile.handle, tab)}
							aria-current={p === tabHref(profile.handle, tab) ? "page" : undefined}
						>
							<span class="ui-nav-item__icon" aria-hidden="true">{tabIcon(tab)}</span>
							<span class="ui-nav-item__label">{TAB_LABEL[tab]}</span>
						</a>
					))}
				</nav>
				<hr class="pf-hairline pf-lane__sep" />
				<nav class="pf-lane__nav" aria-label="Profile shortcuts">
					<a
						class={cls("ui-nav-item", "pf-laneitem", p === profileRoot && "ui-nav-item--active")}
						href={profileRoot}
					>
						<span class="ui-nav-item__icon" aria-hidden="true">
							<ProfileIcon name="overview" />
						</span>
						<span class="ui-nav-item__label">Profile</span>
					</a>
					<a
						class={cls("ui-nav-item", "pf-laneitem", onAvailability && "ui-nav-item--active")}
						href={availHref}
					>
						<span class="ui-nav-item__icon" aria-hidden="true">
							<ProfileIcon name="availability" />
						</span>
						<span class="ui-nav-item__label">Availability</span>
					</a>
					<a class="ui-nav-item pf-laneitem" href="/settings">
						<span class="ui-nav-item__icon" aria-hidden="true">
							<ProfileIcon name="settings" />
						</span>
						<span class="ui-nav-item__label">Settings</span>
					</a>
					<button
						type="button"
						class="ui-nav-item pf-laneitem pf-laneitem--primary"
						onClick={() => (editMode.value = false)}
					>
						<span class="ui-nav-item__icon" aria-hidden="true">
							<ProfileIcon name="edit" />
						</span>
						<span class="ui-nav-item__label">Done editing</span>
					</button>
				</nav>
			</>
		);
	}

	/** The default action stack (visitor, or owner not editing). */
	function actionStack(): VNode {
		if (canEdit) {
			return (
				<div class="pf-lane__actions">
					{profile.hasAvailability ? availabilityToggle() : null}
					<button
						type="button"
						class="pf-lanecta pf-lanecta--primary"
						onClick={() => (editMode.value = true)}
					>
						<ProfileIcon name="edit" class="pf-lanebtn__icon" />
						<span>Edit profile</span>
					</button>
				</div>
			);
		}
		return (
			<div class="pf-lane__actions">
				{profile.hasAvailability ? availabilityToggle() : null}
				<div class="pf-lane__row" role="group" aria-label="Follow or message">
					<button
						type="button"
						class="pf-lanebtn pf-lanebtn--follow"
						data-on={isFollowing ? "true" : undefined}
						aria-pressed={isFollowing}
						onClick={() => (following.value = !isFollowing)}
					>
						<ProfileIcon name={isFollowing ? "following" : "follow"} class="pf-lanebtn__icon" />
						<span>{isFollowing ? "Following" : "Follow"}</span>
					</button>
					<button
						type="button"
						class={cls("pf-lanebtn", !seller && "pf-lanebtn--primary")}
						onClick={() => (quickMessageOpen.value = true)}
					>
						<ProfileIcon name="message" class="pf-lanebtn__icon" />
						<span>Message</span>
					</button>
				</div>
				{seller
					? (
						<a class="pf-lanecta pf-lanecta--primary" href={hireHref}>
							<ProfileIcon name="hire" class="pf-lanebtn__icon" />
							<span>Hire</span>
						</a>
					)
					: null}
			</div>
		);
	}
	// #endregion

	return (
		<>
			<div class="pf-lane">
				{/* Collapsed icon rail — CSS reveals it only at the narrow rail density. */}
				<nav class="pf-lane__rail" aria-label="Profile actions">
					<div class="pf-lane__rail-group">
						{railActions.map(railBtn)}
					</div>
					<div class="pf-lane__rail-group pf-lane__rail-group--bottom">
						<Tooltip content="Expand lane" placement="right">
							<button
								type="button"
								class="pf-railbtn pf-railbtn--toggle"
								data-collapsed="true"
								aria-label="Expand lane"
								aria-pressed="true"
								onClick={() => setLaneCollapsed(false)}
							>
								<SidebarToggleIcon />
							</button>
						</Tooltip>
					</div>
				</nav>

				{/* Expanded stack. */}
				<div class="pf-lane__full">
					<div class="pf-lane__header">
						{
							/* Left: a Back link (proj-detail__back style) only when arriving from Explore; otherwise
					    nothing — no "Profile" title. The header actions right-align regardless. */
						}
						{fromExplore.value
							? (
								<a class="pf-lane__back" href="/explore" aria-label="Back to explore">
									<ProfileIcon name="back" class="pf-lane__back-icon" />
									<span>Back</span>
								</a>
							)
							: null}
						<div class="pf-lane__header-actions">
							<Tooltip content="Share profile" placement="bottom">
								<button
									type="button"
									class="pf-lane__headbtn"
									aria-label="Share profile"
									onClick={share}
								>
									<ProfileIcon name="share" />
								</button>
							</Tooltip>
							<Tooltip
								content={favorited.value ? "Remove favourite" : "Favourite"}
								placement="bottom"
							>
								<button
									type="button"
									class="pf-lane__headbtn"
									data-on={favorited.value ? "true" : undefined}
									aria-pressed={favorited.value}
									aria-label={favorited.value ? "Remove from favourites" : "Add to favourites"}
									onClick={() => (favorited.value = !favorited.value)}
								>
									<ProfileIcon name="star" />
								</button>
							</Tooltip>
							<Popover
								open={menuOpen}
								placement="bottom-end"
								class="pf-menu"
								avoid={SHELL_AVOID}
								allowOverflow={["bottom"]}
								trigger={(api) => (
									<button
										type="button"
										ref={api.ref as RefObject<HTMLButtonElement>}
										class="pf-lane__headbtn"
										data-open={api.expanded ? "true" : undefined}
										aria-label="More actions"
										aria-haspopup="menu"
										aria-expanded={api.expanded}
										aria-controls={api.panelId}
										onClick={api.toggle}
									>
										<ProfileIcon name="kebab" />
									</button>
								)}
							>
								<button
									type="button"
									role="menuitem"
									class="pf-lane__menu-item"
									onClick={() => {
										menuOpen.value = false;
										copyLink();
									}}
								>
									<ProfileIcon name="link" />
									<span>Copy link</span>
								</button>
								{canEdit
									? (
										<a
											role="menuitem"
											class="pf-lane__menu-item"
											href="/settings"
											onClick={() => (menuOpen.value = false)}
										>
											<ProfileIcon name="settings" />
											<span>Settings</span>
										</a>
									)
									: (
										<button
											type="button"
											role="menuitem"
											class="pf-lane__menu-item"
											data-danger="true"
											onClick={() => (menuOpen.value = false)}
										>
											<ProfileIcon name="flag" />
											<span>Report profile</span>
										</button>
									)}
							</Popover>
						</div>
					</div>

					<div class="pf-lane__scroll">
						{inEdit ? managementNav() : actionStack()}
					</div>

					<div class="pf-lane__footer">
						<Tooltip content="Collapse lane" placement="top">
							<button
								type="button"
								class="pf-lane__collapse"
								aria-label="Collapse lane"
								aria-pressed={false}
								onClick={() => setLaneCollapsed(true)}
							>
								<SidebarToggleIcon />
							</button>
						</Tooltip>
					</div>
				</div>
			</div>

			{/* The floating quick-message composer (task §3) — opened by the Message triggers. */}
			<ProfileMessagePopover profile={profile} />
		</>
	);
}
