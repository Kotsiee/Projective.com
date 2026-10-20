import type { JSX } from "preact";
import NewsletterForm from "../islands/NewsletterForm.island.tsx";
import RecentlyViewed from "../islands/RecentlyViewed.island.tsx";
import FooterLinkGroups from "../islands/FooterLinkGroups.island.tsx";
import { DribbbleIcon, GitHubIcon, HelpIcon, LinkedInIcon, XIcon } from "./footer-icons.tsx";
import {
	FOOTER_SETUP_LINKS,
	footerGroups,
	footerUtilityLinks,
	newsletterNote,
} from "../core/footer-links.ts";
import { legalToday } from "@features/legal/core/registry.ts";
import { Logo } from "@web/components/Logo.tsx";
import "../styles/footer.css";

/**
 * PublicFooter — the premium, minimal public footer. It belongs to the public surfaces, not to a
 * shell: `GuestShell` renders it directly, and the authenticated layouts mount it through
 * `publicFooterFor` (`../core/footer-slot.tsx`), so a signed-in reader on `/`, `/explore`, `/view/[id]`
 * or `/[handle]` gets the same footer a guest does instead of none at all. It is still absent from
 * every `(dashboard)` surface, which never calls that resolver, and from the zero-scroll auth screens
 * (`/join`, `/login`, `/forgot-password`, `/verify`), which the `(public)/_layout` exempts by
 * composition — no runtime path checks here.
 *
 * A high-density masthead (brand, six quick-link stacks — three ELI5 audience stacks, then Company,
 * Help and Legal — and a newsletter capture) with a secondary row (onboarding entry points under the
 * brand, a recently-viewed rail under the newsletter, beside the stacks on desktop) over a thin
 * utility bar (copyright, the three legal documents people look for, Contact Help). Every
 * destination comes from `../core/footer-links.ts`, whose test resolves each one
 * against the route tree. There is no status indicator: nothing measures the platform's health, and
 * a footer line saying "all systems operational" with nothing behind it would be a claim the page
 * cannot back (Decision #279). Copy avoids enterprise jargon ("safe & easy payments", never
 * "escrow"). The link stacks are native `<details>` so they collapse into accessible accordions below
 * `--bp-md`; from there up they render open (`FooterLinkGroups`). Three islands, all dumb — the link
 * stacks (whose Feedback entry opens the board's drawer), the newsletter (`fetch`es
 * `/api/newsletter/subscribe`) and the recently-viewed rail (reads per-device history, resolves it
 * through `/api/explore/item`).
 *
 * Token-only, strict BEM; non-interactive groups separate by spacing + weight, never boxed (§B.4) —
 * the secondary row is set off by the grid's own row gap alone, deliberately without a hairline, since
 * the footer already spends one above the utility bar and a second would start to read as ruling.
 */

// #region Config
/** The networks the social tray can draw, each with its glyph and its link's accessible name. */
const SOCIAL_NETWORKS = {
	linkedin: { label: "Projective on LinkedIn", icon: LinkedInIcon },
	x: { label: "Projective on X", icon: XIcon },
	dribbble: { label: "Projective on Dribbble", icon: DribbbleIcon },
	github: { label: "Projective on GitHub", icon: GitHubIcon },
} as const satisfies Record<
	string,
	{ label: string; icon: (p: { class?: string }) => JSX.Element }
>;

/**
 * Projective's own profiles, as `{ network, href }`. EMPTY until the accounts exist: a "Projective on
 * LinkedIn" link to a network's home page would claim a profile Projective does not have. With nothing
 * here the tray renders nothing (Decision #279 lists the real URLs as content the owner must supply).
 */
const SOCIAL_PROFILES: ReadonlyArray<{ network: keyof typeof SOCIAL_NETWORKS; href: string }> = [];
// #endregion

/** Props for {@link PublicFooter}. */
export interface PublicFooterProps {
	/**
	 * Name the Products marketplace in "Explore & learn" (default `true`); the landing pages pass
	 * `false` until digital-product delivery ships (`FooterGroupOptions.products`, Decision #298).
	 */
	products?: boolean;
	/**
	 * Hold the footer to the landing pages' claims gate (default `false`;
	 * `FooterGroupOptions.claimsGate`, `flows/LANDING.md` §5.2): the stacks' plain legal names and
	 * "Ready-made teams", and the newsletter note without "Unsubscribe any time.", which no
	 * unsubscribe path keeps yet. The landing pages pass `true`.
	 */
	claimsGate?: boolean;
}

export function PublicFooter(
	{ products = true, claimsGate = false }: PublicFooterProps = {},
): JSX.Element {
	const today = legalToday();
	const { legal, contactHelp } = footerUtilityLinks(today, { claimsGate });
	// Rendered on the server for every request, so the year turns over without a deploy.
	const year = new Date().getUTCFullYear();
	return (
		// The page's one `contentinfo` landmark needs no name of its own — borrowing the brand link's
		// ("Projective — home") would announce the footer as a link to the home page.
		<footer class="lp-footer">
			<div class="lp-footer__inner">
				{/* #region Column 1 — brand + social */}
				<div class="lp-footer__brand-col">
					<a class="lp-footer__brand" href="/" aria-label="Projective — home">
						<Logo class="lp-footer__brand-mark" />
						<span class="lp-footer__brand-text">Projective</span>
					</a>
					<p class="lp-footer__tagline">
						The place to find, hire and work with ready-made teams.
					</p>
					{SOCIAL_PROFILES.length > 0
						? (
							<ul class="lp-footer__social" aria-label="Projective on social media">
								{SOCIAL_PROFILES.map(({ network, href }) => {
									const { label, icon: Icon } = SOCIAL_NETWORKS[network];
									return (
										<li key={network}>
											<a
												class="lp-footer__social-link"
												href={href}
												aria-label={label}
												target="_blank"
												rel="noopener noreferrer"
											>
												<Icon class="lp-footer__social-icon" />
											</a>
										</li>
									);
								})}
							</ul>
						)
						: null}
				</div>
				{/* #endregion */}

				{/* #region Column 2 — the six quick-link stacks (accordions on mobile) */}
				<FooterLinkGroups groups={footerGroups(today, { products, claimsGate })} />
				{/* #endregion */}

				{/* #region Column 3 — newsletter capture */}
				<div class="lp-footer__news">
					<span class="lp-footer__news-title">Stay updated</span>
					<p class="lp-footer__news-lede">
						New teams, new features, and the odd good idea. No spam, ever.
					</p>
					<NewsletterForm />
					<p class="lp-footer__news-note">{newsletterNote(claimsGate)}</p>
				</div>
				{/* #endregion */}

				{
					/* #region Secondary row — onboarding + recently viewed
					   A second ROW of the outer lanes rather than two more columns, and the choice is
					   arithmetic rather than taste: the masthead's gap is `clamp(2.5rem, 5vw, 5.5rem)`
					   inside a `--container-xl` (80rem) measure, so a five-track row would spend ~22rem
					   of that 80 on gutters alone and leave every stack too narrow to hold a link on one
					   line. On desktop this wrapper takes no box (`display: contents`): "get set up"
					   continues the brand lane directly and "recently viewed" the newsletter lane, beside
					   the six stacks that hold the middle lane across both rows — so the footer reads as
					   three themed lanes rather than eight competing stacks. Below 900px it is a full-width
					   row of its own again. */
				}
				<div class="lp-footer__aux">
					<div class="lp-footer__setup">
						<span class="lp-footer__block-title">Get set up</span>
						<ul class="lp-footer__links">
							{FOOTER_SETUP_LINKS.map((l) => (
								<li key={l.label}>
									<a class="lp-footer__link" href={l.href}>{l.label}</a>
								</li>
							))}
						</ul>
					</div>
					{
						/* Renders nothing at all until it has hydrated and resolved a non-empty history —
						   the heading cannot SSR, because a "Recently viewed" title on the server would be
						   claiming a history the server has no way to see. */
					}
					<RecentlyViewed />
				</div>
				{/* #endregion */}
			</div>

			{/* #region Utility bar */}
			<div class="lp-footer__base">
				<span class="lp-footer__copy">© {year} Projective. All rights reserved.</span>
				<div class="lp-footer__utility">
					<nav class="lp-footer__legal" aria-label="Legal">
						{legal.map((l) => (
							<a key={l.href} class="lp-footer__legal-link" href={l.href}>{l.label}</a>
						))}
						<a class="lp-footer__legal-link lp-footer__legal-link--help" href={contactHelp.href}>
							{contactHelp.label}
							<span class="lp-footer__tip" role="tooltip">
								<HelpIcon class="lp-footer__tip-icon" />
								<span class="lp-footer__tip-bubble">Every request gets a reference number.</span>
							</span>
						</a>
					</nav>
				</div>
			</div>
			{/* #endregion */}
		</footer>
	);
}
