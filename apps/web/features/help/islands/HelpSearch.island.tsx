import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useComputed, useSignal } from "@preact/signals";
import "../styles/help.css";
// The category and article pages' server-rendered Breadcrumb has no island of its own to carry it.
import "@ui/navigation/styles/breadcrumb.css";
import type { HelpCentreSearchResult } from "@projective/types/editorial";
import { Dialog, Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { Kbd } from "@projective/ui/utils";
import { isEditableTarget, isFocusSearchShortcut } from "@features/shell/core/shortcuts.ts";
import { HelpHit } from "../components/HelpHit.tsx";
import {
	groupResults,
	isNavigationKey,
	nextActive,
	withoutQuery,
	withQuery,
} from "../core/omnibar-model.ts";
import {
	browserStorage,
	clearRecentSearches,
	readRecentSearches,
	rememberSearch,
} from "../core/recent-searches.ts";

// #region Props
/** A common question the overlay offers while its field is empty and nothing was searched before. */
export interface HelpSearchSuggestion {
	title: string;
	href: string;
	categoryTitle: string;
}

/** Props for {@link HelpSearch}. */
export interface HelpSearchProps {
	/** `hero` — the hub's large field; `compact` — the category and article pages' bar. */
	variant: "hero" | "compact";
	/** The `?q=` the page was requested with, when it was (empty string included). */
	initialQuery?: string;
	/**
	 * The server's results for {@link HelpSearchProps.initialQuery}, rendered under the field as the
	 * page's own results until the island wakes — the search's no-JavaScript road (the hub only).
	 */
	initialResults?: HelpCentreSearchResult[];
	/** Offered while the field is empty and there are no recent searches. */
	suggestions?: HelpSearchSuggestion[];
}
// #endregion

/** Wait this long after the last keystroke before asking the server. */
const DEBOUNCE_MS = 140;

/** The server's answer: `{ ok, results }` (the flat service envelope). */
interface SearchBody {
	ok?: boolean;
	results?: HelpCentreSearchResult[];
}

/**
 * HelpSearch — the help centre's search (P2 §2). Two halves:
 *
 * - **The trigger**: a real `<form role="search" method="get" action="/help">`, so with no JavaScript
 *   a search is a page load of `/help?q=…` and the hub renders the results itself.
 * - **The overlay**: typing in the field, pressing Enter, clicking it, or pressing `/` anywhere on a
 *   help page (`isFocusSearchShortcut`, never inside a field) opens a `Dialog` (Decision #171) with a
 *   combobox and a listbox of hits grouped by category, matched words in `<mark>`. ↑ / ↓ move the
 *   active option (`aria-activedescendant`), Enter opens it, Escape closes. With an empty field it
 *   lists the last eight searches (`localStorage`, a per-viewer convenience) with Clear, else the
 *   common questions. The overlay is addressable: while open the address bar carries `?q=` (written
 *   with `replaceState`), a page requested with `?q=` opens it, and closing removes the parameter.
 *   Its panel has a fixed height and the results scroll inside it, so typing never moves it.
 */
export default function HelpSearch(props: HelpSearchProps): JSX.Element {
	const { variant, initialQuery, initialResults, suggestions = [] } = props;
	const open = useSignal(false);
	const query = useSignal(initialQuery ?? "");
	const results = useSignal<HelpCentreSearchResult[]>(initialResults ?? []);
	const answeredFor = useSignal<string | null>(initialResults ? (initialQuery ?? "").trim() : null);
	const status = useSignal<"idle" | "loading" | "error">("idle");
	const active = useSignal(-1);
	const recent = useSignal<string[]>([]);
	const hydrated = useSignal(false);
	const formRef = useRef<HTMLFormElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const abortRef = useRef<AbortController | null>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const base = variant === "hero" ? "hc-help-search" : "hc-help-search-bar";
	const ids = {
		trigger: `${base}-field`,
		title: `${base}-title`,
		input: `${base}-overlay-field`,
		list: `${base}-listbox`,
		status: `${base}-status`,
		option: (i: number) => `${base}-option-${i}`,
	};

	// #region Derived
	const trimmed = useComputed(() => query.value.trim());
	const groups = useComputed(() => groupResults(results.value));
	/** What the listbox offers right now: hits for a query, else recent searches or suggestions. */
	const options = useComputed(
		(): Array<{ kind: "hit" | "recent" | "suggestion"; value: string }> => {
			if (trimmed.value) {
				return groups.value.flatMap((g) =>
					g.items.map((i) => ({ kind: "hit" as const, value: i.result.href }))
				);
			}
			if (recent.value.length > 0) {
				return recent.value.map((q) => ({ kind: "recent" as const, value: q }));
			}
			return suggestions.map((s) => ({ kind: "suggestion" as const, value: s.href }));
		},
	);
	// #endregion

	// #region Searching
	function search(q: string): void {
		const clean = q.trim();
		globalThis.clearTimeout(timerRef.current);
		abortRef.current?.abort();
		if (!clean) {
			results.value = [];
			answeredFor.value = "";
			status.value = "idle";
			return;
		}
		if (answeredFor.value === clean) return;
		status.value = "loading";
		timerRef.current = globalThis.setTimeout(async () => {
			const controller = new AbortController();
			abortRef.current = controller;
			try {
				const res = await fetch(`/api/help/search?q=${encodeURIComponent(clean)}`, {
					headers: { accept: "application/json" },
					signal: controller.signal,
				});
				const body = await res.json() as SearchBody;
				if (controller.signal.aborted) return;
				if (!res.ok || !Array.isArray(body.results)) throw new Error("search failed");
				results.value = body.results;
				answeredFor.value = clean;
				active.value = -1;
				status.value = "idle";
			} catch (err) {
				if (controller.signal.aborted || (err as Error)?.name === "AbortError") return;
				status.value = "error";
			}
		}, DEBOUNCE_MS);
	}

	function writeAddress(q: string | null): void {
		try {
			const next = q === null ? withoutQuery(location.href) : withQuery(location.href, q);
			history.replaceState(history.state, "", next);
		} catch {
			// An address the history API refuses (a sandboxed frame) leaves the overlay working.
		}
	}

	function setQuery(q: string): void {
		query.value = q;
		active.value = -1;
		writeAddress(q);
		search(q);
	}
	// #endregion

	// #region Open and close
	function openOverlay(q: string = query.value): void {
		recent.value = readRecentSearches(browserStorage());
		query.value = q;
		active.value = -1;
		open.value = true;
		writeAddress(q);
		search(q);
	}

	function onVisibleChange(visible: boolean): void {
		if (visible) return;
		globalThis.clearTimeout(timerRef.current);
		abortRef.current?.abort();
		writeAddress(null);
		status.value = "idle";
	}

	function go(href: string): void {
		if (trimmed.value) recent.value = rememberSearch(browserStorage(), trimmed.value);
		location.assign(href);
	}

	function choose(index: number): void {
		const option = options.value[index];
		if (!option) return;
		if (option.kind === "recent") {
			setQuery(option.value);
			inputRef.current?.focus();
			return;
		}
		go(option.value);
	}
	// #endregion

	// #region Effects
	useEffect(() => {
		hydrated.value = true;
		recent.value = readRecentSearches(browserStorage());
		if (initialQuery !== undefined) openOverlay(initialQuery);
		return () => {
			globalThis.clearTimeout(timerRef.current);
			abortRef.current?.abort();
		};
	}, []);

	// "/" opens the overlay from anywhere on the page, but never from inside a field or behind a modal.
	useEffect(() => {
		function onKey(event: KeyboardEvent): void {
			if (open.value || !isFocusSearchShortcut(event)) return;
			if (isEditableTarget(event.target instanceof Element ? event.target : null)) return;
			const form = formRef.current;
			if (!form || form.closest("[inert]") || form.getClientRects().length === 0) return;
			event.preventDefault();
			openOverlay();
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, []);

	// The active option stays in view inside the scrolling body.
	useEffect(() => {
		const i = active.value;
		if (i < 0) return;
		document.getElementById(ids.option(i))?.scrollIntoView({ block: "nearest" });
	}, [active.value]);
	// #endregion

	// #region Handlers
	const onTriggerSubmit = (e: JSX.TargetedEvent<HTMLFormElement>) => {
		e.preventDefault();
		openOverlay();
	};
	const onTriggerInput = (e: JSX.TargetedEvent<HTMLInputElement>) => {
		openOverlay(e.currentTarget.value);
	};
	const onOverlaySubmit = (e: JSX.TargetedEvent<HTMLFormElement>) => {
		e.preventDefault();
		if (active.value >= 0) return choose(active.value);
		const first = groups.value[0]?.items[0]?.result;
		if (trimmed.value && first) go(first.href);
	};
	const onOverlayKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
		if (!isNavigationKey(e.key)) return;
		if ((e.key === "Home" || e.key === "End") && active.value < 0) return;
		e.preventDefault();
		active.value = nextActive(active.value, options.value.length, e.key);
	};
	// #endregion

	// #region Overlay body
	const resultCount = results.value.length;
	const statusText = !trimmed.value
		? ""
		: status.value === "loading"
		? "Searching…"
		: status.value === "error"
		? "Search isn't available right now."
		: answeredFor.value === trimmed.value
		? `${resultCount} ${resultCount === 1 ? "result" : "results"}`
		: "";

	function body(): JSX.Element {
		if (trimmed.value) {
			if (status.value === "error") {
				return (
					<div class="hc-results__empty">
						Search isn't available right now.{" "}
						<Button
							variant="link"
							label="Try again"
							onClick={() => {
								answeredFor.value = null;
								search(query.value);
							}}
						/>
					</div>
				);
			}
			if (answeredFor.value === trimmed.value && resultCount === 0) {
				return (
					<p class="hc-results__empty">
						No articles match “{trimmed.value}”. Try fewer words, or{" "}
						<a class="hc-link" href="/contact?intent=support">contact support</a>.
					</p>
				);
			}
			return (
				<div id={ids.list} role="listbox" aria-label="Help articles" ref={listRef}>
					{groups.value.map((group) => (
						<div
							key={group.category}
							role="group"
							class="hc-results__group"
							aria-labelledby={`${ids.list}-${group.category}`}
						>
							<p id={`${ids.list}-${group.category}`} class="hc-results__label">{group.title}</p>
							{group.items.map(({ result, index }) => (
								<HelpHit
									key={result.slug}
									result={result}
									role="option"
									id={ids.option(index)}
									active={active.value === index}
									onPointerMove={() => (active.value = index)}
									onClick={() => {
										recent.value = rememberSearch(browserStorage(), trimmed.value);
									}}
								/>
							))}
						</div>
					))}
				</div>
			);
		}

		if (recent.value.length > 0) {
			// The Clear control sits above the listbox, not inside it: a listbox holds options only.
			return (
				<>
					<div class="hc-palette__group-head">
						<p id={`${ids.list}-recent`} class="hc-results__label">Recent searches</p>
						<Button
							variant="text"
							size="sm"
							label="Clear"
							aria-label="Clear recent searches"
							onClick={() => {
								clearRecentSearches(browserStorage());
								recent.value = [];
								active.value = -1;
								inputRef.current?.focus();
							}}
						/>
					</div>
					<div
						id={ids.list}
						role="listbox"
						aria-labelledby={`${ids.list}-recent`}
						ref={listRef}
					>
						{recent.value.map((q, i) => (
							<div
								key={q}
								id={ids.option(i)}
								role="option"
								class="hc-hit"
								aria-selected={active.value === i ? "true" : "false"}
								onPointerMove={() => (active.value = i)}
								onClick={() => choose(i)}
							>
								<span class="hc-hit__title">{q}</span>
							</div>
						))}
					</div>
				</>
			);
		}

		if (suggestions.length > 0) {
			return (
				<div id={ids.list} role="listbox" aria-label="Common questions" ref={listRef}>
					<div role="group" aria-labelledby={`${ids.list}-common`}>
						<p id={`${ids.list}-common`} class="hc-results__label">Common questions</p>
						{suggestions.map((s, i) => (
							<a
								key={s.href}
								id={ids.option(i)}
								role="option"
								class="hc-hit"
								href={s.href}
								tabIndex={-1}
								aria-selected={active.value === i ? "true" : "false"}
								onPointerMove={() => (active.value = i)}
							>
								<span class="hc-hit__title">{s.title}</span>
								<span class="hc-hit__snippet">{s.categoryTitle}</span>
							</a>
						))}
					</div>
				</div>
			);
		}
		return <p class="hc-results__empty">Type to search every help article.</p>;
	}
	// #endregion

	const showFallback = !hydrated.value && initialResults !== undefined &&
		(initialQuery ?? "").trim().length > 0;
	const activeId = active.value >= 0 && options.value[active.value]
		? ids.option(active.value)
		: undefined;
	const expanded = options.value.length > 0;

	return (
		<div class={`hc-omni hc-omni--${variant}`}>
			<form
				ref={formRef}
				class="hc-omni__form"
				role="search"
				aria-label="Help centre"
				method="get"
				action="/help"
				onSubmit={onTriggerSubmit}
			>
				<label class="ui-visually-hidden" for={ids.trigger}>Search the help centre</label>
				<div class="hc-omni__bar">
					<span class="hc-omni__glyph" aria-hidden="true">
						<Icon name="search" />
					</span>
					<input
						id={ids.trigger}
						class="hc-omni__input"
						type="search"
						name="q"
						value={query.value}
						placeholder={variant === "hero"
							? "Search for answers, like “fund a stage”"
							: "Search help"}
						autocomplete="off"
						enterKeyHint="search"
						onInput={onTriggerInput}
						onClick={() => openOverlay()}
					/>
					<Kbd class="hc-omni__kbd" size="sm">/</Kbd>
					<Tooltip content="Search">
						<Button
							class="hc-omni__submit"
							type="submit"
							variant="text"
							severity="secondary"
							size={variant === "hero" ? "md" : "sm"}
							iconOnly
							icon={<Icon name="search" />}
							aria-label="Search"
						/>
					</Tooltip>
				</div>
			</form>

			{showFallback && (
				<section class="hc-results" aria-labelledby={`${base}-fallback`}>
					<h2 id={`${base}-fallback`} class="hc-section__title">
						Results for “{(initialQuery ?? "").trim()}”
					</h2>
					{initialResults!.length === 0
						? (
							<p class="hc-results__empty">
								No articles match. Try fewer words, or{" "}
								<a class="hc-link" href="/contact?intent=support">contact support</a>.
							</p>
						)
						: groupResults(initialResults!).map((group) => (
							<div key={group.category} class="hc-results__group">
								<h3 class="hc-results__label">{group.title}</h3>
								<ul class="hc-results__list">
									{group.items.map(({ result }) => (
										<li key={result.slug}>
											<HelpHit result={result} />
										</li>
									))}
								</ul>
							</div>
						))}
				</section>
			)}

			<Dialog
				visible={open}
				position="top"
				width="var(--overlay-w-lg)"
				height="var(--overlay-h-md)"
				labelledBy={ids.title}
				initialFocusRef={inputRef}
				onVisibleChange={onVisibleChange}
				class="hc-palette"
				headerTemplate={({ close }) => (
					<>
						<h2 id={ids.title} class="ui-visually-hidden">Search the help centre</h2>
						<form
							class="hc-palette__form"
							role="search"
							aria-label="Help articles"
							onSubmit={onOverlaySubmit}
						>
							<label class="ui-visually-hidden" for={ids.input}>Search the help centre</label>
							<span class="hc-palette__glyph" aria-hidden="true">
								<Icon name="search" />
							</span>
							<input
								ref={inputRef}
								id={ids.input}
								class="hc-palette__input"
								type="search"
								role="combobox"
								aria-autocomplete="list"
								aria-expanded={expanded}
								aria-controls={expanded ? ids.list : undefined}
								aria-activedescendant={activeId}
								aria-describedby={ids.status}
								value={query.value}
								placeholder="Search for answers"
								autocomplete="off"
								enterKeyHint="go"
								onInput={(e) => setQuery(e.currentTarget.value)}
								onKeyDown={onOverlayKeyDown}
							/>
						</form>
						<Button variant="text" severity="secondary" size="sm" label="Close" onClick={close} />
					</>
				)}
				footer={
					<ul class="hc-palette__hints" aria-hidden="true">
						<li class="hc-palette__hint">
							<Kbd keys={["↑", "↓"]} separator="" size="sm" /> to move
						</li>
						<li class="hc-palette__hint">
							<Kbd size="sm">Enter</Kbd> to open
						</li>
						<li class="hc-palette__hint">
							<Kbd size="sm">Esc</Kbd> to close
						</li>
					</ul>
				}
			>
				<p id={ids.status} class="hc-palette__status" role="status" aria-live="polite">
					{statusText}
				</p>
				{body()}
			</Dialog>
		</div>
	);
}
