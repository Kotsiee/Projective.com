import type { JSX } from "preact";
import { batch, type Signal, signal } from "@preact/signals";
import { useMemo } from "preact/hooks";
import "../styles/filter-dialog.css";
import { Dialog } from "@projective/ui/feedback";
import { Button, SelectButton } from "@projective/ui/fields";
import { setConsoleUrl } from "../core/console-store.ts";
import {
	appliedFilterCount,
	type ConsoleFacets,
	createOptions,
	defaultFacets,
	type FacetOption,
	facetsFrom,
	facetsOf,
	highlightOptions,
	modelOptions,
	nextStatuses,
	statusOptions,
} from "../core/filter-dialog-model.ts";
import type {
	CatalogueFacetCounts,
	CatalogueStatusCounts,
	ConsoleUrlState,
} from "../types/catalogue-types.ts";

/**
 * CatalogueFilterDialog — the console lane's four facets (status, highlights, delivery model, CREATE
 * category) as a modal of multi-select pill groups, for a console drawn without the lane: the team
 * catalogue (Decision #312). Each option carries how many listings it holds. Pressing an option edits
 * a draft; Apply writes the draft to the URL in one history entry (`?status=` · `?highlight=` ·
 * `?model=` · `?category=`, the lane's own parameters) and Clear all returns the draft to nothing
 * narrowed. Dismissing the dialog discards the draft. Delivery models are offered only while the
 * console shows services, as in the lane.
 */

// #region Control
/** The dialog's visibility and its draft, one per console. */
export interface FilterDialogControl {
	visible: Signal<boolean>;
	/** Each group's pressed option values. */
	pressed: Readonly<Record<keyof ConsoleFacets, Signal<string[]>>>;
	/** Seed the draft from the console state and open the dialog. */
	open: (state: ConsoleUrlState) => void;
	/** Press the status group, which is never left empty. */
	pressStatus: (values: string[]) => void;
	/** Return the draft to nothing narrowed. */
	clear: () => void;
	/** The draft as facets. */
	draft: () => ConsoleFacets;
}

/** The filter dialog's control, created once for the component that mounts the dialog. */
export function useFilterDialog(): FilterDialogControl {
	return useMemo(() => {
		const visible = signal(false);
		const pressed = {
			status: signal<string[]>([]),
			highlights: signal<string[]>([]),
			model: signal<string[]>([]),
			create: signal<string[]>([]),
		};
		let status: string[] = [];
		const seed = (facets: ConsoleFacets) => {
			status = [...facets.status];
			pressed.status.value = [...facets.status];
			pressed.highlights.value = [...facets.highlights];
			pressed.model.value = [...facets.model];
			pressed.create.value = [...facets.create];
		};
		return {
			visible,
			pressed,
			open: (state) =>
				batch(() => {
					seed(facetsOf(state));
					visible.value = true;
				}),
			pressStatus: (values) => {
				status = nextStatuses(status, values);
				pressed.status.value = status;
			},
			clear: () => batch(() => seed(defaultFacets())),
			draft: () =>
				facetsFrom({
					status: pressed.status.value,
					highlights: pressed.highlights.value,
					model: pressed.model.value,
					create: pressed.create.value,
				}),
		};
	}, []);
}
// #endregion

// #region Group
function FacetGroup(
	props: {
		id: string;
		label: string;
		options: FacetOption[];
		pressed: Signal<string[]>;
		onPress?: (values: string[]) => void;
	},
): JSX.Element {
	return (
		<section class="cat-filters__group" aria-labelledby={props.id}>
			<h3 id={props.id} class="cat-filters__label">{props.label}</h3>
			<SelectButton
				multiple
				size="sm"
				options={props.options}
				value={props.pressed}
				onValueChange={(v) => props.onPress?.(Array.isArray(v) ? v : [v])}
				aria-label={props.label}
			/>
		</section>
	);
}
// #endregion

/** Props for {@link CatalogueFilterDialog}. */
export interface CatalogueFilterDialogProps {
	control: FilterDialogControl;
	/** The console state the draft applies to; its type decides whether delivery models apply. */
	state: ConsoleUrlState;
	statusCounts: CatalogueStatusCounts;
	facetCounts: CatalogueFacetCounts;
}

export function CatalogueFilterDialog(props: CatalogueFilterDialogProps): JSX.Element {
	const { control, state, statusCounts, facetCounts } = props;
	const draft = control.draft();
	const narrowed = appliedFilterCount(draft) > 0;

	const apply = () => {
		setConsoleUrl(control.draft());
		control.visible.value = false;
	};

	return (
		<Dialog
			visible={control.visible}
			header="Filter listings"
			width="min(40rem, calc(100vw - 2rem))"
			footer={
				<div class="cat-filters__actions">
					<Button
						label="Clear all"
						severity="neutral"
						variant="outlined"
						disabled={!narrowed}
						onClick={control.clear}
					/>
					<Button label="Apply filters" onClick={apply} />
				</div>
			}
		>
			<div class="cat-filters__body">
				<FacetGroup
					id="cat-filters-status"
					label="Status"
					options={statusOptions(statusCounts)}
					pressed={control.pressed.status}
					onPress={control.pressStatus}
				/>
				<FacetGroup
					id="cat-filters-highlights"
					label="Highlights"
					options={highlightOptions(facetCounts)}
					pressed={control.pressed.highlights}
				/>
				{state.type !== "product" && (
					<FacetGroup
						id="cat-filters-model"
						label="Delivery model"
						options={modelOptions(facetCounts)}
						pressed={control.pressed.model}
					/>
				)}
				<FacetGroup
					id="cat-filters-create"
					label="CREATE category"
					options={createOptions(facetCounts)}
					pressed={control.pressed.create}
				/>
			</div>
		</Dialog>
	);
}
