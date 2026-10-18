import { assertEquals } from "@std/assert";
import { buildHelpLibrary } from "@server/services/editorial/help-library.ts";
import { HELP_ARTICLES, HELP_CATEGORIES } from "@server/services/editorial/content/help.ts";
import { helpSegments, resolveHelpPath } from "./help-path.ts";

/** `/help/[...path]` dispatch on the real content (P2 §1). */

const library = buildHelpLibrary(HELP_CATEGORIES, HELP_ARTICLES);
const resolve = (path: string, search = "") => {
	const param = path.replace(/^\/help\/?/, "");
	return resolveHelpPath(helpSegments(param), library, path, search);
};

Deno.test("segments: decoded, lower-cased, empty ones dropped; bad encoding and dot segments refused", () => {
	assertEquals(helpSegments(undefined), []);
	assertEquals(helpSegments(""), []);
	assertEquals(helpSegments("Escrow-And-Payments//fees/"), ["escrow-and-payments", "fees"]);
	assertEquals(helpSegments("%E0%A4%A"), null);
	assertEquals(helpSegments("a/../b"), null);
});

Deno.test("no path is the hub", () => {
	assertEquals(resolve("/help"), { kind: "hub" });
	assertEquals(resolve("/help/"), { kind: "hub" });
});

Deno.test("one segment that is a category is its page", () => {
	const target = resolve("/help/escrow-and-payments");
	assertEquals(target.kind, "category");
	if (target.kind === "category") assertEquals(target.topic.category.slug, "escrow-and-payments");
});

Deno.test("category/article is the article", () => {
	const target = resolve("/help/escrow-and-payments/how-stage-funding-works");
	assertEquals(target.kind, "article");
	if (target.kind === "article") {
		assertEquals(target.article.slug, "how-stage-funding-works");
		assertEquals(target.category.slug, "escrow-and-payments");
	}
});

Deno.test("a guessed or moved address is a redirect to the canonical path, query kept", () => {
	assertEquals(resolve("/help/fees", "?q=fee"), {
		kind: "redirect",
		location: "/help/escrow-and-payments/fees?q=fee",
	});
	assertEquals(resolve("/help/getting-started/fees"), {
		kind: "redirect",
		location: "/help/escrow-and-payments/fees",
	});
	assertEquals(resolve("/help/Escrow-And-Payments"), {
		kind: "redirect",
		location: "/help/escrow-and-payments",
	});
});

Deno.test("anything else is not found", () => {
	for (
		const path of ["/help/nope", "/help/escrow-and-payments/nope", "/help/a/b/c", "/help/%E0%A4%A"]
	) {
		assertEquals(resolve(path), { kind: "not-found" }, path);
	}
});
