/**
 * content.doc — the common core of every editorial document, and the shared primitives its
 * consumers extend it with.
 *
 * One {@link DocSchema} serves four surfaces, each of which adds its own fields with `.extend()`:
 *
 * | Surface   | Adds (examples)                                                                     |
 * | :-------- | :---------------------------------------------------------------------------------- |
 * | Legal     | `effectiveAt: IsoDateSchema`, `reviewedAt: IsoDateSchema.nullable()`, `versions: z.array(DocVersionSchema)` — clause numbers come from `anchorDoc(doc, { numbered: true })` |
 * | Help      | `category`, `roles: z.array(ContentAudience)`, `related: z.array(ContentSlugSchema)`, `faq: z.array(FaqItemSchema)` |
 * | Changelog | `semver: SemverSchema`, `categories`, `images: z.array(ContentImageSchema)`          |
 * | Articles  | `cover: ContentImageSchema`, `author: ContentAuthorSchema`                          |
 *
 * `DocSchema` carries one refinement (anchor uniqueness, {@link checkDocAnchors}), so Zod 4 limits
 * how it may be reshaped:
 *
 * - **Adding keys** — `DocSchema.extend({...})` keeps the refinement.
 * - **Overriding an existing key** (a changelog whose `version` is a semver) — `.extend()` THROWS
 *   ("Cannot overwrite keys on object schemas containing refinements"). Use
 *   `DocSchema.safeExtend({ version: SemverSchema })`, which keeps the refinement, or
 *   `DocBaseSchema.extend({...}).superRefine(checkDocAnchors)`.
 * - **`.pick()` / `.omit()` / `.partial()`** — refused on a refined schema; start from
 *   {@link DocBaseSchema} and re-apply `.superRefine(checkDocAnchors)`. The check tolerates a shape
 *   with no `sections` (a listing row picks `id`, `slug`, `title`, `summary`) and simply passes it.
 *
 * @module
 */
import { z } from "zod";
import {
	AnchorIdSchema,
	ContentNodeSchema,
	InlineContentSchema,
	SafeHrefSchema,
	SafeImageSrcSchema,
	SimpleBlockSchema,
} from "./nodes.ts";
import { RESERVED_ANCHOR_IDS } from "./anchors.ts";

// #region Shared primitives
/** A calendar date, `YYYY-MM-DD` (rendered in UTC so a date never shifts by the reader's zone). */
export const IsoDateSchema = z.iso.date();

/**
 * A content document's path segment under its surface (`/legal/<slug>`, `/help/<slug>`): lower-case
 * kebab. Static content modules use human-readable slugs; a document backed by a database row (an
 * editorial article) uses that row's own prefixed route slug (Decision #88), which also matches.
 */
export const ContentSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
	message: "Content slugs are lower-case kebab",
});

/** One entry of a document's version history (legal: what changed, and when it took effect). */
export const DocVersionSchema = z.object({
	version: z.string().min(1),
	date: IsoDateSchema,
	summary: z.string().min(1),
});
/** A version-history entry. */
export type DocVersion = z.infer<typeof DocVersionSchema>;

/**
 * A picture referenced by a document (an article cover, a changelog screenshot, an author avatar).
 * `w` × `h` are intrinsic pixels so every consumer can reserve the box (zero layout shift).
 */
export const ContentImageSchema = z.object({
	src: SafeImageSrcSchema,
	alt: z.string().min(1),
	w: z.number().int().positive(),
	h: z.number().int().positive(),
});
/** A content image reference. */
export type ContentImage = z.infer<typeof ContentImageSchema>;

/** Who wrote a document (articles, changelog entries). `href` links to their profile. */
export const ContentAuthorSchema = z.object({
	name: z.string().min(1),
	role: z.string().min(1).optional(),
	href: SafeHrefSchema.optional(),
	avatar: ContentImageSchema.optional(),
});
/** A content author. */
export type ContentAuthor = z.infer<typeof ContentAuthorSchema>;

/**
 * One question and its answer (help articles, FAQ blocks). The answer is simple blocks only, so its
 * plain-text projection (`nodesText`) is what the FAQPage JSON-LD carries.
 */
export const FaqItemSchema = z.object({
	id: AnchorIdSchema.optional(),
	question: z.string().min(1),
	answer: z.array(SimpleBlockSchema).min(1),
});
/** An FAQ item. */
export type FaqItem = z.infer<typeof FaqItemSchema>;

/** A semantic version, `MAJOR.MINOR.PATCH` with an optional pre-release (`1.4.0`, `2.0.0-beta.1`). */
export const SemverSchema = z.string().regex(
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
	{ message: "Expected a semantic version, e.g. 1.4.0" },
);

/**
 * Who a document is written for, in the product's own words (owner ruling 2026-10-17 (c): Client,
 * Freelancer, Team, Business — no new audience vocabulary).
 */
export const ContentAudience = z.enum(["client", "freelancer", "team", "business"]);
/** A content audience. */
export type ContentAudience = z.infer<typeof ContentAudience>;

/** The display word for each {@link ContentAudience}. */
export const CONTENT_AUDIENCE_LABEL: Readonly<Record<ContentAudience, string>> = {
	client: "Client",
	freelancer: "Freelancer",
	team: "Team",
	business: "Business",
};
// #endregion

// #region Sections & document
/**
 * One section: the `h2` boundary of a document. `id` is its public anchor (`/legal/terms#fees`) and
 * must be unique within the document; `tldr` is the optional "In short" line rendered beneath the
 * heading; `body` holds the section's blocks, including its `h3` sub-headings.
 */
export const DocSectionSchema = z.object({
	id: AnchorIdSchema,
	heading: z.string().min(1),
	tldr: InlineContentSchema.optional(),
	body: z.array(ContentNodeSchema).min(1),
});
/** A document section. */
export type DocSection = z.infer<typeof DocSectionSchema>;

/**
 * The document core, unrefined — the base for a consumer that needs `.pick()` / `.omit()` /
 * `.partial()`. Most consumers extend {@link DocSchema} instead.
 */
export const DocBaseSchema = z.object({
	/** Stable identity (`terms-of-service`), independent of the slug a surface routes it under. */
	id: z.string().min(1),
	slug: ContentSlugSchema,
	title: z.string().min(1),
	/** One or two sentences: the page's lead paragraph and its meta description. */
	summary: z.string().min(1),
	updatedAt: IsoDateSchema,
	/** The current version label (`1.0`, `2026-10`), shown in the meta line. */
	version: z.string().min(1),
	sections: z.array(DocSectionSchema).min(1),
});
/** A document (see {@link DocSchema}). */
export type Doc = z.infer<typeof DocBaseSchema>;

/**
 * The anchor rule every document obeys: section ids are unique, an explicit `h3` id collides with no
 * other explicit id, and no id takes one the layout itself owns ({@link RESERVED_ANCHOR_IDS}). An
 * id is a public address (`#fees` in a shared link), so a collision is an authoring error to fix,
 * not something to suffix silently. Auto-generated ids (an `h3` without `id`) are de-duplicated by
 * `anchorDoc` instead.
 *
 * Shape-tolerant on purpose, so it can refine a `.pick()` / `.partial()` of {@link DocBaseSchema}:
 * absent `sections` (or a section without `body`) has nothing to check and passes.
 */
export function checkDocAnchors(doc: object, ctx: z.RefinementCtx): void {
	const { sections } = doc as AnchorShape;
	if (!Array.isArray(sections)) return;
	const seen = new Map<string, string>();
	const claim = (id: string, path: (string | number)[], what: string) => {
		if (RESERVED_ANCHOR_IDS.includes(id)) {
			ctx.addIssue({
				code: "custom",
				path,
				message: `${what} id "${id}" is reserved by the layout`,
			});
			return;
		}
		const prior = seen.get(id);
		if (prior) {
			ctx.addIssue({ code: "custom", path, message: `${what} id "${id}" repeats ${prior}` });
			return;
		}
		seen.set(id, `${what} at ${path.join(".")}`);
	};
	sections.forEach((section, i) => {
		if (typeof section?.id === "string") claim(section.id, ["sections", i, "id"], "Section");
		const body: AnchorShapeNodes = Array.isArray(section?.body) ? section.body : [];
		body.forEach((node, j) => {
			if (node?.type === "h3" && typeof node.id === "string" && node.id) {
				claim(node.id, ["sections", i, "body", j, "id"], "Heading");
			}
		});
	});
}

/** What {@link checkDocAnchors} reads — every part optional, since it refines reshaped schemas too. */
type AnchorShape = {
	sections?: ReadonlyArray<{ id?: unknown; body?: AnchorShapeNodes } | null>;
};
/** A section body as {@link checkDocAnchors} reads it. */
type AnchorShapeNodes = ReadonlyArray<{ type?: unknown; id?: unknown } | null>;

/** The validated document core. Extend it per surface (see the module table). */
export const DocSchema = DocBaseSchema.superRefine(checkDocAnchors);
// #endregion

// #region Content modules
/**
 * Validate a content module at definition time and return it typed. Throws a readable error naming
 * the module and every failing path, so a broken module fails its own unit test (and the route's
 * first import) rather than rendering a half-document.
 *
 * @example
 * ```ts
 * export const TERMS = defineContent(LegalDocSchema, { id: "terms", slug: "terms", … });
 * ```
 */
export function defineContent<S extends z.ZodType>(schema: S, value: z.input<S>): z.output<S> {
	const result = schema.safeParse(value);
	if (result.success) return result.data;
	const label = typeof value === "object" && value !== null && "id" in value
		? String((value as { id: unknown }).id)
		: "(unnamed)";
	throw new Error(`Invalid content module "${label}":\n${z.prettifyError(result.error)}`);
}
// #endregion
