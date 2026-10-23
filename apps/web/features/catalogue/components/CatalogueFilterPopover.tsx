import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Icon } from "@projective/ui/icons";
import {
	LaneFilterCombo,
	type LaneFilterComboOption,
	type LaneFilterIconOption,
	LaneFilterIcons,
	LaneFilterPopover,
} from "@projective/ui/navigation";
import type { CreateCategory } from "@projective/types/org";
import { TrendIcon } from "./catalogue-glyphs.tsx";
import {
	CREATE_CATEGORY_OPTIONS,
	SERVICE_MODELS,
	SORT_OPTIONS,
	STATUS_SECTIONS,
} from "../core/catalogue-model.ts";
import {
	activeFilterCount,
	resetFilterPatch,
	toggleCategory,
	toggleHighlight,
	toggleModel,
	toggleStatus,
} from "../core/lane-model.ts";
import {
	CatalogueSort,
	type ConsoleHighlight,
	type ConsoleUrlState,
	type ListingStatus,
	type ServiceType,
} from "../types/catalogue-types.ts";

/**
 * CatalogueFilterPopover — the catalogue's facets in the shared lane filter popover: sort, status,
 * highlights, delivery model (unless the console shows products only), CREATE category and, where
 * the host lists teams, the team selector. Every choice is written through `onChange` at once; the
 * lane and the console toolbar both open it, so the two surfaces filter with one control.
 */

// #region Options
const STATUS_GLYPH: Readonly<Record<ListingStatus, JSX.Element>> = {
	published: <Icon name="eye" />,
	draft: <Icon name="edit" />,
	paused: <Icon name="pause" />,
	archived: <Icon name="archive-box" />,
};

const MODEL_GLYPH: Readonly<Record<ServiceType, JSX.Element>> = {
	"Pipeline": <Icon name="stages" />,
	"One-Off": <Icon name="ticket" />,
	"Direct Deliverable": <Icon name="submission" />,
	"Session": <Icon name="video" />,
	"Group Session": <Icon name="members" />,
};

const CREATE_GLYPH: Readonly<Record<CreateCategory, JSX.Element>> = {
	create: <Icon name="category-create" />,
	run: <Icon name="category-run" />,
	educate: <Icon name="category-educate" />,
	advise: <Icon name="category-advise" />,
	test: <Icon name="category-test" />,
	empower: <Icon name="category-empower" />,
};

/** The status facet's icon options, in the console's order. */
export const STATUS_FILTERS: readonly LaneFilterIconOption<ListingStatus>[] = STATUS_SECTIONS.map(
	(s) => ({ value: s.status, label: s.label, icon: STATUS_GLYPH[s.status] }),
);

/** The highlight facet's icon options. */
export const HIGHLIGHT_FILTERS: readonly LaneFilterIconOption<ConsoleHighlight>[] = [
	{ value: "attention", label: "Needs attention", icon: <Icon name="warning" /> },
	{ value: "promoted", label: "Promoted", icon: <Icon name="star" /> },
	{ value: "best-selling", label: "Best-selling", icon: <TrendIcon size={16} /> },
];

const MODEL_FILTERS: readonly LaneFilterIconOption<ServiceType>[] = SERVICE_MODELS.map((m) => ({
	value: m,
	label: m,
	icon: MODEL_GLYPH[m],
}));

const CATEGORY_FILTERS: readonly LaneFilterIconOption<CreateCategory>[] = CREATE_CATEGORY_OPTIONS
	.map((c) => ({ value: c.value, label: `${c.label} · ${c.hint}`, icon: CREATE_GLYPH[c.value] }));

const SORTS = SORT_OPTIONS.flatMap((o) => {
	const parsed = CatalogueSort.safeParse(o.value);
	return parsed.success ? [{ value: parsed.data, label: o.label }] : [];
});
// #endregion

/** The team selector's choices and where a change goes; omitted where there is nothing to choose. */
export interface CatalogueTeamFilter {
	options: readonly LaneFilterComboOption[];
	selected: readonly string[];
	onChange: (handles: string[]) => void;
}

/** Props for {@link CatalogueFilterPopover}. */
export interface CatalogueFilterPopoverProps {
	state: ConsoleUrlState;
	onChange: (patch: Partial<ConsoleUrlState>) => void;
	teams?: CatalogueTeamFilter;
}

export function CatalogueFilterPopover(
	{ state, onChange, teams }: CatalogueFilterPopoverProps,
): JSX.Element {
	const open = useSignal(false);
	const choosesTeams = !!teams && teams.options.length > 0;
	const active = activeFilterCount(state) + (choosesTeams ? teams.selected.length : 0);

	return (
		<LaneFilterPopover
			open={open}
			active={active}
			icon={<Icon name="filter" />}
			onReset={() => {
				onChange(resetFilterPatch());
				if (choosesTeams) teams.onChange([]);
			}}
			sort={{
				options: SORTS,
				value: state.sort,
				direction: state.dir,
				onSort: (sort) => onChange({ sort }),
				onDirection: (dir) => onChange({ dir }),
			}}
		>
			<LaneFilterIcons
				label="Status"
				options={STATUS_FILTERS}
				active={state.status}
				onToggle={(s) => onChange({ status: toggleStatus(state.status, s) })}
			/>
			<LaneFilterIcons
				label="Highlights"
				options={HIGHLIGHT_FILTERS}
				active={state.highlights}
				onToggle={(h) => onChange({ highlights: toggleHighlight(state.highlights, h) })}
			/>
			{state.type !== "product" && (
				<LaneFilterIcons
					label="Delivery model"
					options={MODEL_FILTERS}
					active={state.model}
					onToggle={(m) => onChange({ model: toggleModel(state.model, m) })}
				/>
			)}
			<LaneFilterIcons
				label="Category"
				options={CATEGORY_FILTERS}
				active={state.create}
				onToggle={(c) => onChange({ create: toggleCategory(state.create, c) })}
			/>
			{choosesTeams && (
				<LaneFilterCombo
					label="Teams"
					options={teams.options}
					selected={teams.selected}
					onChange={teams.onChange}
					emptyPlaceholder="All teams"
				/>
			)}
		</LaneFilterPopover>
	);
}
