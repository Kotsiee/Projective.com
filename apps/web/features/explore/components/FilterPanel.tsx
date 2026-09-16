import type { JSX, VNode } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import {
	Button,
	MilestoneSlider,
	MultiSelect,
	RangeSlider,
	type RangeValue,
	Select,
	StarRatingInput,
} from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import {
	type Facet,
	type FacetControl,
	facetIsDefault,
	milestoneFacetValue,
	type MilestonesFacet,
	normaliseFacetValues,
	type OptionsFacet,
	type RangeFacet,
	rangeFacetValue,
	type RatingFacet,
	ratingFacetValue,
} from "@projective/types/explore";

/**
 * FilterPanel — the adaptive sidebar filters. Fully controlled by the parent island (the `values`
 * map + `onChange`), so the rendered state always matches the URL; the facets come from
 * {@link activeFilterConfigs}, so switching category — or the API attaching a scope-specific facet —
 * swaps the rendered sections with no branching here. The panel is a RENDERER over a list: each
 * facet kind maps to one entry in {@link FACET_RENDERERS}, and every section shares one header
 * (label · hint · a ghost icon-only Reset that reverts that facet alone). Reused verbatim inside the
 * mobile filter sheet.
 */
export interface FilterPanelProps {
	facets: Facet[];
	values: Record<string, string[]>;
	/** Replace one facet's values (an empty list removes it from the URL). */
	onChange: (id: string, values: string[]) => void;
	onClear: () => void;
	activeCount: number;
	/** Locale for the numeric boxes — pass one so SSR and the client format the same figure. */
	locale?: string;
}

/** How long a continuous control (a dragged range) settles before its value is committed. */
const CONTINUOUS_COMMIT_MS = 220;

// #region Renderers
interface RendererArgs<F extends Facet = Facet> {
	facet: F;
	values: string[];
	set: (values: string[]) => void;
	/** Commit after a short quiet period — for controls that emit on every pointer sample. */
	setDebounced: (values: string[]) => void;
	locale?: string;
}

function OptionButtons({ facet, values, set }: RendererArgs<OptionsFacet>): VNode {
	const chips = facet.control === "chips";
	return (
		<div class={chips ? "ex-filters__chips" : "ex-filters__checks"}>
			{facet.options.map((opt) => {
				const active = values.includes(opt.value);
				const next = active ? values.filter((v) => v !== opt.value) : [...values, opt.value];
				return (
					<button
						type="button"
						key={opt.value}
						class={`ex-filters__opt ex-filters__opt--${facet.control}`}
						aria-pressed={active}
						onClick={() => set(next)}
					>
						{!chips && (
							<span class="ex-filters__box" aria-hidden="true">
								{active && <Icon name="check" size="2xs" />}
							</span>
						)}
						{opt.label}
					</button>
				);
			})}
		</div>
	);
}

function SelectFacet({ facet, values, set }: RendererArgs<OptionsFacet>): VNode {
	return (
		<Select
			class="ex-filters__select"
			size="sm"
			aria-label={facet.label}
			key={`${facet.id}:${values[0] ?? ""}`}
			options={[{ label: "Any", value: "" }, ...facet.options]}
			value={values[0] ?? ""}
			onValueChange={(v) => set(v ? [v] : [])}
		/>
	);
}

function MultiSelectFacet({ facet, values, set }: RendererArgs<OptionsFacet>): VNode {
	return (
		<MultiSelect
			class="ex-filters__select"
			size="sm"
			aria-label={facet.label}
			key={`${facet.id}:${values.join(",")}`}
			options={facet.options}
			value={values}
			placeholder="Any"
			showClear
			filter={facet.options.length > 8}
			onValueChange={(v) => set(v)}
		/>
	);
}

function RangeFacetControl(
	{ facet, values, setDebounced, locale }: RendererArgs<RangeFacet>,
): VNode {
	// Controlled through a local signal so a drag in flight is never remounted by the committed value
	// landing (a keyed remount would drop the pointer capture out from under the reader's finger).
	const committed = rangeFacetValue(facet, values);
	const pair = useSignal<RangeValue>(committed);
	useEffect(() => {
		const [lo, hi] = rangeFacetValue(facet, values);
		if (pair.peek()[0] !== lo || pair.peek()[1] !== hi) pair.value = [lo, hi];
	}, [committed[0], committed[1]]);
	return (
		<RangeSlider
			class="ex-filters__range"
			size="sm"
			aria-label={facet.label}
			min={facet.min}
			max={facet.max}
			step={facet.step}
			symbol={facet.symbol}
			suffix={facet.suffix}
			locale={locale}
			value={pair}
			onValueChange={([lo, hi]) => setDebounced([String(lo), String(hi)])}
		/>
	);
}

function RatingFacetControl({ facet, values, set }: RendererArgs<RatingFacet>): VNode {
	const rating = useSignal(ratingFacetValue(values));
	const committed = ratingFacetValue(values);
	useEffect(() => {
		if (rating.peek() !== committed) rating.value = committed;
	}, [committed]);
	return (
		<div class="ex-filters__rating">
			<StarRatingInput
				aria-label={facet.hint ?? facet.label}
				stars={facet.stars}
				precision={facet.precision}
				value={rating}
				onValueChange={(v) => set(v > 0 ? [String(v)] : [])}
			/>
			<span class="ex-filters__ratingval" aria-hidden="true">
				{committed > 0 ? `${committed} & up` : "Any"}
			</span>
		</div>
	);
}

function MilestonesFacetControl({ facet, values, set }: RendererArgs<MilestonesFacet>): VNode {
	const stop = useSignal(milestoneFacetValue(facet, values));
	const committed = milestoneFacetValue(facet, values);
	useEffect(() => {
		if (stop.peek() !== committed) stop.value = committed;
	}, [committed]);
	return (
		<MilestoneSlider
			class="ex-filters__milestones"
			size="sm"
			aria-label={facet.hint ?? facet.label}
			milestones={facet.milestones}
			value={stop}
			onValueChange={(v) => set([String(v)])}
		/>
	);
}

/**
 * Facet kind → renderer. Adding a control kind is one entry here plus its SSOT schema; the section
 * chrome, the reset, the active count and the URL contract need no change.
 */
const FACET_RENDERERS: {
	[K in FacetControl]: (args: RendererArgs<Extract<Facet, { control: K }>>) => VNode;
} = {
	chips: OptionButtons,
	checkbox: OptionButtons,
	select: SelectFacet,
	multiselect: MultiSelectFacet,
	range: RangeFacetControl,
	rating: RatingFacetControl,
	milestones: MilestonesFacetControl,
};

function renderFacet(args: RendererArgs): VNode {
	// The registry is keyed by the discriminant; TypeScript cannot correlate the two sides of the
	// lookup, so the one cast lives here and every renderer stays precisely typed. Mounted as a
	// COMPONENT (not called) so each renderer owns its own hooks — a facet whose kind changes under
	// the same id then remounts rather than corrupting the section's hook order.
	const Render = FACET_RENDERERS[args.facet.control] as (a: RendererArgs) => VNode;
	return <Render key={args.facet.control} {...args} />;
}
// #endregion

// #region Section
function FilterSection(
	{ facet, values, onChange, locale }: {
		facet: Facet;
		values: string[];
		onChange: (id: string, values: string[]) => void;
		locale?: string;
	},
): VNode {
	const open = useSignal(true);
	const bodyId = `ex-facet-${facet.id}`;
	const atDefault = facetIsDefault(facet, values);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const set = (next: string[]) => {
		if (timer.current !== undefined) clearTimeout(timer.current);
		onChange(facet.id, normaliseFacetValues(facet, next));
	};
	const setDebounced = (next: string[]) => {
		if (timer.current !== undefined) clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			timer.current = undefined;
			onChange(facet.id, normaliseFacetValues(facet, next));
		}, CONTINUOUS_COMMIT_MS);
	};
	useEffect(() => () => {
		if (timer.current !== undefined) clearTimeout(timer.current);
	}, []);

	return (
		<section class="ex-filters__group" data-open={open.value ? "true" : "false"}>
			<header class="ex-filters__head-row">
				<button
					type="button"
					class="ex-filters__summary"
					aria-expanded={open.value}
					aria-controls={bodyId}
					onClick={() => (open.value = !open.value)}
				>
					<span class="ex-filters__label">
						{facet.label}
						{!atDefault && <span class="ex-filters__dot" aria-hidden="true" />}
					</span>
					<Icon name="chevron-down" size="sm" class="ex-filters__chevron" />
				</button>
				{!atDefault && (
					<Tooltip content={`Reset ${facet.label.toLowerCase()}`}>
						<Button
							class="ex-filters__reset"
							variant="text"
							severity="secondary"
							size="sm"
							iconOnly
							icon={<Icon name="refresh" size="xs" />}
							aria-label={`Reset ${facet.label.toLowerCase()}`}
							onClick={() => set([])}
						/>
					</Tooltip>
				)}
			</header>
			<div id={bodyId} class="ex-filters__body" hidden={!open.value}>
				{facet.hint && <p class="ex-filters__hint">{facet.hint}</p>}
				{renderFacet({ facet, values, set, setDebounced, locale })}
			</div>
		</section>
	);
}
// #endregion

export function FilterPanel(props: FilterPanelProps): JSX.Element {
	const { facets, values, onChange, onClear, activeCount, locale } = props;
	return (
		<div class="ex-filters">
			<div class="ex-filters__head">
				<div class="ex-filters__heading">
					<h2 class="ex-filters__title">Filters</h2>
					{activeCount > 0 && (
						<p class="ex-filters__applied" aria-live="polite">
							{activeCount} {activeCount === 1 ? "filter" : "filters"} applied
						</p>
					)}
				</div>
				{activeCount > 0 && (
					<button type="button" class="ex-filters__clear" onClick={onClear}>
						Clear all
					</button>
				)}
			</div>

			{facets.map((facet) => (
				<FilterSection
					key={facet.id}
					facet={facet}
					values={values[facet.id] ?? []}
					onChange={onChange}
					locale={locale}
				/>
			))}
		</div>
	);
}
