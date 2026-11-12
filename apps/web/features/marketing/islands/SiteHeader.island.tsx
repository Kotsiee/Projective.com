import "../styles/site-shell.css";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import ThemeToggle from "@web/features/theme/islands/ThemeToggle.island.tsx";
import { MEGA_MENUS } from "../core/megamenu-data.ts";
import { Icon } from "@projective/ui/icons";
import { Drawer } from "@projective/ui/feedback";
// The component, not the `@projective/ui/utils` barrel: this island is in the landing's JS budget.
import { Kbd } from "@ui/utils/components/Kbd.tsx";
import { Logo } from "@web/components/Logo.tsx";
import { withRedirect } from "@features/auth/core/redirect.ts";
import { headerSearchShortcutLabel } from "@features/shell/core/shortcuts.ts";
import { useSearchTarget } from "@features/shortcuts/hooks/useSearchTarget.ts";
import {
	HEADER_TOP_BAND_PX,
	isCurrentNavLink,
	LANDING_NAV_LINKS,
} from "@features/landing/core/header.ts";

/** The nav link whose item carries the discovery megamenu. */
const EXPLORE_HREF = "/explore";

/** Props for {@link SiteHeader}. */
export interface SiteHeaderProps {
	/** A signed-in visitor (the landing pages only) sees "Open app" in place of the sign-in pair. */
	authenticated?: boolean;
	/**
	 * The page the visitor is on (path + query): threaded into Sign in / Get started as a sanitised
	 * `redirectTo`, and its path marks the matching nav link `aria-current="page"`.
	 */
	returnTo?: string;
	/**
	 * Whether the Explore megamenu lists the Products pillar (default true). The landing pages pass
	 * false: they name no Products surface until W2 (Decisions #281 k, #298 (E)).
	 */
	products?: boolean;
}

/**
 * SiteHeader — the ONE guest header: every guest page (`GuestShell`) and the landing pages for
 * every visitor (`LandingShell`) render it.
 *
 * Desktop: the brand and the "Main" links (How it works · Explore · Pricing · Features) at the
 * leading edge, the pill search and the actions at the trailing edge. At the top of the page the bar
 * floats: an inset, rounded, taller glass bar with no border or shadow. Past
 * {@link HEADER_TOP_BAND_PX} it docks (via `--scrolled`): it widens to the viewport's edges, shortens,
 * and takes a bottom hairline and a soft shadow.
 *
 * Explore is a real link plus a disclosure button (the WAI "navigation menu with top-level links"
 * pattern): hover or the button reveals the discovery megamenu — the four pillars (Helpers ·
 * Services · Projects · Products) down the leading column, the hovered or focused pillar's groups
 * beside it. A closed panel is `inert`, so Tab crosses the bar rather than every link behind it.
 *
 * Below `--bp-lg` the bar keeps three elements — the mark, the search and a burger that toggles
 * a right-hand slide-out drawer, where the pillars become accordions and the theme toggle lives.
 * Dumb island — the search and every megamenu leaf route to `/explore`.
 */
export default function SiteHeader(
	{ authenticated = false, returnTo = "", products = true }: SiteHeaderProps,
) {
	// Sign-in / sign-up links carry the page the visitor is ON, so authenticating returns them here
	// instead of dropping them on the default landing page. Sanitised by `withRedirect`.
	const signInHref = withRedirect("/login", returnTo);
	const joinHref = withRedirect("/join", returnTo);
	const menus = products ? MEGA_MENUS : MEGA_MENUS.filter((menu) => menu.key !== "products");
	const menuOpen = useSignal(false); // mobile slide-out drawer
	const scrolled = useSignal(false); // scroll-driven docked state
	const shortcutLabel = useSignal(headerSearchShortcutLabel("")); // the search pill's hint
	const exploreOpen = useSignal(false); // desktop megamenu
	const pillar = useSignal(menus[0].key); // the pillar the megamenu's second column shows
	const openAccordion = useSignal<string | null>(null); // expanded mobile drawer accordion
	const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null); // hover-intent grace timer
	const searchRef = useRef<HTMLFormElement>(null);
	const toggleRef = useRef<HTMLButtonElement>(null);

	useSearchTarget({ role: "header", scopeRef: searchRef });

	// #region Megamenu hover intent — a short grace on leave tolerates the trigger→panel gap so the
	// panel doesn't flicker shut while the pointer crosses the hover-bridge.
	const cancelClose = () => {
		if (closeTimer.current !== null) clearTimeout(closeTimer.current);
		closeTimer.current = null;
	};
	const openExplore = () => {
		cancelClose();
		exploreOpen.value = true;
	};
	const scheduleClose = () => {
		cancelClose();
		closeTimer.current = setTimeout(() => {
			exploreOpen.value = false;
			closeTimer.current = null;
		}, 140);
	};
	// #endregion

	// Scroll-driven transformation: floating inset bar at the top → docked full-width bar past the
	// header band. The platform read rides the same mount: the server renders "Ctrl".
	useEffect(() => {
		shortcutLabel.value = headerSearchShortcutLabel(globalThis.navigator.userAgent);
		const onScroll = () => {
			scrolled.value = globalThis.scrollY > HEADER_TOP_BAND_PX;
		};
		onScroll();
		globalThis.addEventListener("scroll", onScroll, { passive: true });
		return () => globalThis.removeEventListener("scroll", onScroll);
	}, []);

	// Escape dismisses the open megamenu and hands focus back to its disclosure button, since the panel
	// it sat in turns inert; clean up the hover-intent timer on unmount.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || !exploreOpen.value) return;
			if (document.activeElement?.closest(".site-header__explore")) toggleRef.current?.focus();
			exploreOpen.value = false;
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
			cancelClose();
		};
	}, []);

	// The form also submits natively (`action`); hydrated, an empty query lands on `/explore`, not `?q=`.
	function submitSearch(e: Event) {
		e.preventDefault();
		const q = String(new FormData(e.currentTarget as HTMLFormElement).get("q") ?? "").trim();
		globalThis.location.href = q ? `${EXPLORE_HREF}?q=${encodeURIComponent(q)}` : EXPLORE_HREF;
	}

	const closeMenu = () => (menuOpen.value = false);
	const closeExplore = () => (exploreOpen.value = false);

	return (
		<header
			class={`site-header${scrolled.value ? " site-header--scrolled" : ""}${
				menuOpen.value ? " site-header--menu-open" : ""
			}`}
		>
			<div class="site-header__bar">
				{/* Named on the link itself: below --bp-md the wordmark is hidden and the mark is aria-hidden. */}
				<a class="site-header__brand" href="/" aria-label="Projective">
					<Logo class="site-header__mark" />
					<span class="site-header__brand-text">Projective</span>
				</a>

				<nav class="site-header__nav" aria-label="Main">
					<ul class="site-header__links">
						{LANDING_NAV_LINKS.map((link) => {
							const current = isCurrentNavLink(link, returnTo) ? "page" : undefined;
							if (link.href !== EXPLORE_HREF) {
								return (
									<li key={link.href}>
										<a
											class="site-header__link"
											href={link.href}
											aria-current={current}
											data-label={link.label}
										>
											{link.label}
										</a>
									</li>
								);
							}
							const open = exploreOpen.value;
							return (
								<li
									key={link.href}
									class={`site-header__explore${open ? " is-open" : ""}`}
									onMouseEnter={openExplore}
									onMouseLeave={scheduleClose}
									onFocusOut={(e) => {
										const next = e.relatedTarget as Node | null;
										if (open && (!next || !e.currentTarget.contains(next))) closeExplore();
									}}
								>
									<a
										class="site-header__link"
										href={link.href}
										aria-current={current}
										data-label={link.label}
									>
										{link.label}
									</a>
									<button
										ref={toggleRef}
										type="button"
										class="site-header__explore-toggle"
										aria-label={`${link.label} menu`}
										aria-expanded={open}
										aria-controls="site-mega-explore"
										onClick={() => (exploreOpen.value = !open)}
									>
										<span class="site-header__caret" aria-hidden="true" />
									</button>

									<div
										id="site-mega-explore"
										class="site-header__mega"
										role="region"
										aria-label="Explore — discovery"
										inert={!open}
									>
										<div class="site-header__mega-inner">
											{menus.map((menu) => {
												const shown = pillar.value === menu.key;
												return (
													<div class="site-header__mega-group" key={menu.key}>
														<a
															class={`site-header__mega-pillar${shown ? " is-active" : ""}`}
															href={menu.viewAll.href}
															onMouseEnter={() => (pillar.value = menu.key)}
															onFocus={() => (pillar.value = menu.key)}
															onClick={closeExplore}
														>
															<span class="site-header__mega-pillar-label">{menu.label}</span>
															<span class="site-header__mega-tagline">{menu.tagline}</span>
														</a>
														{/* Hidden panes leave the tab order: Tab walks each pillar, then its own links. */}
														<div class="site-header__mega-pane" hidden={!shown}>
															{menu.columns.map((col) => (
																<div class="site-header__mega-col" key={col.heading}>
																	<p class="site-header__mega-heading">{col.heading}</p>
																	<ul class="site-header__mega-list">
																		{col.links.map((l) => (
																			<li key={l.href}>
																				<a
																					class="site-header__mega-link"
																					href={l.href}
																					onClick={closeExplore}
																				>
																					{l.label}
																				</a>
																			</li>
																		))}
																	</ul>
																</div>
															))}
														</div>
													</div>
												);
											})}
											<a class="site-header__mega-all" href={EXPLORE_HREF} onClick={closeExplore}>
												Explore everything
												<Icon name="arrow-right" class="site-header__mega-all-arrow" />
											</a>
										</div>
									</div>
								</li>
							);
						})}
					</ul>
				</nav>

				{
					/* The pill search: a faint fill and one hairline at rest, it widens and lifts while focused
				    or holding a query. Enter submits; the pill is a label, so a click anywhere focuses. The
				    hint names the real shortcut (Ctrl/⌘ + `/`; ⌘K is the command palette's). */
				}
				<form
					ref={searchRef}
					class="site-header__search"
					role="search"
					action={EXPLORE_HREF}
					onSubmit={submitSearch}
				>
					<label class="site-header__search-field">
						<Icon name="search" size="sm" class="site-header__search-icon" />
						<input
							class="site-header__search-input"
							type="search"
							name="q"
							placeholder="Search Projective…"
							aria-label="Search Projective"
							aria-keyshortcuts="Control+/ Meta+/"
							enterKeyHint="search"
						/>
						<span class="site-header__search-hint" aria-hidden="true">
							<Kbd size="sm">{shortcutLabel.value}</Kbd>
						</span>
					</label>
				</form>

				<div class="site-header__actions">
					<ThemeToggle />
					{authenticated ? <a class="site-header__cta" href="/home">Open app</a> : (
						<>
							<a class="site-header__signin" href={signInHref}>Sign in</a>
							<a class="site-header__cta" href={joinHref}>Get started</a>
						</>
					)}
				</div>

				<button
					type="button"
					class={`site-header__burger${menuOpen.value ? " is-open" : ""}`}
					aria-label={menuOpen.value ? "Close menu" : "Open menu"}
					aria-expanded={menuOpen.value}
					onClick={() => (menuOpen.value = !menuOpen.value)}
				>
					<span aria-hidden="true" />
					<span aria-hidden="true" />
				</button>
			</div>

			{
				/* The shared Drawer: portal, scrim, focus trap, scroll lock, Escape stack (§B.10). The sign-in /
			    get-started actions are its pinned footer, so they never scroll out of reach. */
			}
			<Drawer
				visible={menuOpen}
				position="right"
				header="Menu"
				class="site-header__drawer"
				footer={
					<div class="site-header__drawer-actions">
						{authenticated
							? <a class="site-header__cta site-header__cta--block" href="/home">Open app</a>
							: (
								<>
									<a class="site-header__signin site-header__signin--block" href={signInHref}>
										Sign in
									</a>
									<a class="site-header__cta site-header__cta--block" href={joinHref}>
										Get started
									</a>
								</>
							)}
					</div>
				}
			>
				<nav class="site-header__drawer-nav" aria-label="Mobile">
					{menus.map((menu) => {
						const open = openAccordion.value === menu.key;
						return (
							<div class={`site-header__acc${open ? " is-open" : ""}`} key={menu.key}>
								<button
									type="button"
									class="site-header__acc-trigger"
									aria-expanded={open}
									aria-controls={`acc-${menu.key}`}
									onClick={() => (openAccordion.value = open ? null : menu.key)}
								>
									<span>{menu.label}</span>
									<span class="site-header__acc-caret" aria-hidden="true" />
								</button>

								<div
									id={`acc-${menu.key}`}
									class="site-header__acc-panel"
									role="region"
									aria-label={`${menu.label} — discovery`}
								>
									<div class="site-header__acc-inner">
										{menu.columns.map((col) => (
											<div class="site-header__acc-group" key={col.heading}>
												<p class="site-header__acc-heading">{col.heading}</p>
												{col.links.map((l) => (
													<a
														key={l.href}
														class="site-header__acc-link"
														href={l.href}
														onClick={closeMenu}
													>
														{l.label}
													</a>
												))}
											</div>
										))}
										<a class="site-header__acc-all" href={menu.viewAll.href} onClick={closeMenu}>
											{menu.viewAll.label} <Icon name="arrow-right" />
										</a>
									</div>
								</div>
							</div>
						);
					})}

					<div class="site-header__drawer-secondary">
						{LANDING_NAV_LINKS.map((l) => (
							<a
								key={l.href}
								class="site-header__drawer-link"
								href={l.href}
								aria-current={isCurrentNavLink(l, returnTo) ? "page" : undefined}
								onClick={closeMenu}
							>
								{l.label}
							</a>
						))}
					</div>
				</nav>

				<div class="site-header__drawer-theme">
					<ThemeToggle />
					<span class="site-header__drawer-theme-label">Light / dark theme</span>
				</div>
			</Drawer>
		</header>
	);
}
