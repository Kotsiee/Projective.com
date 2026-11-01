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
 * exist yet is left out, never pointed somewhere else under the same words — and a label that names
 * an action ("Sell your products", "Post a project") leads to where that action is taken, never
 * to a browse page or to sign-up, which a signed-in reader (who gets this same footer) is bounced off.
 *
 * @module
 */
import { HELP_HUB_TITLE } from "@features/help/core/help-seo.ts";
import { currentVersion, LEGAL_LIBRARY, legalToday } from "@features/legal/core/registry.ts";
import { LEGAL_HUB_HREF, legalDocumentHref } from "@features/legal/core/versions.ts";
import type { LegalSlug } from "@projective/types/content";

// #region Types
/** One footer link. */
export interface FooterLink {
	label: string;
	href: string;
}

/** One quick-link stack — a column on desktop, an accordion on a phone. */
export interface FooterLinkGroup {
	title: string;
	links: FooterLink[];
}
// #endregion

// #region Pages the footer names
/** "Safe & easy payments" — how money is held before work starts. */
export const HELP_WHAT_IS_ESCROW = "/help/escrow-and-payments/what-is-escrow";
/** "Pricing" — the plans section of `/features`, until `/pricing` ships (Decision #252). */
export const PRICING_HREF = "/features#pricing";
/** "Start a team" — the team create flow; `/teams*` is freelancer-only (Decision #228 (A)). */
export const START_TEAM_HREF = "/teams/create";
// #endregion

// #region Actions the footer names
/**
 * Where a project is posted: the portfolio with its create dialog open — the same deep link the
 * header's Create menu and `/about`'s member CTA use. A guest is sent to `/login` and returned here.
 */
export const POST_PROJECT_HREF = "/projects?create=1";
/** Where a service is listed: the seller console with its create flow open on a service. */
export const LIST_SERVICE_HREF = "/catalogue?create=service";
/** Where a product is listed: the seller console with its create flow open on a product. */
export const LIST_PRODUCT_HREF = "/catalogue?create=product";
// #endregion

// #region Builders
/**
 * The landing pages' plain names for the legal documents whose titles use a word their copy rules
 * keep off the page (Decision #283: "escrow" only in its four slots, (C); never "IP", (D)): the name
 * `flows/LANDING.md` §4.6 already gives the escrow terms, and the deed's in plain words. The href and
 * the document are unchanged; only the link's words differ, and only where the page asks for them.
 */
export const PLAIN_LEGAL_LABELS: Readonly<Partial<Record<LegalSlug, string>>> = {
	"escrow-terms": "Payment protection terms",
	"ip-transfer-deed": "Ownership transfer deed",
};

/**
 * The legal documents as links, in the library's order, each titled as its version in effect — or,
 * with `plain`, by its {@link PLAIN_LEGAL_LABELS} name where it has one.
 */
function legalLinks(today: string, only?: readonly LegalSlug[], plain = false): FooterLink[] {
	return LEGAL_LIBRARY
		.filter((family) => !only || only.includes(family.slug))
		.map((family) => ({
			label: (plain ? PLAIN_LEGAL_LABELS[family.slug] : undefined) ??
				currentVersion(family, today).title,
			href: legalDocumentHref(family.slug),
		}));
}

/** What a page leaves out of the footer's stacks, or words differently. */
export interface FooterGroupOptions {
	/**
	 * Name the Products surfaces (default `true`): "Sell your products". The landing pages pass
	 * `false`: a product bought today is paid for but never delivered, so `/` and `/features` name no
	 * Products surface until digital-product delivery ships (W2; `flows/LANDING.md` §4.1, Decision
	 * #281 flag k, Decision #298).
	 */
	products?: boolean;
	/**
	 * Hold the footer to the landing pages' claims gate (default `false`; `flows/LANDING.md` §5.2,
	 * Decisions #281, #283): the legal documents by their {@link PLAIN_LEGAL_LABELS} names. The landing
	 * pages pass `true`; every other page keeps the documents' own titles.
	 */
	claimsGate?: boolean;
}

/**
 * The newsletter's privacy note under its form. The claims gate drops "Unsubscribe any time.": no
 * unsubscribe link or path exists yet (`NewsletterBackendService` only stores a subscription), so the
 * landing pages do not promise one.
 */
export function newsletterNote(claimsGate = false): string {
	return claimsGate
		? "We only use your email for updates."
		: "We only use your email for updates. Unsubscribe any time.";
}

/**
 * The three quick-link stacks, in reading order: the two audience stacks (copy from Decision #13 —
 * friendly, "safe & easy payments", never "escrow"; never "squad", PRODUCT_SPEC's banned page copy),
 * then Company & legal. `today` (`YYYY-MM-DD`, UTC) picks the legal titles in effect; `options` is
 * what the page leaves out or words differently ({@link FooterGroupOptions}).
 */
export function footerGroups(
	today: string = legalToday(),
	{ products = true, claimsGate = false }: FooterGroupOptions = {},
): FooterLinkGroup[] {
	return [
		{
			title: "For talent & teams",
			links: [
				{ label: "Find projects", href: "/explore?category=projects" },
				{ label: "Become a partner", href: "/become-partner" },
				{ label: "Showcase your services", href: LIST_SERVICE_HREF },
				...(products ? [{ label: "Sell your products", href: LIST_PRODUCT_HREF }] : []),
				{ label: "Start a team", href: START_TEAM_HREF },
			],
		},
		{
			title: "For clients",
			links: [
				{ label: "Hire ready-made teams", href: "/explore?category=teams" },
				{ label: "Browse services", href: "/explore?category=services" },
				{ label: "Post a project", href: POST_PROJECT_HREF },
				{ label: "Safe & easy payments", href: HELP_WHAT_IS_ESCROW },
				// The product overview: every feature, chapter by chapter, each with its example (L5).
				{ label: "Features", href: "/features" },
				{ label: "Pricing", href: PRICING_HREF },
			],
		},
		{
			title: "Company & legal",
			links: [
				{ label: "About", href: "/about" },
				{ label: "Articles", href: "/articles" },
				// No header entry reaches support, so the footer is a guest's only way to it.
				{ label: HELP_HUB_TITLE, href: "/help" },
				{ label: "Contact", href: "/contact" },
				...legalLinks(today, ["terms", "privacy", "cookies", "escrow-terms"], claimsGate),
				{ label: "All legal documents", href: LEGAL_HUB_HREF },
			],
		},
	];
}
// #endregion
