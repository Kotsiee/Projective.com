import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/files-chrome.css";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { InputText, SortControl } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { AssetBreadcrumbs } from "../components/AssetBreadcrumbs.tsx";
import { SourceMark } from "../components/file-hub-glyphs.tsx";
import { assetHref, breadcrumbsFor, scopeLabel } from "../core/asset-model.ts";
import {
	clearFilesFilters,
	commitFiles,
	crumbs,
	currentPath,
	kindFilter,
	narrowed,
	query,
	seeded,
	sortDir,
	sortKey,
	sourceFilter,
	total,
	tree,
} from "../core/files-state.ts";
import {
	type AssetSource,
	type FileKind,
	type FileScope,
	type FileSortKey,
	sourceLabel,
} from "../types/file-types.ts";

/**
 * FilesHeaderBand — the sticky strip above the `/files` workspace.
 *
 * It answers **where am I** and **how is this set narrowed**, and nothing else. The location trail,
 * search, the kind/source filter and the sort module live here rather than above the grid because the
 * body's remit on this surface is viewing and selecting data; a filter dropdown on top of a file table
 * makes the table's width negotiable, and the table's width is the whole point.
 *
 * Every control writes shared intent into `files-state` and then calls {@link commitFiles} — the BODY
 * is the single fetch owner, so there is exactly one request path and this band can never describe a
 * set it did not cause. Before the body hydrates, `commitFiles` is a no-op and the SSR paint is already
 * correct, so nothing here has to guard for it.
 *
 * ## The band is the surface's mobile navigation
 *
 * Below 768px `middle-nav.css` removes the lane entirely, and on `/files` the lane is the ONLY route
 * between the library, the mounted engagements and the connected drives. The `Browse` control is
 * revealed at exactly that width and carries the same tree the lane holds: the duty TRANSFERS, it does
 * not duplicate. Above it the control is not rendered as a second permanent path to one destination.
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
}
// #endregion

// #region Vocabulary
/**
 * The kind filter's rows.
 *
 * Plain labelled rows rather than glyph-led ones: unlike a storage SOURCE — which has a real, unique
 * brand mark — most of these kinds would have to borrow a near-neighbour's glyph (`doc` and `pdf` both
 * resolving to a page, `code` and `archive` to a box), and a filter row whose mark does not distinguish
 * it from the row above is worse than a row with no mark at all.
 */
const KIND_ROWS: readonly { key: FileKind; label: string }[] = [
	{ key: "image", label: "Images" },
	{ key: "video", label: "Video" },
	{ key: "audio", label: "Audio" },
	{ key: "pdf", label: "PDFs" },
	{ key: "doc", label: "Documents" },
	{ key: "code", label: "Code" },
	{ key: "archive", label: "Archives" },
	{ key: "link", label: "Links" },
	{ key: "file", label: "Other files" },
];

/** The source filter's rows. `supabase` is the library itself — named for what a reader calls it. */
const SOURCE_ROWS: readonly AssetSource[] = [
	"supabase",
	"google_drive",
	"dropbox",
	"frameio",
	"s3",
	"link",
];

const SORT_OPTIONS: readonly { value: FileSortKey; label: string }[] = [
	{ value: "name", label: "Name" },
	{ value: "date", label: "Date added" },
	{ value: "size", label: "Size" },
	{ value: "type", label: "Type" },
	{ value: "sender", label: "Added by" },
];
// #endregion

export default function FilesHeaderBand(props: FilesHeaderBandProps): JSX.Element {
	const searchOpen = useSignal(false);
	const filterOpen = useSignal(false);
	const browseOpen = useSignal(false);
	const searchRef = useRef<HTMLButtonElement>(null);
	const filterRef = useRef<HTMLButtonElement>(null);
	const browseRef = useRef<HTMLButtonElement>(null);
	const debounce = useRef<number | undefined>(undefined);

	// #region Intent
	/**
	 * Search debounces; every other control commits immediately.
	 *
	 * A keystroke is not a decision — committing each one would issue a request per character and let
	 * an early, slower response land after a later one. A filter or a sort IS a decision and gets the
	 * round trip it asked for.
	 */
	function onSearch(value: string): void {
		query.value = value;
		if (debounce.current !== undefined) clearTimeout(debounce.current);
		debounce.current = setTimeout(() => commitFiles(), 250) as unknown as number;
	}

	useEffect(() => () => {
		if (debounce.current !== undefined) clearTimeout(debounce.current);
	}, []);

	function toggleKind(kind: FileKind): void {
		const set = kindFilter.value;
		kindFilter.value = set.includes(kind) ? set.filter((k) => k !== kind) : [...set, kind];
		commitFiles();
	}

	function toggleSource(source: AssetSource): void {
		const set = sourceFilter.value;
		sourceFilter.value = set.includes(source) ? set.filter((s) => s !== source) : [...set, source];
		commitFiles();
	}

	function navigate(segments: string[]): void {
		currentPath.value = segments;
		try {
			globalThis.history?.pushState({}, "", assetHref(props.base, segments));
		} catch { /* SSR / no history — non-fatal */ }
		browseOpen.value = false;
		commitFiles();
	}
	// #endregion

	// #region Trail
	/**
	 * The server's trail wins when it has one; otherwise the pure model builds the same shape from the
	 * URL and whatever tree is loaded.
	 *
	 * This is NOT an "is it loaded yet" test in disguise (the mistake this codebase has shipped twice):
	 * both branches are total and produce a complete, correct trail for the current path — the local
	 * one simply falls back to decoded segments where it has no folder name to use, which is exactly
	 * what `breadcrumbsFor` documents.
	 */
	const trail = useComputed(() =>
		crumbs.value.length > 0 ? crumbs.value : breadcrumbsFor(props.segments, {
			base: props.base,
			rootLabel: props.ownerLabel,
			tree: tree.value,
		})
	);

	const activeFilters = useComputed(() => kindFilter.value.length + sourceFilter.value.length);
	// #endregion

	const scopeName = props.scope === "hub" ? props.ownerLabel : scopeLabel(props.scope);

	return (
		<div class="fh-headerband">
			{
				/*
				 * Revealed by CSS only where the lane is not rendered. Both presentations ship in the markup
				 * and one is revealed — a width observer would paint the wrong one for a frame on every load.
				 */
			}
			<span class="fh-headerband__browse">
				<button
					type="button"
					class="fh-headerband__browse-trigger"
					ref={browseRef}
					aria-label="Browse file locations"
					aria-haspopup="menu"
					aria-expanded={browseOpen.value ? "true" : "false"}
					onClick={() => {
						browseOpen.value = !browseOpen.value;
					}}
				>
					<Icon name="folder" />
					<span class="fh-headerband__browse-name">Browse</span>
					<Icon name="chevron-down" class="fh-headerband__caret" />
				</button>
				<Popover open={browseOpen} targetRef={browseRef} placement="bottom-start">
					<div class="fh-headerband__menu" role="menu">
						<button
							type="button"
							class="fh-headerband__menu-item"
							role="menuitem"
							aria-current={props.segments.length === 0 ? "true" : undefined}
							onClick={() => navigate([])}
						>
							<Icon name="folder" class="fh-headerband__menu-glyph" />
							{props.ownerLabel}
						</button>
						{tree.value.map((node) => (
							<button
								key={node.segment}
								type="button"
								class="fh-headerband__menu-item"
								role="menuitem"
								aria-current={props.segments[0] === node.segment ? "true" : undefined}
								onClick={() => navigate([node.segment])}
							>
								<Icon name="folder" class="fh-headerband__menu-glyph" />
								{node.label}
							</button>
						))}
					</div>
				</Popover>
			</span>

			<span class="fh-headerband__identity">
				<span class="fh-headerband__scope">{scopeName}</span>
				<AssetBreadcrumbs
					crumbs={trail.value}
					base={props.base}
					onNavigate={navigate}
					aria-label="File path"
				/>
			</span>

			<span class="fh-headerband__controls">
				<Tooltip content="Search this library" placement="bottom">
					<button
						type="button"
						class="fh-headerband__icon"
						ref={searchRef}
						data-on={query.value ? "true" : undefined}
						aria-label={query.value ? `Search: ${query.value}` : "Search this library"}
						aria-haspopup="dialog"
						aria-expanded={searchOpen.value ? "true" : "false"}
						onClick={() => {
							searchOpen.value = !searchOpen.value;
						}}
					>
						<Icon name="search" />
					</button>
				</Tooltip>
				<Popover open={searchOpen} targetRef={searchRef} placement="bottom-end">
					<div class="fh-headerband__panel">
						<InputText
							value={query.value}
							placeholder="Search files by name…"
							aria-label="Search files by name"
							block
							onValueChange={onSearch}
						/>
						{
							/*
							 * Gated on `seeded`, never on `total > 0`. Before the body has applied a page the
							 * total is 0 because nothing has been counted, not because nothing matched — and
							 * printing "0 files match" over a grid that is about to fill is the same
							 * empty-is-not-unloaded confusion this codebase has shipped twice.
							 */
						}
						{seeded.value && (
							<p class="fh-headerband__panel-note" role="status">
								{`${total.value} ${total.value === 1 ? "file" : "files"} match`}
							</p>
						)}
					</div>
				</Popover>

				<Tooltip content="Filter by kind or source" placement="bottom">
					<button
						type="button"
						class="fh-headerband__icon"
						ref={filterRef}
						data-on={activeFilters.value > 0 ? "true" : undefined}
						aria-label={activeFilters.value > 0
							? `Filter — ${activeFilters.value} active`
							: "Filter by kind or source"}
						aria-haspopup="dialog"
						aria-expanded={filterOpen.value ? "true" : "false"}
						onClick={() => {
							filterOpen.value = !filterOpen.value;
						}}
					>
						<Icon name="filter" />
						{activeFilters.value > 0 && <span class="fh-headerband__dot" aria-hidden="true" />}
					</button>
				</Tooltip>
				<Popover open={filterOpen} targetRef={filterRef} placement="bottom-end">
					<div class="fh-headerband__panel fh-headerband__panel--filter">
						<p class="fh-headerband__panel-note">File kind</p>
						{KIND_ROWS.map((row) => (
							<button
								key={row.key}
								type="button"
								class="fh-headerband__option"
								aria-pressed={kindFilter.value.includes(row.key)}
								onClick={() => toggleKind(row.key)}
							>
								<span class="fh-headerband__option-mark" aria-hidden="true">
									<Icon name="check" />
								</span>
								{row.label}
							</button>
						))}

						<p class="fh-headerband__panel-note">Where it lives</p>
						{SOURCE_ROWS.map((source) => (
							<button
								key={source}
								type="button"
								class="fh-headerband__option"
								aria-pressed={sourceFilter.value.includes(source)}
								onClick={() => toggleSource(source)}
							>
								<span class="fh-headerband__option-mark" aria-hidden="true">
									<SourceMark source={source} /> <Icon name="check" />
								</span>
								{source === "supabase" ? "This library" : sourceLabel(source)}
							</button>
						))}

						{narrowed.value && (
							<button
								type="button"
								class="fh-headerband__clear"
								onClick={() => {
									clearFilesFilters();
									filterOpen.value = false;
								}}
							>
								Clear every filter
							</button>
						)}
					</div>
				</Popover>

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
		</div>
	);
}
