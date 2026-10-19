import "../styles/lp-theme.css";
import "../styles/lp-shell.css";
import "../styles/lp-faq.css";
import "../styles/lp-final.css";
import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Drawer } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { Logo } from "@web/components/Logo.tsx";
import ThemeToggle from "@web/features/theme/islands/ThemeToggle.island.tsx";
import { withRedirect } from "@features/auth/core/redirect.ts";
import { HEADER_TOP_BAND_PX, LANDING_NAV_LINKS } from "../core/header.ts";

// #region Navigation
/** The bar's links (`core/header.ts`): How it works · Explore (from `--bp-lg`) · Pricing. */
const NAV_LINKS = LANDING_NAV_LINKS;

/** Every bar link waits for `--bp-lg`, so the bar's nav itself does too (no empty landmark). */
const NAV_WIDE_ONLY = NAV_LINKS.every((link) => link.wide === true);

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
 * LandingHeader — the landing's full-width header bar (`flows/LANDING.md` §2.1–§2.3, §2.8, §4.0):
 * the brand link and the "Main" navigation at the leading edge, the actions at the trailing edge —
 * the app's {@link ThemeToggle}, then "Sign in" (tier 5, ghost) and "Get started" (tier 2,
 * monochrome inverted) for a guest, or "Open app" (tier 2) for a signed-in visitor (never a
 * redirect; Decision #284 (8)). The bar holds one filled control (§B.8.2, Decision #288 (E)).
 *
 * The server markup works without JavaScript: every link is a real link, and the bar wears its
 * glass. Below `--bp-md` the bar keeps the brand, the first action and a menu button whose sheet
 * (the app's {@link Drawer}: portal, scrim, focus trap, scroll lock, Escape) needs the client. The
 * server renders that button, and the stylesheet shows it in place of "Get started" from the first
 * paint wherever scripting is enabled (`@media (scripting: enabled)`), so hydration moves nothing in
 * the bar; with scripting off it stays hidden and "Get started" stays in the bar, and an engine
 * without the media feature makes the swap once hydrated (`lp-header--live`). The sheet carries the
 * links, the theme control and both actions (Sign in tier 4, Get started tier 2). The hydrated bar
 * drops its glass and its hairline while the page sits within {@link HEADER_TOP_BAND_PX} of the
 * top.
 *
 * It is also the carrier of the landing's token sheet and shell stylesheet, and of the sheets of
 * the server-only sections that close the page (the questions, `lp-faq.css`, and the final call to
 * action, `lp-final.css`): a stylesheet imported by a server component never reaches the page, and
 * this island renders on every LandingShell page.
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
		<header
			class={`lp-header${hydrated.value ? " lp-header--live" : ""}${
				atTop.value ? " lp-header--top" : ""
			}`}
		>
			<a class="lp-header__brand" href="/" aria-label="Projective home">
				<Logo class="lp-header__mark" />
				<span class="lp-header__wordmark" aria-hidden="true">Projective</span>
			</a>

			<nav
				class={`lp-header__nav${NAV_WIDE_ONLY ? " lp-header__nav--wide" : ""}`}
				aria-label="Main"
			>
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
				{authenticated ? <a class="lp-btn lp-btn--structural" href="/home">Open app</a> : (
					<>
						<a class="lp-btn lp-btn--ghost" href={signInHref}>Sign in</a>
						<a class="lp-btn lp-btn--structural lp-header__start" href="/join">Get started</a>
					</>
				)}
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
								<a
									class="lp-btn lp-btn--structural lp-btn--block"
									href="/home"
									onClick={closeMenu}
								>
									Open app
								</a>
							)
							: (
								<>
									<a
										class="lp-btn lp-btn--outlined lp-btn--block"
										href={signInHref}
										onClick={closeMenu}
									>
										Sign in
									</a>
									<a
										class="lp-btn lp-btn--structural lp-btn--block"
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
