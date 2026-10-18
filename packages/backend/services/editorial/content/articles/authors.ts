import type { EditorialArticleAuthor } from "@projective/types/editorial";

/**
 * The bylines Projective's articles are written under (P6, Decision #271).
 *
 * One honest team byline, not invented people: no named member of staff has been given to the
 * editorial work yet, so every article is credited to the editorial team as a whole, with the
 * platform's own brandmark as its picture and no profile link. A named author is a new record here
 * (`kind: "person"`, their `/@handle` as `href`) — never a rename of this one, whose slug is
 * permanent once seeded.
 */
export const PROJECTIVE_EDITORIAL: EditorialArticleAuthor = {
	slug: "projective-editorial",
	name: "Projective Editorial",
	role: "Editorial team",
	kind: "team",
	bio:
		"Articles from the people building Projective, written from how the platform actually works: its stages, its escrow and the rules that hold them together.",
	avatar: { src: "/logo.svg", alt: "The Projective brandmark", w: 640, h: 640 },
	href: null,
};

/** Every author, in seed order. */
export const ARTICLE_AUTHOR_RECORDS: readonly EditorialArticleAuthor[] = [PROJECTIVE_EDITORIAL];
