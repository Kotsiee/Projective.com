/**
 * Every legal content module (Decision #270): each version validates against the legal schema at
 * import, the families obey their version rules, every clause opens with a plain-English summary and
 * carries a JSDoc citation a reviewer can trace, every in-document link resolves, and every character
 * survives the PDF writer.
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	anchorDoc,
	docText,
	type InlineContent,
	LEGAL_DOCUMENT_SLUGS,
	LEGAL_RESERVED_SLUGS,
	LegalDocSchema,
	nodesText,
	RESERVED_ANCHOR_IDS,
} from "@projective/types/content";
import { isPdfEncodable, pdfSafe } from "@server/services/legal/legal-pdf.ts";
import { LEGAL_LIBRARY } from "../registry.ts";
import { legalRailId } from "../view.ts";
import { defineLegalVersions } from "./define.ts";

const MODULES = [
	"terms.ts",
	"privacy.ts",
	"cookies.ts",
	"acceptable-use.ts",
	"escrow-terms.ts",
	"ip-transfer-deed.ts",
];

Deno.test("legal content: one family per slug, in the slug order, each version re-validating", () => {
	assertEquals(LEGAL_LIBRARY.map((f) => f.slug), [...LEGAL_DOCUMENT_SLUGS]);
	for (const family of LEGAL_LIBRARY) {
		assert(family.versions.length >= 1, family.slug);
		for (const doc of family.versions) {
			assert(LegalDocSchema.safeParse(doc).success, `${family.slug} ${doc.version}`);
			assertEquals(doc.slug, family.slug);
			assertFalse(LEGAL_RESERVED_SLUGS.includes(doc.slug));
		}
	}
});

Deno.test("legal content: Terms and Escrow Terms carry at least two versions, so Compare has a baseline", () => {
	for (const slug of ["terms", "escrow-terms"]) {
		const family = LEGAL_LIBRARY.find((f) => f.slug === slug)!;
		assert(family.versions.length >= 2, slug);
	}
});

Deno.test("legal content: every version is a draft until a lawyer signs it off (ruling (e))", () => {
	for (const family of LEGAL_LIBRARY) {
		for (const doc of family.versions) {
			assertEquals(doc.reviewedAt, null, `${doc.slug} ${doc.version} has a reviewedAt`);
		}
	}
});

Deno.test("legal content: a reconstructed, never-published baseline can never be signed off as reviewed", () => {
	// Terms 1.0 and Escrow Terms 1.0 exist only so Compare has a baseline (#270 flag (b)). Before a
	// lawyer reviews a family, its unpublished baseline must be removed, not reviewed into history.
	for (const family of LEGAL_LIBRARY) {
		const baselines = family.versions.filter((doc) => /never published/i.test(doc.changeSummary));
		for (const doc of baselines) {
			assertEquals(doc.reviewedAt, null, `${doc.slug} ${doc.version} is a reconstructed baseline`);
			assert(
				family.versions.every((v) => v.reviewedAt === null),
				`${family.slug}: remove the never-published ${doc.version} before any version is reviewed`,
			);
		}
	}
	const terms = LEGAL_LIBRARY.find((f) => f.slug === "terms")!;
	assert(/never published/.test(terms.versions.at(-1)!.changeSummary), "Terms 1.0 says what it is");
});

Deno.test("legal content: every clause has a plain-English summary and a non-empty body", () => {
	for (const family of LEGAL_LIBRARY) {
		for (const doc of family.versions) {
			for (const section of doc.sections) {
				assert(section.tldr, `${doc.slug} ${doc.version} #${section.id} has no summary`);
				assert(nodesText(section.body).length > 0, `${doc.slug} #${section.id} is empty`);
			}
		}
	}
});

Deno.test("legal content: no section id collides with the rail's document ids or the layout's ids", () => {
	const railIds = new Set(LEGAL_DOCUMENT_SLUGS.map(legalRailId));
	for (const family of LEGAL_LIBRARY) {
		for (const doc of family.versions) {
			const anchored = anchorDoc(doc, { numbered: true });
			const ids = anchored.sections.flatMap((s) => [
				s.anchor,
				...s.body.flatMap((n) => (n.type === "h3" ? [n.id] : [])),
			]);
			for (const id of ids) {
				assertFalse(railIds.has(id), `${doc.slug} #${id}`);
				assertFalse(RESERVED_ANCHOR_IDS.includes(id), `${doc.slug} #${id}`);
			}
		}
	}
});

/** Every link run in an inline content value. */
function links(content: InlineContent | undefined): string[] {
	if (!content || typeof content === "string") return [];
	return content.flatMap((
		run,
	) => (typeof run !== "string" && run.type === "link" ? [run.href] : []));
}

Deno.test("legal content: every internal link resolves — another document, an anchor here, or a route", () => {
	const ROUTES = new Set(["/contact"]);
	for (const family of LEGAL_LIBRARY) {
		for (const doc of family.versions) {
			const ids = new Set(doc.sections.map((s) => s.id));
			const hrefs = doc.sections.flatMap((s) => [
				...links(s.tldr),
				...s.body.flatMap((n) => {
					if (n.type === "p" || n.type === "quote") return links(n.content);
					if (n.type === "list") {
						return n.items.flatMap((i) => (typeof i === "string" ? [] : links(i.content)));
					}
					if (n.type === "table") return [...n.head, ...n.rows.flat()].flatMap(links);
					if (n.type === "dl") return n.items.flatMap((i) => links(i.definition));
					return [];
				}),
			]);
			for (const href of hrefs) {
				if (href.startsWith("#")) {
					assert(ids.has(href.slice(1)), `${doc.slug} ${doc.version} links to missing ${href}`);
				} else if (href.startsWith("/legal/")) {
					assert(
						(LEGAL_DOCUMENT_SLUGS as readonly string[]).includes(href.slice(7)),
						`${doc.slug} links to ${href}`,
					);
				} else {
					assert(ROUTES.has(href.split("?")[0]), `${doc.slug} links to unknown route ${href}`);
				}
			}
		}
	}
});

Deno.test("legal content: every character survives the PDF writer's encoding", () => {
	for (const family of LEGAL_LIBRARY) {
		for (const doc of family.versions) {
			const text = [docText(doc), doc.changeSummary].join("\n");
			for (const line of text.split("\n")) {
				assert(isPdfEncodable(pdfSafe(line)), `${doc.slug} ${doc.version}: ${line}`);
			}
		}
	}
});

Deno.test("legal content: every clause constant carries a JSDoc citation a reviewer can trace", async () => {
	const SOURCE =
		/PRODUCT_SPEC|finance-model|SYSTEM_ARCHITECTURE|Decision #|apps\/web|features\/|utils\/|routes\/|packages\/|\.env\.example|projects\.projects|ePrivacy|Browser cookie/;
	for (const file of MODULES) {
		const source = await Deno.readTextFile(new URL(`./${file}`, import.meta.url));
		// The comment group may not contain a `*/`, so it is the clause's own comment, never one above it.
		const clauses = [
			...source.matchAll(/((?:\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*)?)const (\w+): LegalClause =/g),
		];
		assert(clauses.length > 0, `${file} defines no clauses`);
		for (const [, doc, name] of clauses) {
			assert(doc.trim().startsWith("/**"), `${file} ${name} has no JSDoc`);
			assert(SOURCE.test(doc), `${file} ${name}'s JSDoc names no source`);
		}
	}
});

Deno.test("defineLegalVersions: refuses a family that breaks its rules", () => {
	const base = {
		id: "x",
		slug: "terms" as const,
		title: "T",
		summary: "S",
		updatedAt: "2026-10-01",
		effectiveDate: "2026-10-01",
		reviewedAt: null,
		changeSummary: "c",
		sections: [{ id: "a", heading: "A", body: [{ type: "p" as const, content: "x" }] }],
	};
	const throws = (fn: () => unknown, needle: string) => {
		try {
			fn();
		} catch (error) {
			assert(String(error).includes(needle), String(error));
			return;
		}
		throw new Error(`expected a throw mentioning ${needle}`);
	};
	throws(() => defineLegalVersions([]), "at least one version");
	throws(
		() => defineLegalVersions([{ ...base, version: "1.0" }, { ...base, version: "2.0" }]),
		"newest first",
	);
	throws(
		() => defineLegalVersions([{ ...base, version: "2.0" }, { ...base, version: "2.0" }]),
		"newest first",
	);
	throws(
		() =>
			defineLegalVersions([
				{ ...base, version: "2.0", effectiveDate: "2026-09-01" },
				{ ...base, version: "1.0" },
			]),
		"takes effect before",
	);
	throws(
		() => defineLegalVersions([{ ...base, version: "2.0" }, { ...base, id: "y", version: "1.0" }]),
		"id/slug",
	);
	throws(
		() => defineLegalVersions([{ ...base, slug: "workspace" as never, version: "1.0" }]),
		"Invalid",
	);
	assertEquals(defineLegalVersions([{ ...base, version: "1.0" }]).length, 1);
});
