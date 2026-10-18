/**
 * Editorial content — the Zod SSOT for the documents the public surfaces render (legal, help,
 * changelog, articles): the body AST, the document core every surface extends, anchors and the
 * table of contents, and plain-text projections. Product copy lives in typed content modules
 * (`apps/web/features/<surface>/core/content/*.ts`) validated against these schemas, never in
 * markdown and never as raw HTML.
 *
 * @module
 */
export {
	AnchorIdSchema,
	CALLOUT_TONE_LABEL,
	type CalloutNode,
	CalloutNodeSchema,
	CalloutTone,
	type CodeNode,
	CodeNodeSchema,
	CONTENT_NODE_TYPES,
	type ContentNode,
	ContentNodeSchema,
	type DefinitionItem,
	DefinitionItemSchema,
	type DefinitionListNode,
	DefinitionListNodeSchema,
	type HeadingNode,
	HeadingNodeSchema,
	type ImageNode,
	ImageNodeSchema,
	type InlineContent,
	InlineContentSchema,
	type InlineRun,
	InlineRunSchema,
	isExternalHref,
	isSafeHref,
	isSafeImageSrc,
	type ListItem,
	type ListItemObject,
	ListItemObjectSchema,
	ListItemSchema,
	type ListMarker,
	ListMarkerSchema,
	type ListNode,
	ListNodeSchema,
	type ParagraphNode,
	ParagraphNodeSchema,
	type QuoteNode,
	QuoteNodeSchema,
	SafeHrefSchema,
	SafeImageSrcSchema,
	type SimpleBlock,
	SimpleBlockSchema,
	type TableNode,
	TableNodeSchema,
} from "./nodes.ts";
export {
	checkDocAnchors,
	CONTENT_AUDIENCE_LABEL,
	ContentAudience,
	type ContentAuthor,
	ContentAuthorSchema,
	type ContentImage,
	ContentImageSchema,
	ContentSlugSchema,
	defineContent,
	type Doc,
	DocBaseSchema,
	DocSchema,
	type DocSection,
	DocSectionSchema,
	type DocVersion,
	DocVersionSchema,
	type FaqItem,
	FaqItemSchema,
	IsoDateSchema,
	SemverSchema,
} from "./doc.ts";
export {
	anchorDoc,
	type AnchorDocOptions,
	type AnchoredDoc,
	type AnchoredHeadingNode,
	type AnchoredNode,
	type AnchoredSection,
	anchorNodes,
	type AnchorRegistry,
	createAnchorRegistry,
	docToc,
	type DocTocOptions,
	flattenToc,
	RESERVED_ANCHOR_IDS,
	slugify,
	type TocEntry,
} from "./anchors.ts";
export * from "./legal.ts";
export {
	docText,
	formatContentDate,
	inlineText,
	nodesText,
	nodeText,
	readingMinutes,
	runText,
	wordCount,
} from "./text.ts";
// The sample document is NOT re-exported here: it parses at import time, and a barrel import from an
// island would carry it into the client bundle. Tests reach it at `@projective/types/content/fixtures`.
// Client-reachable code that needs only the plain-text projections imports
// `@projective/types/content/text`, which builds no schema, instead of this barrel.
