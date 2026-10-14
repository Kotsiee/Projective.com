import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { LaneSection, LaneSections } from "@projective/ui/navigation";
import { Icon } from "@projective/ui/icons";
import {
	CREATE_CATEGORY_OPTIONS,
	SERVICE_MODELS,
	STATUS_SECTIONS,
} from "../core/catalogue-model.ts";
import type {
	CatalogueStatusCounts,
	ConsoleUrlState,
	ListingStatus,
} from "../types/catalogue-types.ts";

/**
 * CatalogueFilterPanel — the console lane's facets, each a collapsible lane section of toggle rows:
 * lifecycle status (a filled dot when the seller has listings in that state, a hollow one when not —
 * presence, never a count), delivery model (services only) and CREATE category. Each facet holds one
 * value; pressing the active row clears it. Dumb: every change goes back through `onChange`, which
 * writes the console URL.
 */

type FacetKey = "status" | "model" | "create";

/** Props for {@link CatalogueFilterPanel}. */
export interface CatalogueFilterPanelProps {
	state: ConsoleUrlState;
	statusCounts: CatalogueStatusCounts;
	onChange: (patch: Partial<ConsoleUrlState>) => void;
}

interface FacetRowProps {
	label: string;
	pressed: boolean;
	mark: JSX.Element;
	/** Words for the accessible name only. */
	hint?: string;
	onToggle: () => void;
}

function FacetRow({ label, pressed, mark, hint, onToggle }: FacetRowProps): JSX.Element {
	return (
		<button type="button" class="cat-facet__row" aria-pressed={pressed} onClick={onToggle}>
			<span class="cat-facet__mark" aria-hidden="true">{mark}</span>
			<span class="cat-facet__label">
				{label}
				{hint && <span class="ui-visually-hidden">, {hint}</span>}
			</span>
			{pressed && <Icon name="check" class="cat-facet__check" />}
		</button>
	);
}

function ClearFacet({ onClear, label }: { onClear: () => void; label: string }): JSX.Element {
	return (
		<button type="button" class="cat-facet__clear" aria-label={`Clear ${label}`} onClick={onClear}>
			Clear
		</button>
	);
}

/** The status, delivery-model and CREATE-category facets. */
export function CatalogueFilterPanel(
	{ state, statusCounts, onChange }: CatalogueFilterPanelProps,
): JSX.Element {
	const open = useSignal<Record<FacetKey, boolean>>({ status: true, model: true, create: true });
	const toggleOpen = (key: FacetKey) => (open.value = { ...open.value, [key]: !open.value[key] });
	const presence = (s: ListingStatus) => statusCounts[s] > 0;

	return (
		<LaneSections class="cat-facet">
			<LaneSection
				id="cat-facet-status"
				icon={<Icon name="flag" />}
				label="Status"
				open={open.value.status}
				onToggle={() => toggleOpen("status")}
				action={state.status && (
					<ClearFacet
						label="status"
						onClear={() => onChange({ status: undefined })}
					/>
				)}
			>
				{STATUS_SECTIONS.map((s) => (
					<FacetRow
						key={s.status}
						label={s.label}
						pressed={state.status === s.status}
						hint={presence(s.status) ? undefined : "none yet"}
						mark={
							<span
								class="cat-facet__dot"
								data-status={s.status}
								data-present={presence(s.status) ? "true" : undefined}
							/>
						}
						onToggle={() => onChange({ status: state.status === s.status ? undefined : s.status })}
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
					action={state.model && (
						<ClearFacet
							label="delivery model"
							onClear={() => onChange({ model: undefined })}
						/>
					)}
				>
					{SERVICE_MODELS.map((m) => (
						<FacetRow
							key={m}
							label={m}
							pressed={state.model === m}
							mark={<Icon name="stages" />}
							onToggle={() => onChange({ model: state.model === m ? undefined : m })}
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
				action={state.create && (
					<ClearFacet
						label="CREATE category"
						onClear={() => onChange({ create: undefined })}
					/>
				)}
			>
				{CREATE_CATEGORY_OPTIONS.map((c) => (
					<FacetRow
						key={c.value}
						label={c.label}
						hint={c.hint}
						pressed={state.create === c.value}
						mark={<span class="cat-facet__initial">{c.label.charAt(0)}</span>}
						onToggle={() => onChange({ create: state.create === c.value ? undefined : c.value })}
					/>
				))}
			</LaneSection>
		</LaneSections>
	);
}
