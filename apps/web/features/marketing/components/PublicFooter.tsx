import type { JSX } from "preact";
import NewsletterForm from "../islands/NewsletterForm.island.tsx";
import RecentlyViewed from "../islands/RecentlyViewed.island.tsx";
import {
	ChevronIcon,
	DribbbleIcon,
	GitHubIcon,
	HelpIcon,
	LinkedInIcon,
	XIcon,
} from "./footer-icons.tsx";
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
 * A high-density masthead (brand + social, three ELI5 quick-link stacks, a newsletter capture) over a
 * secondary row (onboarding entry points + a recently-viewed rail) and a thin utility bar (copyright,
 * legal, a live "systems operational" indicator). Copy avoids enterprise jargon ("safe & easy
 * payments", never "escrow"). The link stacks are native `<details>` so they collapse into accessible
 * accordions on mobile with zero JS; the CSS force-opens them on desktop. Two islands, both dumb — the
 * newsletter (`fetch`es `/api/newsletter/subscribe`) and the recently-viewed rail (reads per-device
 * history, resolves it through `/api/explore/item`).
 *
 * Token-only, strict BEM; non-interactive groups separate by spacing + weight, never boxed (§B.4) —
 * the secondary row is set off by the grid's own row gap alone, deliberately without a hairline, since
 * the footer already spends one above the utility bar and a second would start to read as ruling.
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
			// There is no `/blog` route on this product — the long-form surface is the help centre and
			// the `articles` discovery category above it. Pointing "Blog" at a 404 to satisfy a label
			// would be worse than pointing it at the page that actually holds the writing, so it joins
			// this stack rather than earning a fourth column for a single link.
			{ label: "Blog", href: "/help" },
		],
	},
];

/**
 * Onboarding entry points — the "what do I do first" stack.
 *
 * Deliberately NOT personalised. `PublicFooter` takes no props and the guest shell that renders it has
 * no `UserContext` to read, so a persona branch here would mean threading one in — and under root
 * CLAUDE.md §5 a new persona-observed branch drags a matching Dev Context Switcher axis along with it,
 * for a footer list. So this is ONE stack that is honest for a signed-out and a signed-in reader alike:
 * every destination past the first is a `(dashboard)` route, and the dashboard guard bounces a guest to
 * `/login?redirectTo=…` and returns them here afterwards — so the same link is a sign-in prompt for one
 * reader and the surface itself for the other, with no branch. Personalising it (hiding "Create an
 * account" from someone who has one, marking finished steps) is worth doing the day the footer has a
 * context to read; it is deferred, not overlooked.
 */
const SETUP_LINKS: { label: string; href: string }[] = [
	{ label: "Create an account", href: "/join" },
	{ label: "Complete your profile", href: "/settings" },
	{ label: "Post your first project", href: "/projects" },
	{ label: "Set up payouts", href: "/wallet/payouts" },
	{ label: "See how it all works", href: "/help" },
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
						<Logo class="lp-footer__brand-mark" />
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

				{/* #region Columns 2–4 — the quick-link stacks (accordions on mobile) */}
				<nav class="lp-footer__nav" aria-label="Quick links">
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

				{
					/* #region Secondary row — onboarding + recently viewed
					   A second ROW rather than two more columns, and the choice is arithmetic rather than
					   taste: the masthead's gap is `clamp(2.5rem, 5vw, 5.5rem)` inside a `--container-xl`
					   (80rem) measure, so a five-track row would spend ~22rem of that 80 on gutters alone
					   and leave every stack too narrow to hold a link on one line. Two rows keep the
					   existing three tracks at full width and let these two blocks inherit the same
					   vertical lanes — "get set up" continues the brand column, "recently viewed"
					   continues the newsletter column — so the footer reads as three themed lanes rather
					   than eight competing stacks. */
				}
				<div class="lp-footer__aux">
					<div class="lp-footer__setup">
						<span class="lp-footer__block-title">Get set up</span>
						<ul class="lp-footer__links">
							{SETUP_LINKS.map((l) => (
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
