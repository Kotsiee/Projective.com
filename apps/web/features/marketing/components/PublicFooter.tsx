import type { JSX } from "preact";
import NewsletterForm from "../islands/NewsletterForm.island.tsx";
import {
	BrandMark,
	ChevronIcon,
	DribbbleIcon,
	GitHubIcon,
	HelpIcon,
	LinkedInIcon,
	XIcon,
} from "./footer-icons.tsx";
import "../styles/footer.css";

/**
 * PublicFooter — the premium, minimal public footer. Rendered only inside the public/guest shell, so
 * it is naturally absent from the authenticated dashboard AND from the zero-scroll auth surfaces
 * (`/join`, `/login`, `/forgot-password`, `/verify`), which the `(public)/_layout` exempts by
 * composition — no runtime path checks here.
 *
 * A high-density five-column masthead (brand + social, three ELI5 link stacks, a newsletter capture)
 * over a thin utility bar (copyright, legal, a live "systems operational" indicator). Copy avoids
 * enterprise jargon ("safe & easy payments", never "escrow"). The link stacks are native `<details>`
 * so they collapse into accessible accordions on mobile with zero JS; the CSS force-opens them on
 * desktop. The newsletter is the sole island (dumb — it `fetch`es `/api/newsletter/subscribe`).
 * Token-only, strict BEM; non-interactive groups separate by spacing + weight, never boxed (§B.4).
 */

// #region Config
type LinkGroup = { title: string; links: { label: string; href: string }[] };

/** The three navigation stacks. ELI5 labels — friendly, jargon-free (root guardrail + §B.4). */
const GROUPS: LinkGroup[] = [
	{
		title: "For helpers",
		links: [
			{ label: "Find helper gigs", href: "/explore?category=projects" },
			{ label: "Showcase your services", href: "/explore?category=services" },
			{ label: "Sell your products", href: "/explore?category=products" },
			{ label: "How it works", href: "/help" },
		],
	},
	{
		title: "For clients",
		links: [
			{ label: "Hire helper teams", href: "/explore?category=teams" },
			{ label: "Post a new project", href: "/join" },
			{ label: "Safe & easy payments", href: "/help" },
			{ label: "Case studies", href: "/about" },
		],
	},
	{
		title: "Explore & learn",
		links: [
			{ label: "Services directory", href: "/explore?category=services" },
			{ label: "Products marketplace", href: "/explore?category=products" },
			{ label: "Trending helper teams", href: "/explore?category=teams" },
			{ label: "Helpful articles", href: "/explore?category=articles" },
		],
	},
];

const SOCIALS: { label: string; href: string; icon: (p: { class?: string }) => JSX.Element }[] = [
	{ label: "Projective on LinkedIn", href: "https://www.linkedin.com", icon: LinkedInIcon },
	{ label: "Projective on X", href: "https://x.com", icon: XIcon },
	{ label: "Projective on Dribbble", href: "https://dribbble.com", icon: DribbbleIcon },
	{ label: "Projective on GitHub", href: "https://github.com", icon: GitHubIcon },
];
// #endregion

export function PublicFooter(): JSX.Element {
	return (
		<footer class="lp-footer" aria-labelledby="lp-footer-brand">
			<div class="lp-footer__inner">
				{/* #region Column 1 — brand + social */}
				<div class="lp-footer__brand-col">
					<a class="lp-footer__brand" id="lp-footer-brand" href="/" aria-label="Projective — home">
						<BrandMark class="lp-footer__brand-mark" />
						<span class="lp-footer__brand-text">Projective</span>
					</a>
					<p class="lp-footer__tagline">
						The friendly place to build, find, and hire micro-agency helper teams.
					</p>
					<ul class="lp-footer__social" aria-label="Projective on social media">
						{SOCIALS.map(({ label, href, icon: Icon }) => (
							<li key={label}>
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
						))}
					</ul>
				</div>
				{/* #endregion */}

				{/* #region Columns 2–4 — navigation stacks (accordions on mobile) */}
				<nav class="lp-footer__nav" aria-label="Footer">
					{GROUPS.map((g) => (
						<details class="lp-footer__group" key={g.title}>
							<summary class="lp-footer__group-head">
								<span class="lp-footer__group-title">{g.title}</span>
								<ChevronIcon class="lp-footer__group-chevron" />
							</summary>
							<ul class="lp-footer__links">
								{g.links.map((l) => (
									<li key={l.label}>
										<a class="lp-footer__link" href={l.href}>{l.label}</a>
									</li>
								))}
							</ul>
						</details>
					))}
				</nav>
				{/* #endregion */}

				{/* #region Column 5 — newsletter capture */}
				<div class="lp-footer__news">
					<span class="lp-footer__news-title">Stay updated</span>
					<p class="lp-footer__news-lede">
						Fresh helper teams, new features, and the odd good idea. No spam, ever.
					</p>
					<NewsletterForm />
					<p class="lp-footer__news-note">
						We only use your email for updates. Unsubscribe any time.
					</p>
				</div>
				{/* #endregion */}
			</div>

			{/* #region Utility bar */}
			<div class="lp-footer__base">
				<span class="lp-footer__copy">© 2026 Projective. All rights reserved.</span>
				<div class="lp-footer__utility">
					<nav class="lp-footer__legal" aria-label="Legal">
						<a class="lp-footer__legal-link" href="/help">Privacy Policy</a>
						<a class="lp-footer__legal-link" href="/help">Terms of Service</a>
						<a class="lp-footer__legal-link lp-footer__legal-link--help" href="/help">
							Contact Help
							<span class="lp-footer__tip" role="tooltip">
								<HelpIcon class="lp-footer__tip-icon" />
								<span class="lp-footer__tip-bubble">We usually reply within a day.</span>
							</span>
						</a>
					</nav>
					<span class="lp-footer__status">
						<span class="lp-footer__status-dot" aria-hidden="true" />
						Status: All systems operational
					</span>
				</div>
			</div>
			{/* #endregion */}
		</footer>
	);
}
