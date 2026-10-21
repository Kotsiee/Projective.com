import type { JSX, Ref } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/files-chrome.css";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { InputText, SortControl } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { AssetBreadcrumbs } from "../components/AssetBreadcrumbs.tsx";
import { FilesFilterPanel } from "../components/FilesFilterPanel.tsx";
import {
	breadcrumbsFor,
	type FolderRouting,
	locationHref,
	rootChildren,
	scopeLabel,
} from "../core/asset-model.ts";
import {
	commitFiles,
	crumbs,
	currentPath,
	facetCount,
	query,
	seeded,
	sortDir,
	sortKey,
	total,
	tree,
} from "../core/files-state.ts";
import type { FileScope, FileSortKey } from "../types/file-types.ts";

/**
 * FilesHeaderBand — the sticky strip above the `/files` workspace.
 *
 * It answers **where am I** and **how is this set narrowed**, and nothing else. The location trail,
 * search, the type · sharing · source filter and the sort module live here rather than above the grid
 * because the body's remit on this surface is viewing and selecting data; a filter dropdown on top of
 * a file table makes the table's width negotiable, and the table's width is the whole point.
 *
 * Every control writes shared intent into `files-state` and then calls {@link commitFiles} — the BODY
 * is the single fetch owner, so there is exactly one request path and this band can never describe a
 * set it did not cause. Before the body hydrates, `commitFiles` is a no-op and the SSR paint is already
 * correct, so nothing here has to guard for it.
 *
 * Popovers open through `Popover`'s `trigger` render-prop: a `targetRef` trigger that also flips
 * `open` in its own handler toggles twice per press and never opens. Search is an inline field where
 * the band has room and an icon popover where it does not; both render and CSS reveals one.
 *
 * ## The band is the surface's mobile navigation
 *
 * Below 768px `middle-nav.css` removes the lane entirely, and on `/files` the lane is the ONLY route
 * between the library, the mounted engagements and the connected drives. The `Browse` control is
 * revealed at exactly that width and carries the same tree the lane holds: the duty TRANSFERS, it does
 * not duplicate.
 *
 * Dumb island: no data access of its own — the tree and the trail come from `files-state`, published
 * by the regions that fetched them.
 */

// #region Props
export interface FilesHeaderBandProps {
	/** The route base every deep link in this scope hangs off. */
	base: string;
	scope: FileScope;
	subjectId: string | null;
	/** The folder path within the scope; `[]` is the scope root. */
	segments: string[];
	/** What to call this library — "My files", or the acting workspace's handle. */
	ownerLabel: string;
	/**
	 * Where a folder path lives in the address: under {@link base} (the default) or in its `?path=`
	 * query (a console drive, whose `[module]` route is one segment deep).
	 */
	routing?: FolderRouting;
}
// #endregion

// #region Vocabulary
const SORT_OPTIONS: readonly { value: FileSortKey; label: string }[] = [
	{ value: "name", label: "Name" },
	{ value: "date", label: "Date added" },
	{ value: "size", label: "Size" },
	{ value: "type", label: "Type" },
	{ value: "sender", label: "Added by" },
];

const SEARCH_DEBOUNCE_MS = 200;

const SEARCH_LABEL = "Search files in this folder";
// #endregion

export default function FilesHeaderBand(props: FilesHeaderBandProps): JSX.Element {
	const routing = props.routing ?? "path";
	const browseOpen = useSignal(false);
	const filterOpen = useSignal(false);
	const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	// #region Intent
	/**
	 * Search debounces; every other control commits immediately. A keystroke is not a decision —
	 * committing each one would issue a request per character and let an early, slower response land
	 * after a later one. A filter or a sort IS a decision and gets the round trip it asked for.
	 */
	function onSearch(value: string): void {
		query.value = value;
		if (debounce.current !== undefined) clearTimeout(debounce.current);
		debounce.current = setTimeout(() => {
			debounce.current = undefined;
			commitFiles();
		}, SEARCH_DEBOUNCE_MS);
	}

	function onSearchKey(event: JSX.TargetedKeyboardEvent<HTMLInputElement>): void {
		if (event.key !== "Enter" || debounce.current === undefined) return;
		clearTimeout(debounce.current);
		debounce.current = undefined;
		commitFiles();
	}

	useEffect(() => () => {
		if (debounce.current !== undefined) clearTimeout(debounce.current);
	}, []);

	function navigate(segments: string[]): void {
		currentPath.value = segments;
		globalThis.history?.pushState(
			{},
			"",
			locationHref(props.base, segments, routing, globalThis.location?.search ?? ""),
		);
		browseOpen.value = false;
		commitFiles();
	}
	// #endregion

	// #region Trail
	/**
	 * The server's trail wins when it has one; otherwise the pure model builds the same shape from the
	 * URL and whatever tree is loaded. Both branches are total — the local one falls back to decoded
	 * segments where it has no folder name to use, which is exactly what `breadcrumbsFor` documents.
	 */
	const trail = useComputed(() =>
		crumbs.value.length > 0 ? crumbs.value : breadcrumbsFor(props.segments, {
			base: props.base,
			rootLabel: props.ownerLabel,
			tree: rootChildren(tree.value),
			routing,
		})
	);
	// #endregion

	const scopeName = props.scope === "hub" ? props.ownerLabel : scopeLabel(props.scope);
	const facets = facetCount.value;

	/**
	 * Gated on `seeded`, never on `total > 0`: before the body has applied a page the total is 0
	 * because nothing has been counted, not because nothing matched.
	 */
	const matchNote = seeded.value && query.value.trim()
		? `${total.value} ${total.value === 1 ? "file matches" : "files match"}`
		: "";

	function searchField(): JSX.Element {
		return (
			<InputText
				value={query}
				type="search"
				variant="bare"
				size="sm"
				block
				placeholder="Search files"
				aria-label={SEARCH_LABEL}
				autoComplete="off"
				enterKeyHint="search"
				onValueChange={onSearch}
				onKeyDown={onSearchKey}
				start={
					<span class="fh-headerband__searchicon" aria-hidden="true">
						<Icon name="search" size="sm" />
					</span>
				}
			/>
		);
	}

	return (
		<div class="fh-headerband">
			<span class="fh-headerband__browse">
				<Tooltip content="Browse file locations" placement="bottom">
					<Popover
						open={browseOpen}
						placement="bottom-start"
						label="File locations"
						trigger={(api) => (
							<button
								type="button"
								class="fh-headerband__browse-trigger"
								ref={api.ref as Ref<HTMLButtonElement>}
								aria-label="Browse file locations"
								aria-haspopup="dialog"
								aria-expanded={api.expanded}
								aria-controls={api.expanded ? api.panelId : undefined}
								onClick={api.toggle}
							>
								<Icon name="folder" />
								<span class="fh-headerband__browse-name">Browse</span>
								<Icon name="chevron-down" class="fh-headerband__caret" />
							</button>
						)}
					>
						<nav class="fh-headerband__menu" aria-label="File locations">
							<button
								type="button"
								class="fh-headerband__menu-item"
								aria-current={props.segments.length === 0 ? "location" : undefined}
								onClick={() => navigate([])}
							>
								<Icon name="folder" class="fh-headerband__menu-glyph" />
								{props.ownerLabel}
							</button>
							{rootChildren(tree.value).map((node) => (
								<button
									key={node.segment}
									type="button"
									class="fh-headerband__menu-item"
									aria-current={props.segments[0] === node.segment ? "location" : undefined}
									onClick={() => navigate([node.segment])}
								>
									<Icon name="folder" class="fh-headerband__menu-glyph" />
									{node.label}
								</button>
							))}
						</nav>
					</Popover>
				</Tooltip>
			</span>

			<span class="fh-headerband__identity">
				{trail.value[0]?.label !== scopeName && (
					<span class="fh-headerband__scope">{scopeName}</span>
				)}
				<AssetBreadcrumbs
					crumbs={trail.value}
					base={props.base}
					routing={routing}
					onNavigate={navigate}
					aria-label="File path"
				/>
			</span>

			<span class="fh-headerband__controls">
				<span class="fh-headerband__search">{searchField()}</span>

				<span class="fh-headerband__searchtoggle">
					<Tooltip content="Search files" placement="bottom">
						<Popover
							placement="bottom-end"
							label="Search files"
							trigger={(api) => (
								<button
									type="button"
									class="fh-headerband__icon"
									ref={api.ref as Ref<HTMLButtonElement>}
									data-on={query.value ? "true" : undefined}
									aria-label={query.value ? `Search: ${query.value}` : SEARCH_LABEL}
									aria-haspopup="dialog"
									aria-expanded={api.expanded}
									aria-controls={api.expanded ? api.panelId : undefined}
									onClick={api.toggle}
								>
									<Icon name="search" />
								</button>
							)}
						>
							<div class="fh-headerband__panel">{searchField()}</div>
						</Popover>
					</Tooltip>
				</span>

				<Tooltip content="Filter files" placement="bottom">
					<Popover
						open={filterOpen}
						placement="bottom-end"
						label="Filter files"
						trigger={(api) => (
							<button
								type="button"
								class="fh-headerband__icon"
								ref={api.ref as Ref<HTMLButtonElement>}
								data-on={facets > 0 ? "true" : undefined}
								aria-label={facets > 0 ? `Filter files, ${facets} active` : "Filter files"}
								aria-haspopup="dialog"
								aria-expanded={api.expanded}
								aria-controls={api.expanded ? api.panelId : undefined}
								onClick={api.toggle}
							>
								<Icon name="filter" />
								{facets > 0 && <span class="fh-headerband__dot" aria-hidden="true" />}
							</button>
						)}
					>
						<FilesFilterPanel onCleared={() => (filterOpen.value = false)} />
					</Popover>
				</Tooltip>

				<span class="fh-headerband__sort">
					<SortControl
						options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
						value={sortKey.value}
						direction={sortDir.value}
						size="sm"
						aria-label="Sort files"
						onValueChange={(v) => {
							sortKey.value = v as FileSortKey;
							commitFiles();
						}}
						onDirectionChange={(d) => {
							sortDir.value = d;
							commitFiles();
						}}
					/>
				</span>
			</span>

			<span class="ui-visually-hidden" role="status">{matchNote}</span>
		</div>
	);
}
