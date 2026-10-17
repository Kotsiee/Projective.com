/**
 * content.nodes — the typed body AST every editorial surface renders (legal, help, changelog,
 * articles).
 *
 * Product copy is not markdown and never raw HTML (PUBLIC_ROUTES_BUILD_PROMPTS §0.2 "Content
 * storage"): a body is a small, closed set of block nodes whose text is a list of inline runs. The
 * renderer (`@projective/ui/display/editorial` → `ContentRenderer`) maps each node to one semantic
 * element, so there is no parser dependency, no `dangerouslySetInnerHTML`, and nothing an author can
 * write that turns into markup the platform did not choose.
 *
 * Links and image sources are validated here rather than at render time, so an unsafe scheme
 * (`javascript:`, `data:`, a protocol-relative `//host`) fails the content module's parse — and its
 * unit test — instead of reaching a page.
 *
 * @module
 */
import { z } from "zod";

// #region Safe references
/**
 * Whether `href` is a link the editorial renderer may emit: an internal path (`/help/fees`, never the
 * protocol-relative `//host`), an in-page fragment (`#fees`), an absolute `https:` / `http:` URL, or
 * a `mailto:` / `tel:` address. Everything else — `javascript:`, `data:`, a bare relative `fees` whose
 * target depends on the page it lands on — is refused.
 */
export function isSafeHref(href: string): boolean {
	if (href.length === 0 || /\s/.test(href)) return false;
	if (href.startsWith("#")) return href.length > 1;
	if (href.startsWith("/")) return !href.startsWith("//") && !href.startsWith("/\\");
	return /^(https?:\/\/[^/]|mailto:[^@\s]+@|tel:\+?[0-9])/i.test(href);
}

/** Whether `href` leaves the platform (an absolute `http(s):` URL). */
export function isExternalHref(href: string): boolean {
	return /^https?:\/\//i.test(href);
}

/**
 * Whether `src` is an image source the renderer may emit: a same-origin path (`/test_images/…`, a
 * storage URL the app proxies) or an absolute `https:` URL (`https://placehold.co/…`, already allowed
 * by the CSP `img-src`).
 */
export function isSafeImageSrc(src: string): boolean {
	if (/\s/.test(src)) return false;
	if (src.startsWith("/")) return !src.startsWith("//");
	return /^https:\/\/[^/]/i.test(src);
}

/** A link target, validated by {@link isSafeHref}. */
export const SafeHrefSchema = z.string().refine(isSafeHref, {
	message: "Unsafe or relative link — use /internal/path, #fragment, https://, mailto: or tel:",
});

/** An image source, validated by {@link isSafeImageSrc}. */
export const SafeImageSrcSchema = z.string().refine(isSafeImageSrc, {
	message: "Image src must be a same-origin /path or an https:// URL",
});
// #endregion

// #region Inline runs
/**
 * One inline run. A bare string is shorthand for `{ type: "text" }`, so the common case reads like
 * prose: `["Funds are held in ", { type: "strong", text: "escrow" }, " until you approve."]`.
 * Runs are flat by design — a link carries its own text — which is the whole formatting vocabulary
 * legal, help and changelog copy needs, and keeps every run renderable by one `switch`.
 */
export const InlineRunSchema = z.union([
	z.string(),
	z.object({ type: z.literal("text"), text: z.string() }),
	z.object({ type: z.literal("strong"), text: z.string().min(1) }),
	z.object({ type: z.literal("em"), text: z.string().min(1) }),
	z.object({ type: z.literal("code"), text: z.string().min(1) }),
	z.object({ type: z.literal("link"), href: SafeHrefSchema, text: z.string().min(1) }),
]);
/** One inline run (see {@link InlineRunSchema}). */
export type InlineRun = z.infer<typeof InlineRunSchema>;

/**
 * Inline content: a plain string, or a sequence of {@link InlineRun}s. Every text-bearing field of a
 * node (a paragraph, a list item, a table cell, a quote) takes this shape.
 */
export const InlineContentSchema = z.union([z.string(), z.array(InlineRunSchema)]);
/** Inline content (see {@link InlineContentSchema}). */
export type InlineContent = z.infer<typeof InlineContentSchema>;
// #endregion

// #region Block nodes
/** A paragraph. */
export const ParagraphNodeSchema = z.object({
	type: z.literal("p"),
	content: InlineContentSchema,
});
/** A paragraph node. */
export type ParagraphNode = z.infer<typeof ParagraphNodeSchema>;

/**
 * An anchor id: lower-case kebab (`fair-exit`, `1-4-0`). Ids are part of a page's public address —
 * a shared `#fees` link must keep working — so they are validated, never derived silently from an
 * arbitrary string.
 */
export const AnchorIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
	message: "Anchor ids are lower-case kebab: letters, digits and single hyphens",
});

/**
 * A sub-heading inside a section (sections own the `h2`). `id` pins the anchor; omitted, it is
 * slugified from `text` and de-duplicated across the whole document (`anchorDoc`).
 */
export const HeadingNodeSchema = z.object({
	type: z.literal("h3"),
	text: z.string().min(1),
	id: AnchorIdSchema.optional(),
});
/** A sub-heading node. */
export type HeadingNode = z.infer<typeof HeadingNodeSchema>;

/** One list item: its inline content and an optional nested list. */
export interface ListItemObject {
	content: InlineContent;
	list?: ListNode;
}
/** One list item — a plain string, or {@link ListItemObject} when it carries runs or a nested list. */
export type ListItem = string | ListItemObject;
/** A list (unordered unless `ordered`), nestable through an item's `list`. */
export interface ListNode {
	type: "list";
	ordered?: boolean;
	items: ListItem[];
}

/** A list item object (see {@link ListItemObject}); nesting is through `list`. */
export const ListItemObjectSchema: z.ZodType<ListItemObject> = z.lazy(() =>
	z.object({
		content: InlineContentSchema,
		list: ListNodeSchema.optional(),
	})
);

/** A list item: a string or a {@link ListItemObjectSchema}. */
export const ListItemSchema: z.ZodType<ListItem> = z.lazy(() =>
	z.union([z.string().min(1), ListItemObjectSchema])
);

/** A list node. `ordered` renders `<ol>`; nested lists may switch kind. */
export const ListNodeSchema: z.ZodType<ListNode> = z.lazy(() =>
	z.object({
		type: z.literal("list"),
		ordered: z.boolean().optional(),
		items: z.array(ListItemSchema).min(1),
	})
);

/** A block quotation with an optional attribution line. */
export const QuoteNodeSchema = z.object({
	type: z.literal("quote"),
	content: InlineContentSchema,
	/** Who said it — rendered as the quote's `<cite>` line. */
	cite: z.string().min(1).optional(),
});
/** A quote node. */
export type QuoteNode = z.infer<typeof QuoteNodeSchema>;

/**
 * A pre-formatted code sample. `lang` is a label only (`http`, `json`, `sql`) — nothing is
 * highlighted or executed; omitted, the block is plain text.
 */
export const CodeNodeSchema = z.object({
	type: z.literal("code"),
	lang: z.string().regex(/^[a-z0-9+#.-]{1,24}$/i).optional(),
	text: z.string().min(1),
});
/** A code node. */
export type CodeNode = z.infer<typeof CodeNodeSchema>;

/**
 * A figure. `w` × `h` are the intrinsic pixel dimensions, written onto the `<img>` so the browser
 * reserves the box before the bytes arrive (zero layout shift). `alt` is required and non-empty:
 * editorial images carry meaning; a purely decorative one does not belong in a body.
 */
export const ImageNodeSchema = z.object({
	type: z.literal("image"),
	src: SafeImageSrcSchema,
	alt: z.string().min(1),
	w: z.number().int().positive(),
	h: z.number().int().positive(),
	caption: z.string().min(1).optional(),
});
/** An image node. */
export type ImageNode = z.infer<typeof ImageNodeSchema>;

/**
 * Callout tones. Each pairs a hue with a WORD (the default title) so the tone never rides on colour
 * alone under a colour-vision overlay: `note` (info), `tip` (success), `warning`, `important` (danger).
 */
export const CalloutTone = z.enum(["note", "tip", "warning", "important"]);
/** A callout tone. */
export type CalloutTone = z.infer<typeof CalloutTone>;

/** The default title each {@link CalloutTone} renders when a callout carries none. */
export const CALLOUT_TONE_LABEL: Readonly<Record<CalloutTone, string>> = {
	note: "Note",
	tip: "Tip",
	warning: "Warning",
	important: "Important",
};

/**
 * A simple block — a paragraph or a list. What a callout body and an FAQ answer hold: no headings
 * (they would enter the document outline from inside an aside) and no nested callouts.
 */
export const SimpleBlockSchema = z.union([ParagraphNodeSchema, ListNodeSchema]);
/** A simple block (see {@link SimpleBlockSchema}). */
export type SimpleBlock = ParagraphNode | ListNode;

/** An emphasised aside within the prose (`role="note"`). */
export const CalloutNodeSchema = z.object({
	type: z.literal("callout"),
	tone: CalloutTone,
	title: z.string().min(1).optional(),
	body: z.array(SimpleBlockSchema).min(1),
});
/** A callout node. */
export type CalloutNode = z.infer<typeof CalloutNodeSchema>;

/**
 * A data table. `head` is the column header row; every `rows` entry must have exactly as many cells.
 * `rowHeaders` renders each row's first cell as `<th scope="row">` (a fee schedule's row labels).
 */
export const TableNodeSchema = z.object({
	type: z.literal("table"),
	head: z.array(InlineContentSchema).min(1),
	rows: z.array(z.array(InlineContentSchema)).min(1),
	caption: z.string().min(1).optional(),
	rowHeaders: z.boolean().optional(),
}).superRefine((table, ctx) => {
	table.rows.forEach((row, i) => {
		if (row.length !== table.head.length) {
			ctx.addIssue({
				code: "custom",
				path: ["rows", i],
				message: `Row ${i + 1} has ${row.length} cells; the header has ${table.head.length}`,
			});
		}
	});
});
/** A table node. */
export type TableNode = z.infer<typeof TableNodeSchema>;

/** Every block a section body may hold. */
export type ContentNode =
	| ParagraphNode
	| HeadingNode
	| ListNode
	| QuoteNode
	| CodeNode
	| ImageNode
	| CalloutNode
	| TableNode;

/** The block-node AST (see {@link ContentNode}). */
export const ContentNodeSchema: z.ZodType<ContentNode> = z.union([
	ParagraphNodeSchema,
	HeadingNodeSchema,
	ListNodeSchema,
	QuoteNodeSchema,
	CodeNodeSchema,
	ImageNodeSchema,
	CalloutNodeSchema,
	TableNodeSchema,
]);

/** Every node `type`, in renderer order — the closed vocabulary the renderer must cover. */
export const CONTENT_NODE_TYPES = [
	"p",
	"h3",
	"list",
	"quote",
	"code",
	"image",
	"callout",
	"table",
] as const satisfies readonly ContentNode["type"][];
// #endregion
