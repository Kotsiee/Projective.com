import "../styles/lp-theme.css";
import "../styles/lp-shell.css";
import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Drawer } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { Logo } from "@web/components/Logo.tsx";
import ThemeToggle from "@web/features/theme/islands/ThemeToggle.island.tsx";
import { withRedirect } from "@features/auth/core/redirect.ts";
import { HEADER_TOP_BAND_PX } from "../core/header.ts";

// #region Navigation
/** One link in the pill's "Main" navigation. */
interface LandingNavLink {
	label: string;
	href: string;
	/** Shown in the pill from `--bp-lg` only (the hero is the search below that); always in the sheet. */
	wide?: boolean;
}

/**
 * The pill's links (`flows/LANDING.md` §4.0). An entry is listed only once its destination exists:
 * "How it works" (`/#how-it-works`) and "Pricing" (`/#pricing`) join when those sections render on
 * `/`, and "Features" (`/features`) when that page ships — a link to an anchor the page does not
 * have would render and do nothing (root CLAUDE.md §3 gate 11). Explore is the pill's only link
 * until then, so it shows from `--bp-md`: §2.2 holds it back to `--bp-lg` because the hero is the
 * search below that width, and it takes `wide` once the hero search (L2) renders.
 */
const NAV_LINKS: readonly LandingNavLink[] = [
	{ label: "Explore", href: "/explore" },
];

/** The menu sheet's body: the element the menu button controls. */
const MENU_ID = "lp-site-menu";
// #endregion

// #region Component
/** Props for {@link LandingHeader}. */
export interface LandingHeaderProps {
	/** A signed-in visitor sees "Open app" (`/home`) in place of "Sign in" and "Get started". */
	authenticated: boolean;
	/** The page the visitor is on, threaded into "Sign in" as a sanitised `redirectTo`. */
	returnTo: string;
}

/**
 * LandingHeader — the landing's floating header pill (`flows/LANDING.md` §2.1–§2.3, §4.0): the brand
 * link, the "Main" navigation, and the actions — the app's {@link ThemeToggle}, then "Sign in" and
 * "Get started" for a guest or "Open app" for a signed-in visitor (never a redirect; Decision #284
 * (8)).
 *
 * The server markup works without JavaScript: every link is a real link, and the pill wears its
 * glass. Once hydrated, below `--bp-md` the pill keeps the brand, the first action and a menu button
 * — rendered only now, because the sheet it opens (the app's {@link Drawer}: portal, scrim, focus
 * trap, scroll lock, Escape) needs the client; before that, "Get started" stays in the pill instead.
 * The sheet carries the links, the theme control and both actions. From `--bp-lg` the hydrated pill
 * drops its glass while the page sits within {@link HEADER_TOP_BAND_PX} of the top, and only once
 * the background has measured its quiet zones (`lp-shell.css`), so its text never sits on a
 * full-alpha node.
 *
 * It is also the carrier of the landing's token sheet and shell stylesheet: a stylesheet imported
 * by a server component never reaches the page, and this island renders on every LandingShell page.
 */
export default function LandingHeader(
	{ authenticated, returnTo }: LandingHeaderProps,
): JSX.Element {
	const menuOpen = useSignal(false);
	const hydrated = useSignal(false);
	const atTop = useSignal(false);
	const signInHref = withRedirect("/login", returnTo);

	useEffect(() => {
		hydrated.value = true;
		const sync = () => {
			atTop.value = globalThis.scrollY <= HEADER_TOP_BAND_PX;
		};
		sync();
		globalThis.addEventListener("scroll", sync, { passive: true });
		return () => globalThis.removeEventListener("scroll", sync);
	}, []);

	const closeMenu = () => {
		menuOpen.value = false;
	};

	return (
		<header class={`lp-header${atTop.value ? " lp-header--top" : ""}`}>
			<a class="lp-header__brand" href="/" aria-label="Projective home">
				<Logo class="lp-header__mark" />
				<span class="lp-header__wordmark" aria-hidden="true">Projective</span>
			</a>

			<nav class="lp-header__nav" aria-label="Main">
				<ul class="lp-header__links">
					{NAV_LINKS.map((link) => (
						<li key={link.href} class={link.wide ? "lp-header__item--wide" : undefined}>
							<a class="lp-header__link" href={link.href}>{link.label}</a>
						</li>
					))}
				</ul>
			</nav>

			<div class="lp-header__actions">
				<span class="lp-header__theme">
					<ThemeToggle />
				</span>
				{authenticated ? <a class="lp-btn lp-btn--tonal" href="/home">Open app</a> : (
					<>
						<a class="lp-btn lp-btn--ghost" href={signInHref}>Sign in</a>
						<a
							class={`lp-btn lp-btn--primary${hydrated.value ? " lp-header__start" : ""}`}
							href="/join"
						>
							Get started
						</a>
					</>
				)}
				{hydrated.value && (
					<button
						type="button"
						class="lp-header__menu-btn"
						aria-label="Open menu"
						aria-haspopup="dialog"
						aria-expanded={menuOpen.value}
						aria-controls={menuOpen.value ? MENU_ID : undefined}
						onClick={() => (menuOpen.value = true)}
					>
						<Icon name="menu" />
					</button>
				)}
			</div>

			<Drawer
				visible={menuOpen}
				position="top"
				size="auto"
				class="lp-portal lp-menu"
				header={
					<span class="lp-menu__brand">
						<Logo class="lp-menu__mark" />
						<span aria-hidden="true">Projective</span>
						<span class="ui-visually-hidden">Projective menu</span>
					</span>
				}
				footer={
					<div class="lp-menu__actions">
						{authenticated
							? (
								<a class="lp-btn lp-btn--tonal lp-btn--block" href="/home" onClick={closeMenu}>
									Open app
								</a>
							)
							: (
								<>
									<a
										class="lp-btn lp-btn--tonal lp-btn--block"
										href={signInHref}
										onClick={closeMenu}
									>
										Sign in
									</a>
									<a
										class="lp-btn lp-btn--primary lp-btn--block"
										href="/join"
										onClick={closeMenu}
									>
										Get started
									</a>
								</>
							)}
					</div>
				}
			>
				<div id={MENU_ID}>
					<nav aria-label="Main">
						<ul class="lp-menu__links">
							{NAV_LINKS.map((link) => (
								<li key={link.href}>
									<a class="lp-menu__link" href={link.href} onClick={closeMenu}>{link.label}</a>
								</li>
							))}
						</ul>
					</nav>
					<div class="lp-menu__theme">
						<span>Theme</span>
						<ThemeToggle />
					</div>
				</div>
			</Drawer>
		</header>
	);
}
// #endregion
