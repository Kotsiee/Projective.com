import "../styles/site-shell.css";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import {
	DEFAULT_SEARCH_SCOPE,
	SEARCH_SCOPES,
	type SearchScope,
	searchScopeLabel,
} from "../core/landing-data.ts";
import ThemeToggle from "@web/features/theme/islands/ThemeToggle.island.tsx";
import { MEGA_MENUS, SECONDARY_LINKS } from "../core/megamenu-data.ts";
import { Icon } from "@projective/ui/icons";
import { BodyPortal } from "@projective/ui/overlay";
import { Drawer } from "@projective/ui/feedback";
import { useDismiss, useEdgeDetection, useOverlayStack } from "@projective/ui/hooks";
import { Logo } from "@web/components/Logo.tsx";
import { withRedirect } from "@features/auth/core/redirect.ts";
import { isFocusHeaderSearchShortcut } from "@features/shell/core/shortcuts.ts";
import { useSearchShortcut } from "@features/shell/hooks/useSearchShortcut.ts";

/**
 * SiteHeader — the public navigation. Full-width and **completely transparent/borderless at the top
 * of the page**; once scrolled past the header band it morphs (via `--scrolled`) into a floating,
 * rounded, glass shell that tracks native window scroll.
 *
 * Desktop keeps the full row (wordmark · discovery megamenu nav · search · actions). The four
 * discovery pillars (Helpers · Services · Projects · Products) reveal wide **glassmorphic megamenu**
 * panels on hover or on the trigger's Enter/Space, with a transparent hover-bridge so the panel never
 * vanishes as the pointer travels down into it. A closed panel is `inert`, so Tab crosses the four
 * triggers rather than every link behind them. On mobile it collapses to a strict **three-element** layout — icon-only mark,
 * a compressed search field (still carrying its entity selector), and a veggie-burger that morphs
 * into an "X" and toggles a right-hand **slide-out drawer**; there the megamenus become collapsible
 * accordions. The theme toggle lives in the desktop actions and inside the drawer, never as a fourth
 * mobile header element. Dumb island — every megamenu leaf and the search just route to `/explore`.
 */
export default function SiteHeader(
	{ authenticated = false, returnTo }: { authenticated?: boolean; returnTo?: string },
) {
	// Sign-in / sign-up links carry the page the visitor is ON, so authenticating returns them here
	// instead of dropping them on the default landing page. Sanitised by `withRedirect`.
	const signInHref = withRedirect("/login", returnTo ?? "");
	const joinHref = withRedirect("/join", returnTo ?? "");
	const menuOpen = useSignal(false); // mobile slide-out drawer
	const scrolled = useSignal(false); // scroll-driven glass state
	const entity = useSignal<SearchScope>(DEFAULT_SEARCH_SCOPE); // header search scope
	const query = useSignal(""); // header search text — reflects the active /explore query
	const entityOpen = useSignal(false);
	const activeMenu = useSignal<string | null>(null); // open desktop megamenu pillar
	const openAccordion = useSignal<string | null>(null); // expanded mobile drawer accordion
	const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null); // hover-intent grace timer for the megamenu
	const searchRef = useRef<HTMLFormElement>(null);

	useSearchShortcut({
		scopeRef: searchRef,
		matches: isFocusHeaderSearchShortcut,
		fromFields: true,
	});

	// #region Megamenu hover intent — a short grace on leave tolerates the trigger→panel gap so the
	// panel doesn't flicker shut while the pointer crosses the hover-bridge.
	const openMenu = (key: string) => {
		if (closeTimer.current !== null) {
			clearTimeout(closeTimer.current);
			closeTimer.current = null;
		}
		activeMenu.value = key;
	};
	const scheduleClose = () => {
		if (closeTimer.current !== null) clearTimeout(closeTimer.current);
		closeTimer.current = setTimeout(() => {
			activeMenu.value = null;
			closeTimer.current = null;
		}, 140);
	};
	const toggleMenu = (key: string) => {
		activeMenu.value = activeMenu.value === key ? null : key;
	};
	// #endregion

	// Scroll-driven transformation: transparent at top → glass pill once past the header band.
	useEffect(() => {
		const onScroll = () => {
			scrolled.value = globalThis.scrollY > 48;
		};
		onScroll();
		globalThis.addEventListener("scroll", onScroll, { passive: true });
		return () => globalThis.removeEventListener("scroll", onScroll);
	}, []);

	// Reflect the active /explore search in the header bar so the results page fully "owns" this input:
	// pre-fill the term + scope from the URL on load (and on back/forward via popstate).
	useEffect(() => {
		const sync = () => {
			if (globalThis.location?.pathname !== "/explore") return;
			const sp = new URLSearchParams(globalThis.location.search);
			query.value = sp.get("q") ?? "";
			const cat = (sp.get("category") ?? sp.get("type") ?? "").toLowerCase();
			const scope = SEARCH_SCOPES.find((s) => s.value === cat)?.value;
			entity.value = scope ?? DEFAULT_SEARCH_SCOPE;
		};
		sync();
		globalThis.addEventListener("popstate", sync);
		return () => globalThis.removeEventListener("popstate", sync);
	}, []);

	// The header entity menu: portalled and anchored (the scrolled header is glass, which would re-base
	// a fixed list onto its own box, §B.10.4), dismissed through the shared overlay stack.
	const entityStack = useOverlayStack({ active: entityOpen.value });
	const entityMenu = useEdgeDetection<HTMLButtonElement, HTMLUListElement>({
		open: entityOpen.value,
		offset: 8,
		zIndex: entityStack.zIndex,
	});
	useDismiss({
		open: entityOpen.value,
		enabled: entityStack.isTop,
		onDismiss: () => (entityOpen.value = false),
		panelRef: entityMenu.ref,
		triggerRef: entityMenu.triggerRef,
	});

	// Escape dismisses any open megamenu and hands focus back to its trigger, since the panel it sat in
	// turns inert; clean up the hover-intent timer on unmount.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || activeMenu.value === null) return;
			const active = document.activeElement as HTMLElement | null;
			const pillar = active?.closest(".site-header__pillar");
			pillar?.querySelector<HTMLButtonElement>(".site-header__pillar-trigger")?.focus();
			activeMenu.value = null;
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
			if (closeTimer.current !== null) clearTimeout(closeTimer.current);
		};
	}, []);

	function submitSearch(e: Event) {
		e.preventDefault();
		const q = query.value.trim();
		const params = new URLSearchParams();
		if (entity.value !== "all") params.set("category", entity.value);
		if (q) params.set("q", q);
		const qs = params.toString();
		globalThis.location.href = qs ? `/explore?${qs}` : "/explore";
	}

	const closeMenu = () => (menuOpen.value = false);

	return (
		<header
			class={`site-header${scrolled.value ? " site-header--scrolled" : ""}${
				menuOpen.value ? " site-header--menu-open" : ""
			}`}
		>
			<div class="site-header__bar" data-authed={authenticated ? "true" : "false"}>
				{/* Named on the link itself: below 900px the wordmark is hidden and the mark is aria-hidden. */}
				<a
					class="site-header__brand"
					href="/"
					aria-label="Projective"
				>
					<Logo class="site-header__mark" />
					<span class="site-header__brand-text">Projective</span>
				</a>

				<nav class="site-header__nav" aria-label="Primary">
					{MEGA_MENUS.map((menu) => {
						const open = activeMenu.value === menu.key;
						return (
							<div
								key={menu.key}
								class={`site-header__pillar${open ? " is-open" : ""}`}
								onMouseEnter={() => openMenu(menu.key)}
								onMouseLeave={scheduleClose}
								onFocusOut={(e) => {
									const next = e.relatedTarget as Node | null;
									if (open && (!next || !e.currentTarget.contains(next))) activeMenu.value = null;
								}}
							>
								<button
									type="button"
									class="site-header__pillar-trigger"
									aria-haspopup="true"
									aria-expanded={open}
									aria-controls={`mega-${menu.key}`}
									onClick={() => toggleMenu(menu.key)}
								>
									{menu.label}
									<span class="site-header__pillar-caret" aria-hidden="true" />
								</button>

								<div
									id={`mega-${menu.key}`}
									class="site-header__mega"
									role="region"
									aria-label={`${menu.label} — discovery`}
									inert={!open}
								>
									<div class="site-header__mega-inner">
										<p class="site-header__mega-tagline">{menu.tagline}</p>
										<div class="site-header__mega-cols">
											{menu.columns.map((col) => (
												<div class="site-header__mega-col" key={col.heading}>
													<p class="site-header__mega-heading">{col.heading}</p>
													<ul class="site-header__mega-list">
														{col.links.map((l) => (
															<li key={l.href}>
																<a
																	class="site-header__mega-link"
																	href={l.href}
																	onClick={() => (activeMenu.value = null)}
																>
																	{l.label}
																</a>
															</li>
														))}
													</ul>
												</div>
											))}
										</div>
										<a
											class="site-header__mega-all"
											href={menu.viewAll.href}
											onClick={() => (activeMenu.value = null)}
										>
											{menu.viewAll.label}
											<Icon name="arrow-right" class="site-header__mega-all-arrow" />
										</a>
									</div>
								</div>
							</div>
						);
					})}
				</nav>

				<form ref={searchRef} class="site-header__search" role="search" onSubmit={submitSearch}>
					<div class="site-header__entity">
						<button
							ref={entityMenu.triggerRef}
							type="button"
							class="site-header__entity-btn"
							aria-haspopup="listbox"
							aria-expanded={entityOpen.value}
							onClick={() => (entityOpen.value = !entityOpen.value)}
						>
							{searchScopeLabel(entity.value)}
							<span class="site-header__chevron" aria-hidden="true" />
						</button>
						{entityOpen.value && (
							<BodyPortal>
								<ul
									ref={entityMenu.ref}
									class="ui-anchored site-header__entity-menu"
									role="listbox"
									aria-label="Search scope"
									style={entityMenu.style}
								>
									{SEARCH_SCOPES.map((opt) => (
										<li
											key={opt.value}
											role="option"
											aria-selected={entity.value === opt.value}
											class="site-header__entity-option"
											tabIndex={0}
											onClick={() => {
												entity.value = opt.value;
												entityOpen.value = false;
											}}
											onKeyDown={(e) => {
												if (e.key === "Enter" || e.key === " ") {
													entity.value = opt.value;
													entityOpen.value = false;
												}
											}}
										>
											{opt.label}
										</li>
									))}
								</ul>
							</BodyPortal>
						)}
					</div>
					<input
						class="site-header__search-input"
						type="search"
						name="q"
						value={query.value}
						placeholder="Search Projective…"
						aria-label="Search Projective"
						onInput={(e) => (query.value = (e.currentTarget as HTMLInputElement).value)}
					/>
					<button type="submit" class="site-header__search-go" aria-label="Search">
						<Icon name="search" size="sm" />
					</button>
				</form>

				<div class="site-header__actions">
					{authenticated
						? (
							<>
								<a class="site-header__icon-btn" href="/messages" aria-label="Messages">
									<Icon name="mail" />
								</a>
								<a class="site-header__icon-btn" href="/wallet" aria-label="Wallet">
									<span aria-hidden="true">◈</span>
								</a>
								<ThemeToggle />
								<a class="site-header__cta" href="/projects">Dashboard</a>
							</>
						)
						: (
							<>
								<ThemeToggle />
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
							? <a class="site-header__cta site-header__cta--block" href="/projects">Dashboard</a>
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
					{MEGA_MENUS.map((menu) => {
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
						{SECONDARY_LINKS.map((l) => (
							<a
								key={l.href}
								class="site-header__drawer-link"
								href={l.href}
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
