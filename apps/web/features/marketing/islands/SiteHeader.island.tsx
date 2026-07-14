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

/**
 * SiteHeader — the public navigation. Full-width and **completely transparent/borderless at the top
 * of the page**; once scrolled past the header band it morphs (via `--scrolled`) into a floating,
 * rounded, glass shell that tracks native window scroll.
 *
 * Desktop keeps the full row (wordmark · discovery megamenu nav · search · actions). The four
 * discovery pillars (Helpers · Services · Projects · Products) reveal wide **glassmorphic megamenu**
 * panels on hover/focus, with a transparent hover-bridge so the panel never vanishes as the pointer
 * travels down into it. On mobile it collapses to a strict **three-element** layout — icon-only mark,
 * a compressed search field (still carrying its entity selector), and a veggie-burger that morphs
 * into an "X" and toggles a right-hand **slide-out drawer**; there the megamenus become collapsible
 * accordions. The theme toggle lives in the desktop actions and inside the drawer, never as a fourth
 * mobile header element. Dumb island — every megamenu leaf and the search just route to `/explore`.
 */
const SEARCH_ICON =
	"M8.5 3a5.5 5.5 0 1 0 3.4 9.8l3.6 3.7 1.4-1.4-3.7-3.6A5.5 5.5 0 0 0 8.5 3Zm0 2a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z";

export default function SiteHeader({ authenticated = false }: { authenticated?: boolean }) {
	const menuOpen = useSignal(false); // mobile slide-out drawer
	const scrolled = useSignal(false); // scroll-driven glass state
	const entity = useSignal<SearchScope>(DEFAULT_SEARCH_SCOPE); // header search scope
	const query = useSignal(""); // header search text — reflects the active /explore query
	const entityOpen = useSignal(false);
	const activeMenu = useSignal<string | null>(null); // open desktop megamenu pillar
	const openAccordion = useSignal<string | null>(null); // expanded mobile drawer accordion
	const entityRef = useRef<HTMLDivElement>(null);
	const drawerRef = useRef<HTMLElement>(null);
	const burgerRef = useRef<HTMLButtonElement>(null);
	const closeTimer = useRef<number | null>(null); // hover-intent grace timer for the megamenu

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

	// Close the header entity menu on outside click.
	useEffect(() => {
		const onDoc = (e: MouseEvent) => {
			if (entityOpen.value && entityRef.current && !entityRef.current.contains(e.target as Node)) {
				entityOpen.value = false;
			}
		};
		document.addEventListener("click", onDoc);
		return () => document.removeEventListener("click", onDoc);
	}, []);

	// Escape dismisses any open megamenu; clean up the hover-intent timer on unmount.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") activeMenu.value = null;
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
			if (closeTimer.current !== null) clearTimeout(closeTimer.current);
		};
	}, []);

	// Drawer: lock body scroll, close on Escape, and manage focus (open → drawer, close → burger).
	useEffect(() => {
		if (menuOpen.value) {
			const prevOverflow = document.body.style.overflow;
			document.body.style.overflow = "hidden";
			drawerRef.current?.focus();
			const onKey = (e: KeyboardEvent) => {
				if (e.key === "Escape") menuOpen.value = false;
			};
			document.addEventListener("keydown", onKey);
			return () => {
				document.body.style.overflow = prevOverflow;
				document.removeEventListener("keydown", onKey);
				burgerRef.current?.focus();
			};
		}
	}, [menuOpen.value]);

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
				<a class="site-header__brand" href="/" data-magnetic data-magnetic-strength="0.2">
					<span class="site-header__mark" aria-hidden="true" />
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
							>
								<button
									type="button"
									class="site-header__pillar-trigger"
									aria-haspopup="true"
									aria-expanded={open}
									aria-controls={`mega-${menu.key}`}
									onFocus={() => openMenu(menu.key)}
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
											<span class="site-header__mega-all-arrow" aria-hidden="true">→</span>
										</a>
									</div>
								</div>
							</div>
						);
					})}
				</nav>

				<form class="site-header__search" role="search" onSubmit={submitSearch}>
					<div class="site-header__entity" ref={entityRef}>
						<button
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
							<ul class="site-header__entity-menu" role="listbox" aria-label="Search scope">
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
						<svg viewBox="0 0 20 20" aria-hidden="true">
							<path d={SEARCH_ICON} fill="currentColor" />
						</svg>
					</button>
				</form>

				<div class="site-header__actions">
					{authenticated
						? (
							<>
								<a class="site-header__icon-btn" href="/messages" aria-label="Messages">
									<span aria-hidden="true">✉</span>
								</a>
								<a class="site-header__icon-btn" href="/wallet" aria-label="Wallet">
									<span aria-hidden="true">◈</span>
								</a>
								<ThemeToggle />
								<a class="site-header__cta" href="/projects" data-magnetic>Dashboard</a>
							</>
						)
						: (
							<>
								<ThemeToggle />
								<a class="site-header__signin" href="/login">Sign in</a>
								<a class="site-header__cta" href="/join" data-magnetic>Get started</a>
							</>
						)}
				</div>

				<button
					type="button"
					ref={burgerRef}
					class={`site-header__burger${menuOpen.value ? " is-open" : ""}`}
					aria-label={menuOpen.value ? "Close menu" : "Open menu"}
					aria-expanded={menuOpen.value}
					aria-controls="site-drawer"
					onClick={() => (menuOpen.value = !menuOpen.value)}
				>
					<span aria-hidden="true" />
					<span aria-hidden="true" />
				</button>
			</div>

			<div
				class={`site-header__backdrop${menuOpen.value ? " is-open" : ""}`}
				aria-hidden="true"
				onClick={closeMenu}
			/>

			<aside
				id="site-drawer"
				ref={drawerRef}
				class={`site-header__drawer${menuOpen.value ? " is-open" : ""}`}
				role="dialog"
				aria-modal="true"
				aria-label="Menu"
				tabIndex={-1}
				inert={menuOpen.value ? undefined : true}
			>
				<span class="site-header__drawer-brand">Projective</span>

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
											{menu.viewAll.label} →
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

				<div class="site-header__drawer-actions">
					{authenticated
						? <a class="site-header__cta site-header__cta--block" href="/projects">Dashboard</a>
						: (
							<>
								<a class="site-header__signin site-header__signin--block" href="/login">
									Sign in
								</a>
								<a class="site-header__cta site-header__cta--block" href="/join">
									Get started
								</a>
							</>
						)}
				</div>
			</aside>
		</header>
	);
}
