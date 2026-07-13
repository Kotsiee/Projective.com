import "../styles/site-shell.css";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { SEARCH_ENTITIES, type SearchEntity } from "../core/landing-data.ts";
import ThemeToggle from "@web/features/theme/islands/ThemeToggle.island.tsx";

/**
 * SiteHeader — the public navigation. Full-width and **completely transparent/borderless at the top
 * of the page**; once scrolled past the header band it morphs (via `--scrolled`) into a floating,
 * rounded, glass shell that tracks native window scroll.
 *
 * Desktop keeps the full row (wordmark · nav · search · actions). On mobile it collapses to a strict
 * **three-element** layout — icon-only mark, a compressed search field (still carrying its entity
 * selector), and a veggie-burger that morphs into an "X" and toggles a right-hand **slide-out
 * drawer** over a dismiss backdrop. The theme toggle lives in the desktop actions and inside the
 * drawer, never as a fourth mobile header element. Dumb island — search just routes to `/explore`.
 */
const NAV_LINKS = [
	{ label: "Explore", href: "/explore" },
	{ label: "How it works", href: "/#how-it-works" },
	{ label: "Pricing", href: "/help" },
];

const SEARCH_ICON =
	"M8.5 3a5.5 5.5 0 1 0 3.4 9.8l3.6 3.7 1.4-1.4-3.7-3.6A5.5 5.5 0 0 0 8.5 3Zm0 2a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z";

export default function SiteHeader({ authenticated = false }: { authenticated?: boolean }) {
	const menuOpen = useSignal(false); // mobile slide-out drawer
	const scrolled = useSignal(false); // scroll-driven glass state
	const entity = useSignal<SearchEntity>("Services"); // header search entity
	const entityOpen = useSignal(false);
	const entityRef = useRef<HTMLDivElement>(null);
	const drawerRef = useRef<HTMLElement>(null);
	const burgerRef = useRef<HTMLButtonElement>(null);

	// Scroll-driven transformation: transparent at top → glass pill once past the header band.
	useEffect(() => {
		const onScroll = () => {
			scrolled.value = globalThis.scrollY > 48;
		};
		onScroll();
		globalThis.addEventListener("scroll", onScroll, { passive: true });
		return () => globalThis.removeEventListener("scroll", onScroll);
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
		const input = (e.currentTarget as HTMLFormElement).elements.namedItem("q") as HTMLInputElement;
		const q = input?.value.trim() ?? "";
		const type = entity.value.toLowerCase();
		globalThis.location.href = `/explore?type=${type}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
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
					{NAV_LINKS.map((l) => (
						<a key={l.href} class="site-header__link" href={l.href}>{l.label}</a>
					))}
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
							{entity.value}
							<span class="site-header__chevron" aria-hidden="true" />
						</button>
						{entityOpen.value && (
							<ul class="site-header__entity-menu" role="listbox" aria-label="Search type">
								{SEARCH_ENTITIES.map((opt) => (
									<li
										key={opt}
										role="option"
										aria-selected={entity.value === opt}
										class="site-header__entity-option"
										tabIndex={0}
										onClick={() => {
											entity.value = opt;
											entityOpen.value = false;
										}}
										onKeyDown={(e) => {
											if (e.key === "Enter" || e.key === " ") {
												entity.value = opt;
												entityOpen.value = false;
											}
										}}
									>
										{opt}
									</li>
								))}
							</ul>
						)}
					</div>
					<input
						class="site-header__search-input"
						type="search"
						name="q"
						placeholder="Search Projective…"
						aria-label="Search Projective"
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
				{...(menuOpen.value ? {} : { inert: "" })}
			>
				<span class="site-header__drawer-brand">Projective</span>

				<nav class="site-header__drawer-nav" aria-label="Mobile">
					{NAV_LINKS.map((l) => (
						<a
							key={l.href}
							class="site-header__drawer-link"
							href={l.href}
							onClick={closeMenu}
						>
							{l.label}
						</a>
					))}
				</nav>

				<div class="site-header__drawer-theme">
					<ThemeToggle />
					<span class="site-header__drawer-theme-label">Light / dark theme</span>
				</div>

				<div class="site-header__drawer-actions">
					{authenticated
						? (
							<a class="site-header__cta site-header__cta--block" href="/projects">Dashboard</a>
						)
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
