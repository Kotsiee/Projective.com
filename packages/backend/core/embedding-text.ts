import type { ExploreItem } from "@projective/types/explore";

/**
 * embedding-text — the one text a discovery item is embedded from (Decision #179), and its hash.
 *
 * Pure and deterministic: the same item always yields the same text, so the backfill and the
 * post-commit re-embed agree, and the SHA-256 of the text decides whether a stored vector is still
 * current. The text is built from the public catalogue projection (`ExploreItem`) — exactly what a
 * visitor can read — in one order: type label · title · category · skills · tags · summary · search
 * description, plus the delivery model and window for a service. Tags and the search description are
 * a listing's {@link EmbeddingTerms} (Decision #217(f)); every other item has none.
 */

// #region Limits
const MAX_SUMMARY_CHARS = 1200;
const MAX_TEXT_CHARS = 2000;
const MAX_SKILLS = 12;
const MAX_TAGS = 10;
const DOCUMENT_PROMPT_TOKENS = 8;
// #endregion

const TYPE_LABEL: Record<ExploreItem["type"], string> = {
	services: "Service",
	products: "Product",
	articles: "Article",
	projects: "Project",
	freelancers: "Freelancer",
	teams: "Team",
	businesses: "Business",
	users: "Person",
};

function clean(value: string | null | undefined): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

function clip(text: string, max: number): string {
	if (text.length <= max) return text;
	const cut = text.slice(0, max);
	return (/[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut).trimEnd();
}

function categoryOf(item: ExploreItem): string {
	if (item.type === "services" || item.type === "products") return clean(item.category);
	if (item.type === "articles") return clean(item.topic);
	return "";
}

function skillsOf(item: ExploreItem): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const skill of item.skills) {
		const label = clean(skill.label);
		const key = label.toLowerCase();
		if (!label || seen.has(key)) continue;
		seen.add(key);
		out.push(label);
		if (out.length === MAX_SKILLS) break;
	}
	return out;
}

/** What a listing is found by beyond its card: its search tags and search-result description. */
export interface EmbeddingTerms {
	tags: readonly string[];
	seoDescription: string;
}

function tagsOf(terms: EmbeddingTerms | undefined): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of terms?.tags ?? []) {
		const tag = clean(raw);
		const key = tag.toLowerCase();
		if (!tag || seen.has(key)) continue;
		seen.add(key);
		out.push(tag);
		if (out.length === MAX_TAGS) break;
	}
	return out;
}

/** The text `item` is embedded from, with a listing's search terms when it has them. */
export function embeddingTextOf(item: ExploreItem, terms?: EmbeddingTerms): string {
	const parts = [`${TYPE_LABEL[item.type]}: ${clean(item.title)}`];
	const category = categoryOf(item);
	if (category) parts.push(`Category: ${category}`);
	const skills = skillsOf(item);
	if (skills.length > 0) parts.push(`Skills: ${skills.join(", ")}`);
	const tags = tagsOf(terms);
	if (tags.length > 0) parts.push(`Tags: ${tags.join(", ")}`);
	const summary = clip(clean(item.summary), MAX_SUMMARY_CHARS);
	if (summary) parts.push(summary);
	const seo = clean(terms?.seoDescription);
	if (seo && seo !== summary) parts.push(seo);
	if (item.type === "services") {
		parts.push(`Model: ${item.serviceType}`);
		const delivery = clean(item.delivery);
		if (delivery) parts.push(`Delivery: ${delivery}`);
	}
	return clip(parts.join(" · "), MAX_TEXT_CHARS);
}

/** Lower-case hex SHA-256 of `text` — the `embedding_hash` stored beside its vector. */
export async function embeddingHashOf(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * An ESTIMATE of the tokens one document costs (about four characters a token for English, plus the
 * document prompt). For the backfill's dry run and the batch planner; Voyage's `usage` is the truth.
 */
export function estimateEmbeddingTokens(text: string): number {
	return Math.ceil(text.length / 4) + DOCUMENT_PROMPT_TOKENS;
}
