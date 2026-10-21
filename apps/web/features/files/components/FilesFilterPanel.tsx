import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { SourceMark } from "./file-hub-glyphs.tsx";
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

function toggleCategories(members: readonly FileCategory[]): void {
	categoryFilter.value = toggled(categoryFilter.value, members);
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

/** Props for {@link FilesFilterPanel}. */
export interface FilesFilterPanelProps {
	/** Called after "Clear filters" (the facets only; the search is its own control), so the host can close. */
	onCleared?: () => void;
}

/**
 * FilesFilterPanel — the `/files` header band's filter popover body: file type (`FileCategory`),
 * sharing (`AssetVisibility`) and storage source, each a multi-select of pressed rows. Every toggle
 * writes `files-state` and asks the body to refetch through `commitFiles`, so the panel never holds
 * a set of its own.
 */
export function FilesFilterPanel({ onCleared }: FilesFilterPanelProps): JSX.Element {
	const categories = categoryFilter.value;
	const otherOn = OTHER_CATEGORIES.every((c) => categories.includes(c));

	return (
		<div class="fh-filter">
			<fieldset class="fh-filter__section">
				<legend class="fh-filter__heading">Type</legend>
				<div class="fh-filter__grid">
					{NAMED_CATEGORIES.map((category) => (
						<Option
							key={category}
							label={CATEGORY_META[category].label}
							pressed={categories.includes(category)}
							onToggle={() => toggleCategories([category])}
						/>
					))}
					<Option
						label="Other types"
						pressed={otherOn}
						onToggle={() => toggleCategories(OTHER_CATEGORIES)}
					/>
				</div>
			</fieldset>

			<fieldset class="fh-filter__section">
				<legend class="fh-filter__heading">Sharing</legend>
				<div class="fh-filter__wrap">
					{VISIBILITY_ROWS.map((visibility) => (
						<Option
							key={visibility}
							label={visibilityLabel(visibility)}
							pressed={visibilityFilter.value.includes(visibility)}
							onToggle={() => toggleVisibility(visibility)}
						/>
					))}
				</div>
			</fieldset>

			<fieldset class="fh-filter__section">
				<legend class="fh-filter__heading">Where it lives</legend>
				<div class="fh-filter__wrap">
					{SOURCE_ROWS.map((source) => (
						<Option
							key={source}
							label={source === "supabase" ? "This library" : sourceLabel(source)}
							pressed={sourceFilter.value.includes(source)}
							onToggle={() => toggleSource(source)}
							mark={<SourceMark source={source} />}
						/>
					))}
				</div>
			</fieldset>

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
