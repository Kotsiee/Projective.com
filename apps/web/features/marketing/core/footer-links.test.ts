import { assert, assertEquals } from "@std/assert";
import { ExploreCategory } from "@projective/types/explore";
import { isLegalSlug, LEGAL_DOCUMENT_SLUGS } from "@projective/types/content";
import { HELP_ARTICLES, HELP_CATEGORIES } from "@server/services/editorial/content/help.ts";
import { parseContactIntent } from "@projective/types/contact";
import { parseConsoleUrl } from "@projective/types/catalogue";
import {
	FOOTER_SETUP_LINKS,
	footerGroups,
	type FooterLink,
	footerUtilityLinks,
	HELP_FEES,
	HELP_WHAT_IS_ESCROW,
	HELP_WHAT_IS_PROJECTIVE,
	LIST_PRODUCT_HREF,
	LIST_SERVICE_HREF,
	POST_PROJECT_HREF,
} from "./footer-links.ts";
import { MEGA_MENUS, SECONDARY_LINKS } from "./megamenu-data.ts";

// #region Route tree
const ROUTES = new URL("../../../routes/", import.meta.url);

/** A file beside the routes that is not a route module. */
const NOT_A_ROUTE = /\.(test|spec|d)\.(tsx|ts)$/;

/** Every page/handler route as its URL segments (`[param]` kept as written), groups descended. */
function routePatterns(dir: URL, prefix: string[] = []): string[][] {
	const out: string[][] = [];
	for (const entry of Deno.readDirSync(dir)) {
		if (entry.name.startsWith("_") || entry.name === "api") continue;
		if (entry.isDirectory) {
			const group = /^\(.+\)$/.test(entry.name);
			out.push(
				...routePatterns(new URL(`${entry.name}/`, dir), group ? prefix : [...prefix, entry.name]),
			);
			continue;
		}
		if (NOT_A_ROUTE.test(entry.name)) continue;
		const stem = /^(.+)\.(tsx|ts)$/.exec(entry.name)?.[1];
		if (!stem) continue;
		out.push(stem === "index" ? prefix : [...prefix, stem]);
	}
	return out;
}

const PATTERNS = routePatterns(ROUTES);

/** The route a path is served by: a static match first, else the dynamic pattern that takes it. */
function routeFor(path: string): { pattern: string; dynamic: boolean } | null {
	const segments = path.split("/").filter(Boolean);
	const fixed = PATTERNS.find((p) =>
		p.length === segments.length && p.every((part, i) => part === segments[i])
	);
	if (fixed) return { pattern: `/${fixed.join("/")}`, dynamic: false };
	const dynamic = PATTERNS.find((p) => {
		const rest = p.findIndex((part) => part.startsWith("[..."));
		if (rest >= 0) {
			return segments.length >= rest &&
				p.slice(0, rest).every((part, i) => part.startsWith("[") || part === segments[i]);
		}
		return p.length === segments.length &&
			p.every((part, i) => part.startsWith("[") || part === segments[i]);
	});
	return dynamic ? { pattern: `/${dynamic.join("/")}`, dynamic: true } : null;
}
// #endregion

// #region What a dynamic route serves
const HELP_PATHS = new Set<string>([
	"/help",
	...HELP_CATEGORIES.map((c) => `/help/${c.slug}`),
	...HELP_ARTICLES.map((a) => `/help/${a.category}/${a.slug}`),
]);

/**
 * Whether a path a dynamic route takes names something that exists: a help page in the help content
 * source, a legal document in the library. Any other dynamic match is refused — the test cannot know
 * that `/[handle]` or `/view/[entity]` has a row behind it, so a footer must not lean on one.
 */
function dynamicTargetExists(pattern: string, path: string): boolean {
	if (pattern === "/help/[...path]") return HELP_PATHS.has(path);
	if (pattern === "/legal/[slug]") return isLegalSlug(path.split("/")[2] ?? "");
	return false;
}

/** Why `href` is not a live internal link, or `null` when it is. */
function deadLinkReason(href: string): string | null {
	const url = new URL(href, "https://projective.test");
	if (url.origin !== "https://projective.test") return "not an internal link";
	const route = routeFor(url.pathname);
	if (!route) return `no route serves ${url.pathname}`;
	if (route.dynamic && !dynamicTargetExists(route.pattern, url.pathname)) {
		return `${url.pathname} reaches ${route.pattern}, which serves nothing at that address`;
	}
	if (url.pathname === "/explore") {
		const category = url.searchParams.get("category");
		if (category !== null && !ExploreCategory.safeParse(category).success) {
			return `unknown explore category ${category}`;
		}
	}
	if (url.pathname === "/contact") {
		const intent = url.searchParams.get("intent");
		if (intent !== null && parseContactIntent(intent) !== intent) return `unknown intent ${intent}`;
	}
	if (url.pathname === "/catalogue" && url.searchParams.has("create")) {
		if (!parseConsoleUrl(url).createOpen) {
			return `the console opens no create flow on ${url.searchParams.get("create")}`;
		}
	}
	return null;
}

const TODAY = "2026-10-18";
const ALL_FOOTER_LINKS: FooterLink[] = [
	...footerGroups(TODAY).flatMap((g) => g.links),
	...FOOTER_SETUP_LINKS,
	...footerUtilityLinks(TODAY).legal,
	footerUtilityLinks(TODAY).contactHelp,
];
// #endregion

Deno.test("the route reader finds the public pages and the dynamic ones", () => {
	assertEquals(routeFor("/about"), { pattern: "/about", dynamic: false });
	assertEquals(routeFor("/"), { pattern: "/", dynamic: false });
	assertEquals(routeFor("/legal/terms"), { pattern: "/legal/[slug]", dynamic: true });
	assertEquals(routeFor("/legal/workspace"), { pattern: "/legal/workspace", dynamic: false });
	assertEquals(routeFor("/help/fees/x/y")?.pattern, "/help/[...path]");
	assert(deadLinkReason("/help/escrow-and-payments/no-such-article") !== null);
	assert(deadLinkReason("/legal/workspace-x") !== null);
	assert(deadLinkReason("/blog") !== null, "a top-level word is a profile handle, not a page");
	assert(deadLinkReason("/explore?category=squads") !== null);
});

Deno.test("every footer, onboarding and utility link reaches a page that exists", () => {
	const dead = ALL_FOOTER_LINKS
		.map((link) => ({ link, reason: deadLinkReason(link.href) }))
		.filter((x) => x.reason !== null)
		.map((x) => `${x.link.label} → ${x.link.href}: ${x.reason}`);
	assertEquals(dead, []);
});

Deno.test("every megamenu link reaches a page that exists", () => {
	const links = [
		...SECONDARY_LINKS,
		...MEGA_MENUS.flatMap((menu) => [menu.viewAll, ...menu.columns.flatMap((c) => c.links)]),
	];
	const dead = links
		.map((link) => ({ link, reason: deadLinkReason(link.href) }))
		.filter((x) => x.reason !== null)
		.map((x) => `${x.link.label} → ${x.link.href}: ${x.reason}`);
	assertEquals(dead, []);
	assertEquals(SECONDARY_LINKS.find((l) => l.label === "Pricing")?.href, HELP_FEES);
});

Deno.test("the footer's groups: three audience stacks, then Company, Help and Legal", () => {
	const groups = footerGroups(TODAY);
	assertEquals(groups.map((g) => g.title), [
		"For helpers",
		"For clients",
		"Explore & learn",
		"Company",
		"Help",
		"Legal",
	]);
	const by = (title: string) => groups.find((g) => g.title === title)!.links;
	assertEquals(by("Company").map((l) => l.href), ["/about", "/changelog", "/articles", "/contact"]);
	assertEquals(by("Help").map((l) => [l.href, l.opens ?? null]), [
		["/help", null],
		["/feedback", "feedback"],
	]);
	assertEquals(
		by("Legal").map((l) => l.href),
		[...LEGAL_DOCUMENT_SLUGS.map((slug) => `/legal/${slug}`), "/legal"],
	);
	assertEquals(by("Legal")[0].label, "Terms of Service");
	const named = (label: string) => ALL_FOOTER_LINKS.find((l) => l.label === label)?.href;
	assertEquals(named("How it works"), HELP_WHAT_IS_PROJECTIVE);
	assertEquals(named("Safe & easy payments"), HELP_WHAT_IS_ESCROW);
	assertEquals(named("Contact Help"), "/contact?intent=support");
});

Deno.test("the landing pages' footer names no Products marketplace until delivery ships", () => {
	const explore = (products?: boolean) =>
		footerGroups(TODAY, products === undefined ? {} : { products })
			.find((g) => g.title === "Explore & learn")!.links.map((l) => l.label);
	assertEquals(explore(), [
		"Services directory",
		"Products marketplace",
		"Trending teams",
		"Member articles",
	]);
	assertEquals(explore(false), ["Services directory", "Trending teams", "Member articles"]);
	const shell = Deno.readTextFileSync(
		new URL("../../landing/components/LandingShell.tsx", import.meta.url),
	);
	assertEquals(shell.includes("<PublicFooter products={false} />"), true);
});

Deno.test("no footer label points at the help hub in place of a page it names", () => {
	const hub = ALL_FOOTER_LINKS.filter((l) => l.href === "/help").map((l) => l.label);
	assertEquals(hub, ["Help centre"]);
	assertEquals(ALL_FOOTER_LINKS.some((l) => /status|operational/i.test(l.label)), false);
});

Deno.test("an action's words lead to where it is taken — never a browse page, never sign-up", () => {
	const named = (label: string) => ALL_FOOTER_LINKS.find((l) => l.label === label)?.href;
	assertEquals(named("Showcase your services"), LIST_SERVICE_HREF);
	assertEquals(named("Sell your products"), LIST_PRODUCT_HREF);
	assertEquals(named("Post a new project"), POST_PROJECT_HREF);
	assertEquals(named("Post your first project"), POST_PROJECT_HREF);
	assertEquals(named("See how it all works"), HELP_WHAT_IS_PROJECTIVE);
	assertEquals(
		parseConsoleUrl(new URL(LIST_SERVICE_HREF, "https://projective.test")).createKind,
		"service",
	);
	assertEquals(
		parseConsoleUrl(new URL(LIST_PRODUCT_HREF, "https://projective.test")).createKind,
		"product",
	);
	// A seller's or a poster's action never lands on a buyer's browse page, and never on `/join`, which
	// bounces the signed-in reader who gets this same footer (`publicFooterFor`) to their home.
	const actions = ALL_FOOTER_LINKS.filter((l) =>
		/^(showcase|sell|post|set up|complete)\b/i.test(l.label)
	);
	assertEquals(actions.length, 6);
	for (const link of actions) {
		assert(!link.href.startsWith("/explore"), `${link.label} → ${link.href}`);
		assert(!link.href.startsWith("/join"), `${link.label} → ${link.href}`);
	}
});
