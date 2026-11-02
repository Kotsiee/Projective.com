import type { JSX } from "preact";
import { signal } from "@preact/signals";
import { useMemo } from "preact/hooks";
import { Logo } from "@web/components/Logo.tsx";
import { Tooltip } from "@projective/ui/feedback";
import { Button, MultiSelect } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { SourceMark, VisibilityMark } from "./file-hub-glyphs.tsx";
import {
	categoryFilter,
	commitFiles,
	facetCount,
	sourceFilter,
	visibilityFilter,
} from "../core/files-state.ts";
import {
	type AssetSource,
	type AssetVisibility,
	CATEGORY_META,
	FileCategory,
	sourceLabel,
	visibilityLabel,
} from "../types/file-types.ts";

// #region Vocabulary
const NAMED_CATEGORIES: readonly FileCategory[] = [
	"Document",
	"Presentation",
	"Spreadsheet",
	"Image",
	"Vector",
	"Video",
	"Audio",
	"Code",
	"Compression",
	"Data",
	"Font",
	"3D",
];

const OTHER_CATEGORIES: readonly FileCategory[] = FileCategory.options.filter((c) =>
	!NAMED_CATEGORIES.includes(c)
);

/**
 * The Type menu's one synthetic row. It stands for every category outside {@link NAMED_CATEGORIES}
 * and never reaches `files-state`: it expands to {@link OTHER_CATEGORIES} on the way in and is shown
 * as checked only while every one of them is.
 */
const OTHER_VALUE = "__other";

const TYPE_OPTIONS = [
	...NAMED_CATEGORIES.map((c) => ({ value: c as string, label: CATEGORY_META[c].label })),
	{ value: OTHER_VALUE, label: "Other types" },
];

const VISIBILITY_ROWS: readonly AssetVisibility[] = ["private", "link", "public"];

const SOURCE_ROWS: readonly AssetSource[] = [
	"supabase",
	"google_drive",
	"dropbox",
	"onedrive",
	"frameio",
	"s3",
	"link",
];
// #endregion

// #region Toggles
function toggled<T>(set: readonly T[], members: readonly T[]): T[] {
	const on = members.every((m) => set.includes(m));
	return on
		? set.filter((v) => !members.includes(v))
		: [...set, ...members.filter((m) => !set.includes(m))];
}

/** The Type menu's value: named categories as themselves, plus {@link OTHER_VALUE} when all others are on. */
function typeValue(categories: readonly FileCategory[]): string[] {
	const named = NAMED_CATEGORIES.filter((c) => categories.includes(c)) as string[];
	return OTHER_CATEGORIES.every((c) => categories.includes(c)) ? [...named, OTHER_VALUE] : named;
}

function setTypes(values: readonly string[]): void {
	const named = NAMED_CATEGORIES.filter((c) => values.includes(c));
	categoryFilter.value = values.includes(OTHER_VALUE) ? [...named, ...OTHER_CATEGORIES] : named;
	commitFiles();
}

function toggleVisibility(visibility: AssetVisibility): void {
	visibilityFilter.value = toggled(visibilityFilter.value, [visibility]);
	commitFiles();
}

function toggleSource(source: AssetSource): void {
	sourceFilter.value = toggled(sourceFilter.value, [source]);
	commitFiles();
}

function clearFacets(): void {
	categoryFilter.value = [];
	visibilityFilter.value = [];
	sourceFilter.value = [];
	commitFiles();
}
// #endregion

// #region Parts
interface GroupProps {
	/** Stable id stem; the heading is `${id}-heading` and names the group. */
	id: string;
	title: string;
	/** How many options in this group are on — the heading's count and the clear control's gate. */
	active: number;
	/** Resets this group alone; the other two keep their selections. */
	onClear: () => void;
	children: JSX.Element | JSX.Element[];
}

/**
 * One filter group: a heading row (title · count · clear) over its control. The clear control renders
 * only while something in the group is on — a control that renders must do something (§3.11) — and
 * the row holds its height without it, so toggling the last option never shifts the panel.
 */
function Group({ id, title, active, onClear, children }: GroupProps): JSX.Element {
	const headingId = `${id}-heading`;
	return (
		<div class="fh-filter__section" role="group" aria-labelledby={headingId}>
			<div class="fh-filter__head">
				<span id={headingId} class="fh-filter__heading">
					{title}
					{active > 0 && <span class="fh-filter__count">({active})</span>}
				</span>
				{active > 0 && (
					<Tooltip content={`Clear ${title.toLowerCase()}`} placement="top">
						<Button
							rounded
							iconOnly
							size="sm"
							severity="secondary"
							variant="text"
							class="fh-filter__groupclear"
							icon={<Icon name="close" size="xs" />}
							aria-label={`Clear ${title.toLowerCase()} filter`}
							onClick={onClear}
						/>
					</Tooltip>
				)}
			</div>
			{children}
		</div>
	);
}

interface OptionProps {
	label: string;
	pressed: boolean;
	onToggle: () => void;
	mark?: JSX.Element | null;
}

function Option({ label, pressed, onToggle, mark }: OptionProps): JSX.Element {
	return (
		<button type="button" class="fh-filter__option" aria-pressed={pressed} onClick={onToggle}>
			<span class="fh-filter__check" aria-hidden="true">
				<Icon name="check" size="xs" />
			</span>
			{mark && <span class="fh-filter__mark" aria-hidden="true">{mark}</span>}
			<span class="fh-filter__label">{label}</span>
		</button>
	);
}

/** The storage-source glyph for an icon-only toggle; the library is the Projective mark. */
function sourceGlyph(source: AssetSource): JSX.Element | null {
	return source === "supabase"
		? <Logo class="fh-filter__logo" />
		: <SourceMark source={source} size={18} />;
}

function sourceName(source: AssetSource): string {
	return source === "supabase" ? "This library" : sourceLabel(source);
}
// #endregion

/** Props for {@link FilesFilterPanel}. */
export interface FilesFilterPanelProps {
	/** Called after "Clear filters" (the facets only; the search is its own control), so the host can close. */
	onCleared?: () => void;
}

/**
 * FilesFilterPanel — the `/files` header band's filter popover body, three groups that combine:
 *
 * - **Type** (`FileCategory`) — a `MultiSelect` dropdown; "Other types" is one row for every category
 *   outside the named twelve.
 * - **Sharing** (`AssetVisibility`) — pressed rows, each led by the same lock · link · globe mark the
 *   grid shows on an asset.
 * - **Where it lives** (`AssetSource`) — an icon-only toggle group of round ghost buttons; each is
 *   named by `aria-label` and a Tooltip, since no label renders.
 *
 * Each group's heading carries its active count and a clear control that resets that group alone.
 * Every change writes `files-state` and asks the body to refetch through `commitFiles`, so the panel
 * never holds a set of its own.
 */
export function FilesFilterPanel({ onCleared }: FilesFilterPanelProps): JSX.Element {
	const types = typeValue(categoryFilter.value);
	/**
	 * The menu is bound to a signal, never a raw array: a raw `value` is read once at mount, so the
	 * group's own clear would leave the open menu showing a selection `files-state` no longer holds.
	 * A fresh signal per distinct selection keeps the two one value without a sync effect.
	 */
	const typeSelection = useMemo(() => signal(types), [types.join("|")]);

	return (
		<div class="fh-filter">
			<Group
				id="fh-filter-type"
				title="Type"
				active={types.length}
				onClear={() => setTypes([])}
			>
				<MultiSelect
					options={TYPE_OPTIONS}
					value={typeSelection}
					onValueChange={setTypes}
					placeholder="All types"
					maxSelectedLabels={2}
					size="sm"
					fluid
					aria-label="File type"
				/>
			</Group>

			<Group
				id="fh-filter-sharing"
				title="Sharing"
				active={visibilityFilter.value.length}
				onClear={() => {
					visibilityFilter.value = [];
					commitFiles();
				}}
			>
				<div class="fh-filter__wrap">
					{VISIBILITY_ROWS.map((visibility) => (
						<Option
							key={visibility}
							label={visibilityLabel(visibility)}
							pressed={visibilityFilter.value.includes(visibility)}
							onToggle={() => toggleVisibility(visibility)}
							mark={<VisibilityMark visibility={visibility} />}
						/>
					))}
				</div>
			</Group>

			<Group
				id="fh-filter-source"
				title="Where it lives"
				active={sourceFilter.value.length}
				onClear={() => {
					sourceFilter.value = [];
					commitFiles();
				}}
			>
				<div class="fh-filter__toggles">
					{SOURCE_ROWS.map((source) => (
						<Tooltip key={source} content={sourceName(source)} placement="bottom">
							<button
								type="button"
								class="fh-filter__toggle"
								aria-pressed={sourceFilter.value.includes(source)}
								aria-label={sourceName(source)}
								onClick={() =>
									toggleSource(source)}
							>
								<span class="fh-filter__glyph" aria-hidden="true">{sourceGlyph(source)}</span>
							</button>
						</Tooltip>
					))}
				</div>
			</Group>

			{facetCount.value > 0 && (
				<button
					type="button"
					class="fh-filter__clear"
					onClick={() => {
						clearFacets();
						onCleared?.();
					}}
				>
					Clear filters
				</button>
			)}
		</div>
	);
}
