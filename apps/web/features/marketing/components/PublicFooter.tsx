import type { JSX } from "preact";
import NewsletterForm from "../islands/NewsletterForm.island.tsx";
import FooterLinkGroups from "../islands/FooterLinkGroups.island.tsx";
import { InstagramIcon, LinkedInIcon, TikTokIcon, XIcon, YouTubeIcon } from "./footer-icons.tsx";
import { footerGroups, newsletterNote } from "../core/footer-links.ts";
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
 * One row of five lanes: the brand (wordmark, tagline, copyright), the three quick-link stacks — For
 * talent & teams, For clients, Company & legal — and the newsletter capture with the social row under
 * it. Every destination comes from `../core/footer-links.ts`, whose test resolves each one against
 * the route tree. There is no status indicator: nothing measures the platform's health, and a footer
 * line saying "all systems operational" with nothing behind it would be a claim the page cannot back
 * (Decision #279). Copy avoids enterprise jargon ("safe & easy payments", never "escrow") and
 * PRODUCT_SPEC's banned page words ("squad", "micro-agency"). The link stacks are native `<details>`
 * so they collapse into accessible accordions below `--bp-md`; from there up they render open
 * (`FooterLinkGroups`). Two islands, both dumb — the link stacks and the newsletter (`fetch`es
 * `/api/newsletter/subscribe`).
 *
 * Token-only, strict BEM; one solid tonal step off the canvas (`--surface-1`) under a single top
 * hairline, and non-interactive groups separate by spacing + weight, never boxed (§B.4).
 */

// #region Config
/** The networks the social row can draw, each with its glyph and its link's accessible name. */
const SOCIAL_NETWORKS = {
	x: { label: "Follow Projective on X", icon: XIcon },
	linkedin: { label: "Follow Projective on LinkedIn", icon: LinkedInIcon },
	youtube: { label: "Follow Projective on YouTube", icon: YouTubeIcon },
	instagram: { label: "Follow Projective on Instagram", icon: InstagramIcon },
	tiktok: { label: "Follow Projective on TikTok", icon: TikTokIcon },
} as const satisfies Record<
	string,
	{ label: string; icon: (p: { class?: string }) => JSX.Element }
>;

/**
 * Projective's own profiles, as `{ network, href }` — the owner-supplied URLs Decision #279 (b) was
 * waiting on. A network with no entry here draws nothing.
 */
const SOCIAL_PROFILES: ReadonlyArray<{ network: keyof typeof SOCIAL_NETWORKS; href: string }> = [
	{ network: "x", href: "https://x.com/projective" },
	{ network: "linkedin", href: "https://linkedin.com/company/projective" },
	{ network: "youtube", href: "https://youtube.com/@projective" },
	{ network: "instagram", href: "https://instagram.com/projective" },
	{ network: "tiktok", href: "https://tiktok.com/@projective" },
];
// #endregion

/** Props for {@link PublicFooter}. */
export interface PublicFooterProps {
	/**
	 * Name "Sell your products" in For talent & teams (default `true`); the landing pages pass
	 * `false` until digital-product delivery ships (`FooterGroupOptions.products`, Decision #298).
	 */
	products?: boolean;
	/**
	 * Hold the footer to the landing pages' claims gate (default `false`;
	 * `FooterGroupOptions.claimsGate`, `flows/LANDING.md` §5.2): the stacks' plain legal names, and the
	 * newsletter note without "Unsubscribe any time.", which no unsubscribe path keeps yet. The landing
	 * pages pass `true`.
	 */
	claimsGate?: boolean;
}

export function PublicFooter(
	{ products = true, claimsGate = false }: PublicFooterProps = {},
): JSX.Element {
	// Rendered on the server for every request, so the year turns over without a deploy.
	const year = new Date().getUTCFullYear();
	return (
		// The page's one `contentinfo` landmark needs no name of its own — borrowing the brand link's
		// ("Projective — home") would announce the footer as a link to the home page.
		<footer class="lp-footer">
			<div class="lp-footer__inner">
				{/* #region Lane 1 — brand */}
				<div class="lp-footer__brand-col">
					<a class="lp-footer__brand" href="/" aria-label="Projective — home">
						<Logo class="lp-footer__brand-mark" />
						<span class="lp-footer__brand-text">Projective</span>
					</a>
					<p class="lp-footer__tagline">
						The marketplace for collaborative talent and ready-made teams.
					</p>
					<p class="lp-footer__copy">© {year} Projective. All rights reserved.</p>
				</div>
				{/* #endregion */}

				{/* #region Lanes 2–4 — the three quick-link stacks (accordions on mobile) */}
				<FooterLinkGroups groups={footerGroups(legalToday(), { products, claimsGate })} />
				{/* #endregion */}

				{/* #region Lane 5 — newsletter capture + social row */}
				<div class="lp-footer__news">
					<span class="lp-footer__news-title">Stay updated</span>
					<p class="lp-footer__news-lede">
						New teams, new features, and the odd good idea. No spam, ever.
					</p>
					<NewsletterForm />
					<p class="lp-footer__news-note">{newsletterNote(claimsGate)}</p>
					{SOCIAL_PROFILES.length > 0
						? (
							<ul class="lp-footer__social" aria-label="Follow Projective">
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
			</div>
		</footer>
	);
}
