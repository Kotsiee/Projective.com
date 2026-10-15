import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { LaneSection, LaneSections } from "@projective/ui/navigation";
import { Icon, type IconName } from "@projective/ui/icons";
import { SelectionCheck } from "@projective/ui/fields";
import { TrendIcon } from "./catalogue-glyphs.tsx";
import {
	CREATE_CATEGORY_OPTIONS,
	SERVICE_MODELS,
	STATUS_SECTIONS,
} from "../core/catalogue-model.ts";
import type { CreateCategory } from "@projective/types/org";
import type { QuickFilters } from "../core/console-store.ts";
import { facetClickOf, pickFacet } from "../core/facet-select.ts";
import {
	type CatalogueFacetCounts,
	type CatalogueStatusCounts,
	type ConsoleUrlState,
	DEFAULT_CONSOLE_STATUSES,
	isDefaultStatuses,
	type ListingStatus,
	type ServiceType,
} from "../types/catalogue-types.ts";

/**
 * CatalogueFilterPanel — the console lane's facets, each a collapsible lane section of filter rows:
 * lifecycle status, highlights (needs attention · promoted · best-selling), delivery model (services
 * only) and CREATE category. A row is its glyph, its label, the number of listings it holds as plain
 * `tabular-nums` meta text, and a circular check while it is on. Status, model and category are
 * multi-select on the file explorer's model ({@link pickFacet}): a press selects only that row,
 * Ctrl/Cmd toggles one, Shift selects a run; status opens on everything but Archived. Highlights
 * combine. Dumb: every change goes back through `onChange` / `onHighlight`.
 */

type FacetKey = "status" | "highlights" | "model" | "create";

/** Props for {@link CatalogueFilterPanel}. */
export interface CatalogueFilterPanelProps {
	state: ConsoleUrlState;
	statusCounts: CatalogueStatusCounts;
	facetCounts: CatalogueFacetCounts;
	highlights: QuickFilters;
	onChange: (patch: Partial<ConsoleUrlState>) => void;
	onHighlight: (key: keyof QuickFilters, on: boolean) => void;
	onClearHighlights: () => void;
}

const STATUS_GLYPH: Readonly<Record<ListingStatus, IconName>> = {
	published: "eye",
	draft: "edit",
	paused: "pause",
	archived: "archive-box",
};

const MODEL_GLYPH: Readonly<Record<ServiceType, IconName>> = {
	"Pipeline": "stages",
	"One-Off": "ticket",
	"Direct Deliverable": "submission",
	"Session": "video",
	"Group Session": "members",
};

const CREATE_GLYPH: Readonly<Record<CreateCategory, IconName>> = {
	create: "category-create",
	run: "category-run",
	educate: "category-educate",
	advise: "category-advise",
	test: "category-test",
	empower: "category-empower",
};

interface Highlight {
	key: keyof QuickFilters;
	label: string;
	glyph: () => JSX.Element;
	count: (c: CatalogueFacetCounts) => number;
}

const HIGHLIGHTS: readonly Highlight[] = [
	{
		key: "attention",
		label: "Needs attention",
		glyph: () => <Icon name="warning" />,
		count: (c) => c.needsAttention,
	},
	{
		key: "promoted",
		label: "Promoted",
		glyph: () => <Icon name="star" />,
		count: (c) => c.promoted,
	},
	{
		key: "bestSelling",
		label: "Best-selling",
		glyph: () => <TrendIcon size={16} />,
		count: (c) => c.bestSelling,
	},
];

interface FacetRowProps {
	label: string;
	count: number;
	pressed: boolean;
	glyph: JSX.Element;
	/** Words for the accessible name only. */
	hint?: string;
	/** The id of the facet's modifier-key hint. */
	describedBy?: string;
	onToggle: (e: MouseEvent) => void;
}

function FacetRow(
	{ label, count, pressed, glyph, hint, describedBy, onToggle }: FacetRowProps,
): JSX.Element {
	return (
		<button
			type="button"
			class="cat-facet__row"
			aria-pressed={pressed}
			aria-describedby={describedBy}
			data-empty={count === 0 ? "true" : undefined}
			onClick={onToggle}
		>
			<span class="cat-facet__glyph" aria-hidden="true">{glyph}</span>
			<span class="cat-facet__label">
				{label}
				{hint && <span class="ui-visually-hidden">, {hint}</span>}
			</span>
			<span class="cat-facet__count">
				{count.toLocaleString("en-US")}
				<span class="ui-visually-hidden">{count === 1 ? " listing" : " listings"}</span>
			</span>
			<SelectionCheck checked={pressed} size="sm" class="cat-facet__check" />
		</button>
	);
}

function ClearFacet(
	{ onClear, label, verb = "Clear" }: { onClear: () => void; label: string; verb?: string },
): JSX.Element {
	return (
		<button
			type="button"
			class="cat-facet__clear"
			aria-label={`${verb} ${label}`}
			onClick={onClear}
		>
			{verb}
		</button>
	);
}

const MULTI_HINT_ID = "cat-facet-multi-hint";
const STATUS_ORDER: readonly ListingStatus[] = STATUS_SECTIONS.map((s) => s.status);
const CREATE_ORDER: readonly CreateCategory[] = CREATE_CATEGORY_OPTIONS.map((c) => c.value);

interface Anchors {
	status: ListingStatus | null;
	model: ServiceType | null;
	create: CreateCategory | null;
}

/** The status, highlight, delivery-model and CREATE-category facets. */
export function CatalogueFilterPanel(props: CatalogueFilterPanelProps): JSX.Element {
	const { state, statusCounts, facetCounts, highlights, onChange, onHighlight, onClearHighlights } =
		props;
	const open = useSignal<Record<FacetKey, boolean>>({
		status: true,
		highlights: true,
		model: true,
		create: true,
	});
	const anchors = useSignal<Anchors>({ status: null, model: null, create: null });
	const toggleOpen = (key: FacetKey) => (open.value = { ...open.value, [key]: !open.value[key] });
	const anyHighlight = HIGHLIGHTS.some((h) => highlights[h.key]);

	const pressStatus = (value: ListingStatus, e: MouseEvent) => {
		const next = pickFacet(
			STATUS_ORDER,
			state.status,
			value,
			facetClickOf(e),
			anchors.value.status,
			DEFAULT_CONSOLE_STATUSES,
		);
		anchors.value = { ...anchors.value, status: next.anchor };
		onChange({ status: next.selected });
	};
	const pressModel = (value: ServiceType, e: MouseEvent) => {
		const next = pickFacet(
			SERVICE_MODELS,
			state.model,
			value,
			facetClickOf(e),
			anchors.value.model,
			[],
		);
		anchors.value = { ...anchors.value, model: next.anchor };
		onChange({ model: next.selected });
	};
	const pressCreate = (value: CreateCategory, e: MouseEvent) => {
		const next = pickFacet(
			CREATE_ORDER,
			state.create,
			value,
			facetClickOf(e),
			anchors.value.create,
			[],
		);
		anchors.value = { ...anchors.value, create: next.anchor };
		onChange({ create: next.selected });
	};

	return (
		<LaneSections class="cat-facet">
			<p id={MULTI_HINT_ID} class="ui-visually-hidden">
				Selects only this filter. Hold Control or Command to add or remove it, Shift to select a
				range.
			</p>
			<LaneSection
				id="cat-facet-status"
				icon={<Icon name="flag" />}
				label="Status"
				open={open.value.status}
				onToggle={() => toggleOpen("status")}
				action={!isDefaultStatuses(state.status) && (
					<ClearFacet
						label="status"
						verb="Reset"
						onClear={() => {
							anchors.value = { ...anchors.value, status: null };
							onChange({ status: [...DEFAULT_CONSOLE_STATUSES] });
						}}
					/>
				)}
			>
				{STATUS_SECTIONS.map((s) => (
					<FacetRow
						key={s.status}
						label={s.label}
						count={statusCounts[s.status]}
						pressed={state.status.includes(s.status)}
						glyph={<Icon name={STATUS_GLYPH[s.status]} />}
						describedBy={MULTI_HINT_ID}
						onToggle={(e) => pressStatus(s.status, e)}
					/>
				))}
			</LaneSection>

			<LaneSection
				id="cat-facet-highlights"
				icon={<Icon name="star" />}
				label="Highlights"
				open={open.value.highlights}
				onToggle={() => toggleOpen("highlights")}
				action={anyHighlight && (
					<ClearFacet
						label="highlights"
						onClear={onClearHighlights}
					/>
				)}
			>
				{HIGHLIGHTS.map((h) => (
					<FacetRow
						key={h.key}
						label={h.label}
						count={h.count(facetCounts)}
						pressed={highlights[h.key]}
						glyph={h.glyph()}
						onToggle={() => onHighlight(h.key, !highlights[h.key])}
					/>
				))}
			</LaneSection>

			{state.type !== "product" && (
				<LaneSection
					id="cat-facet-model"
					icon={<Icon name="service" />}
					label="Delivery model"
					open={open.value.model}
					onToggle={() => toggleOpen("model")}
					action={state.model.length > 0 && (
						<ClearFacet
							label="delivery model"
							onClear={() => {
								anchors.value = { ...anchors.value, model: null };
								onChange({ model: [] });
							}}
						/>
					)}
				>
					{SERVICE_MODELS.map((m) => (
						<FacetRow
							key={m}
							label={m}
							count={facetCounts.model[m] ?? 0}
							pressed={state.model.includes(m)}
							glyph={<Icon name={MODEL_GLYPH[m]} />}
							describedBy={MULTI_HINT_ID}
							onToggle={(e) => pressModel(m, e)}
						/>
					))}
				</LaneSection>
			)}

			<LaneSection
				id="cat-facet-create"
				icon={<Icon name="tag" />}
				label="CREATE category"
				open={open.value.create}
				onToggle={() => toggleOpen("create")}
				action={state.create.length > 0 && (
					<ClearFacet
						label="CREATE category"
						onClear={() => {
							anchors.value = { ...anchors.value, create: null };
							onChange({ create: [] });
						}}
					/>
				)}
			>
				{CREATE_CATEGORY_OPTIONS.map((c) => (
					<FacetRow
						key={c.value}
						label={c.label}
						hint={c.hint}
						count={facetCounts.create[c.value] ?? 0}
						pressed={state.create.includes(c.value)}
						glyph={<Icon name={CREATE_GLYPH[c.value]} />}
						describedBy={MULTI_HINT_ID}
						onToggle={(e) => pressCreate(c.value, e)}
					/>
				))}
			</LaneSection>
		</LaneSections>
	);
}
