/**
 * footer-links — every destination the public footer names, in one pure module (Decision #13, the
 * PUBLIC_ROUTES P8 sweep, Decision #279). SERVER-ONLY: it reads the legal library, whose content
 * modules build their schemas at import time, so no island may import it — `PublicFooter` (a server
 * component) builds the lists and hands them to its islands as plain data.
 *
 * Every href is a page that exists: the legal documents come from the legal library itself (titles
 * included, so a renamed document renames its link), the help articles are named by their canonical
 * `/help/<category>/<article>` paths, and `footer-links.test.ts` resolves each one against the route
 * tree, the help content source and the legal slugs. A link that would point at a page that does not
 * exist yet is left out, never pointed somewhere else under the same words.
 *
 * @module
 */
import { contactHref } from "@features/contact/core/contact-url.ts";
import { HELP_HUB_TITLE } from "@features/help/core/help-seo.ts";
import { FEEDBACK_TITLE } from "@features/feedback/core/feedback-seo.ts";
import { FEEDBACK_PATH } from "@features/feedback/core/feedback-url.ts";
import { currentVersion, LEGAL_LIBRARY, legalToday } from "@features/legal/core/registry.ts";
import { LEGAL_HUB_HREF, legalDocumentHref } from "@features/legal/core/versions.ts";
import type { LegalSlug } from "@projective/types/content";

// #region Types
/**
 * One footer link. `opens: "feedback"` marks the feedback board's entry: its `href` is the board's
 * own page (what a new tab, a copied link or a page without JavaScript gets), and a plain click opens
 * the board in the drawer over the current page instead (`?feedback=open`, Decision #272).
 */
export interface FooterLink {
	label: string;
	href: string;
	opens?: "feedback";
}

/** One quick-link stack — a column on desktop, an accordion on a phone. */
export interface FooterLinkGroup {
	title: string;
	links: FooterLink[];
}
// #endregion

// #region Help articles the footer names
/** "How it works" — the help centre's own introduction (Decision #275). */
export const HELP_WHAT_IS_PROJECTIVE = "/help/getting-started/what-is-projective";
/** "Safe & easy payments" — how money is held before work starts. */
export const HELP_WHAT_IS_ESCROW = "/help/escrow-and-payments/what-is-escrow";
/** "Fees" — what Projective charges; also the megamenu's Pricing until `/pricing` ships (#252). */
export const HELP_FEES = "/help/escrow-and-payments/fees";
// #endregion

// #region Onboarding
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
export const FOOTER_SETUP_LINKS: readonly FooterLink[] = [
	{ label: "Create an account", href: "/join" },
	{ label: "Complete your profile", href: "/settings" },
	{ label: "Post your first project", href: "/projects" },
	// The payout account lives in Verification & payouts; `/wallet/payouts` only 308s to the wallet's
	// upcoming-money section, which sets nothing up.
	{ label: "Set up payouts", href: "/settings/verification" },
	{ label: "See how it all works", href: "/help" },
];
// #endregion

// #region Builders
/** The legal documents as links, in the library's order, each titled as its version in effect. */
function legalLinks(today: string, only?: readonly LegalSlug[]): FooterLink[] {
	return LEGAL_LIBRARY
		.filter((family) => !only || only.includes(family.slug))
		.map((family) => ({
			label: currentVersion(family, today).title,
			href: legalDocumentHref(family.slug),
		}));
}

/**
 * The six quick-link stacks, in reading order: the three audience stacks (copy from Decision #13 —
 * friendly, "safe & easy payments", never "escrow"), then Company, Help and Legal. `today`
 * (`YYYY-MM-DD`, UTC) picks the legal titles in effect.
 */
export function footerGroups(today: string = legalToday()): FooterLinkGroup[] {
	return [
		{
			title: "For helpers",
			links: [
				{ label: "Find helper gigs", href: "/explore?category=projects" },
				{ label: "Showcase your services", href: "/explore?category=services" },
				{ label: "Sell your products", href: "/explore?category=products" },
				{ label: "How it works", href: HELP_WHAT_IS_PROJECTIVE },
			],
		},
		{
			title: "For clients",
			links: [
				{ label: "Hire helper teams", href: "/explore?category=teams" },
				{ label: "Post a new project", href: "/join" },
				{ label: "Safe & easy payments", href: HELP_WHAT_IS_ESCROW },
				{ label: "Fees", href: HELP_FEES },
			],
		},
		{
			title: "Explore & learn",
			links: [
				{ label: "Services directory", href: "/explore?category=services" },
				{ label: "Products marketplace", href: "/explore?category=products" },
				{ label: "Trending helper teams", href: "/explore?category=teams" },
				// Member-written posts (`catalogue.articles`); Projective's own are under Company (#271).
				{ label: "Member articles", href: "/explore?category=articles" },
			],
		},
		{
			title: "Company",
			links: [
				{ label: "About", href: "/about" },
				{ label: "Changelog", href: "/changelog" },
				{ label: "Articles", href: "/articles" },
				{ label: "Contact", href: "/contact" },
			],
		},
		{
			title: "Help",
			links: [
				{ label: HELP_HUB_TITLE, href: "/help" },
				{ label: FEEDBACK_TITLE, href: FEEDBACK_PATH, opens: "feedback" },
			],
		},
		{
			title: "Legal",
			links: [...legalLinks(today), { label: "All legal documents", href: LEGAL_HUB_HREF }],
		},
	];
}

/**
 * The utility bar's short legal row — the three documents a visitor looks for at the foot of any page
 * — and the support form.
 */
export function footerUtilityLinks(
	today: string = legalToday(),
): { legal: FooterLink[]; contactHelp: FooterLink } {
	return {
		legal: legalLinks(today, ["privacy", "terms", "cookies"]),
		contactHelp: { label: "Contact Help", href: contactHref("support") },
	};
}
// #endregion
