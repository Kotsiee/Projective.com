import "../styles/search-suggest.css";
import type { RefObject, VNode } from "preact";
import type { Signal } from "@preact/signals";
import { AutoComplete, type AutoCompleteSection } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { Option } from "@projective/ui/fields";
import { useSearchSuggest } from "../hooks/useSearchSuggest.ts";
import {
	clearRecentSearches,
	loadRecentSearches,
	matchRecent,
	recentSearches,
	recordSearch,
	removeRecentSearch,
} from "../core/search-history.ts";
import { entityHref, type HrefContext, profileHref } from "../core/routing.ts";
import type {
	ExploreCategory,
	ExploreEntity,
	SuggestHandle,
	SuggestHit,
	SuggestTerm,
} from "../types/explore-types.ts";

/**
 * SearchSuggest — the typeahead every discovery bar shares (the shell's `NavSearchBar`, the
 * marketing `SearchBar`, the results page's `ResultsHeader`). It replaces the bar's `<input>` with
 * the library {@link AutoComplete} in `bare` + `freeText` mode, so the host keeps its own pill, scope
 * selector and submit, and the panel aligns to the whole pill (`anchorRef`).
 *
 * Empty field: Recent (removable, with Clear) and Trending. Typing: matching Recent, Top hits,
 * People and Skills & categories from `/api/explore/suggest`, skeleton rows while loading, and an
 * in-panel Retry on failure. Choosing a term runs `onSearch`; a hit or a person navigates. Enter with
 * no active row submits the host form untouched. Dumb island — data through `useSearchSuggest` only.
 */

// #region Rows
type Entry =
	| { kind: "recent"; term: string }
	| { kind: "trending"; term: string }
	| { kind: "term"; term: SuggestTerm }
	| { kind: "hit"; hit: SuggestHit }
	| { kind: "handle"; handle: SuggestHandle }
	| { kind: "clear-recent" }
	| { kind: "retry"; message: string };

const ENTITY_LABEL: Record<ExploreEntity, string> = {
	users: "Person",
	freelancers: "Freelancer",
	teams: "Team",
	businesses: "Business",
	services: "Service",
	projects: "Project",
	products: "Product",
	articles: "Article",
};

const KIND_LABEL: Record<SuggestHandle["kind"], string> = {
	user: "Person",
	freelancer: "Freelancer",
	team: "Team",
	business: "Business",
};

function initials(name: string): string {
	return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}
// #endregion

export interface SearchSuggestProps {
	/** The bar's text, two-way: the host reads it on submit. */
	value: Signal<string>;
	/** The scope the bar is searching in. */
	scope: ExploreCategory;
	/** The input's class in the host pill. */
	inputClass: string;
	/** The pill the panel aligns to and matches the width of. */
	anchorRef: RefObject<HTMLElement>;
	"aria-label": string;
	placeholder?: string;
	name?: string;
	/** Deep-link shape for hits (a profile page keeps them in its namespace). */
	ctx?: HrefContext;
	/** Run a search for a term the reader picked. */
	onSearch: (term: string) => void;
}

export default function SearchSuggest(
	{ value, scope, inputClass, anchorRef, placeholder, name, ctx, onSearch, ...rest }:
		SearchSuggestProps,
) {
	const suggest = useSearchSuggest(scope);
	const entries = new Map<string, Entry>();

	const add = (key: string, label: string, entry: Entry): Option => {
		entries.set(key, entry);
		return { label, value: key };
	};

	const typed = suggest.query.value.trim();
	const recent = matchRecent(recentSearches.value, typed);
	const sections: AutoCompleteSection[] = [];

	if (recent.length > 0) {
		const items = recent.map((t) => add(`recent:${t}`, t, { kind: "recent", term: t }));
		if (!typed) {
			items.push(add("action:clear-recent", "Clear recent searches", { kind: "clear-recent" }));
		}
		sections.push({
			id: "recent",
			label: "Recent",
			items,
			removable: (opt) => entries.get(String(opt.value))?.kind === "recent",
		});
	}

	let loading = false;
	if (!typed) {
		const trending = suggest.trending.value;
		loading = suggest.trendingStatus.value === "loading";
		if (trending?.length) {
			sections.push({
				id: "trending",
				label: "Trending",
				items: trending.map((t) => add(`trend:${t}`, t, { kind: "trending", term: t })),
			});
		}
	} else {
		const status = suggest.status.value;
		const data = suggest.data.value;
		loading = status === "loading" && data === null;
		if (status === "error") {
			const message = suggest.error.value ?? "Suggestions are unavailable right now.";
			sections.push({
				id: "error",
				label: "Suggestions",
				items: [add("action:retry", message, { kind: "retry", message })],
			});
		} else if (data) {
			if (data.hits.length) {
				sections.push({
					id: "hits",
					label: "Top hits",
					items: data.hits.map((h) =>
						add(`hit:${h.type}:${h.id}`, h.title, { kind: "hit", hit: h })
					),
				});
			}
			if (data.handles.length) {
				sections.push({
					id: "people",
					label: "People",
					items: data.handles.map((h) =>
						add(`handle:${h.handle}`, h.name, { kind: "handle", handle: h })
					),
				});
			}
			if (data.terms.length) {
				sections.push({
					id: "terms",
					label: "Skills & categories",
					items: data.terms.map((t) => add(`term:${t.label}`, t.label, { kind: "term", term: t })),
				});
			}
		}
	}

	// #region Actions
	function search(term: string): void {
		value.value = term;
		suggest.setQuery(term);
		recordSearch(term);
		onSearch(term);
	}

	function select(opt: Option): boolean | void {
		const entry = entries.get(String(opt.value));
		switch (entry?.kind) {
			case "recent":
			case "trending":
				return search(entry.term);
			case "term":
				return search(entry.term.label);
			case "hit":
				if (typed) recordSearch(typed);
				globalThis.location.href = entityHref(entry.hit, ctx);
				return;
			case "handle":
				globalThis.location.href = profileHref(entry.handle.handle);
				return;
			case "clear-recent":
				clearRecentSearches();
				return true;
			case "retry":
				suggest.retry();
				return true;
		}
	}

	function remove(opt: Option): void {
		const entry = entries.get(String(opt.value));
		if (entry?.kind === "recent") removeRecentSearch(entry.term);
	}

	function onOpen(): void {
		loadRecentSearches();
		if (suggest.query.peek() !== value.peek()) suggest.setQuery(value.peek());
		if (!value.peek().trim()) suggest.prime();
	}
	// #endregion

	// #region Row templates
	function template(opt: Option): VNode {
		const entry = entries.get(String(opt.value));
		switch (entry?.kind) {
			case "recent":
				return <Row icon="history" title={entry.term} />;
			case "trending":
				return <Row icon="arrow-up-right" title={entry.term} />;
			case "term":
				return (
					<Row
						icon="tag"
						title={entry.term.label}
						meta={`${entry.term.kind === "skill" ? "Skill" : "Category"} · ${entry.term.count} ${
							entry.term.count === 1 ? "listing" : "listings"
						}`}
					/>
				);
			case "hit":
				return (
					<Row
						media={entry.hit.media}
						icon="search"
						title={entry.hit.title}
						meta={`${ENTITY_LABEL[entry.hit.type]} · ${entry.hit.ownerName}`}
					/>
				);
			case "handle":
				return (
					<Row
						avatar={entry.handle.avatar}
						fallback={initials(entry.handle.name)}
						title={entry.handle.name}
						meta={`${entry.handle.handle} · ${KIND_LABEL[entry.handle.kind]}`}
					/>
				);
			case "clear-recent":
				return <span class="ex-suggest__action">Clear recent searches</span>;
			case "retry":
				return (
					<span class="ex-suggest__retry">
						<span class="ex-suggest__retry-text">{entry.message}</span>
						<span class="ex-suggest__action">Try again</span>
					</span>
				);
			default:
				return <span>{opt.label}</span>;
		}
	}
	// #endregion

	return (
		<AutoComplete
			bare
			freeText
			openOnFocus
			value={value}
			sections={sections}
			loading={loading}
			emptyMessage={typed ? `Press Enter to search for “${typed}”` : null}
			minLength={0}
			delay={0}
			name={name}
			placeholder={placeholder}
			inputClass={inputClass}
			anchorRef={anchorRef}
			itemTemplate={template}
			onComplete={(q) => suggest.setQuery(q)}
			onOpen={onOpen}
			onSelect={select}
			onRemove={remove}
			removeLabel={(opt) => `Remove “${opt.label}” from recent searches`}
			aria-label={rest["aria-label"]}
		/>
	);
}

// #region Row
function Row(
	{ icon, media, avatar, fallback, title, meta }: {
		icon?: "history" | "arrow-up-right" | "tag" | "search";
		media?: string;
		avatar?: string;
		fallback?: string;
		title: string;
		meta?: string;
	},
): VNode {
	let lead: VNode;
	if (avatar !== undefined) {
		lead = avatar
			? <img class="ex-suggest__avatar" src={avatar} alt="" loading="lazy" />
			: <span class="ex-suggest__avatar ex-suggest__avatar--initials">{fallback}</span>;
	} else if (media) {
		lead = <img class="ex-suggest__thumb" src={media} alt="" loading="lazy" />;
	} else {
		lead = (
			<span class="ex-suggest__glyph">
				<Icon name={icon ?? "search"} size="xs" />
			</span>
		);
	}
	return (
		<span class="ex-suggest__row">
			{lead}
			<span class="ex-suggest__text">
				<span class="ex-suggest__title">{title}</span>
				{meta && <span class="ex-suggest__meta">{meta}</span>}
			</span>
		</span>
	);
}
// #endregion
