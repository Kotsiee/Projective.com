import type { JSX } from "preact";
import { LaneFilterChoices, LaneFilterCombo } from "@projective/ui/navigation";
import {
	type FacetOption,
	relationFacetsForRole,
	showsOfferingFacets,
	toggleIn,
	toggleRelation,
} from "../core/conversation-filters.ts";
import type {
	ConversationFilter,
	ConversationListParams,
	MessagingRole,
} from "../types/messaging-types.ts";

/**
 * MessagesFilterPanel — the inbox's facets inside the shared lane filter popover (task §2A); the
 * popover owns the heading, Reset and the sort row. The facet SET is role-specific: a freelancer
 * filters by Clients / Co-freelancers / Teams / Team members (+ Service / Product) and picks teams; a
 * client/business by Businesses / Business members / Hired freelancers / Direct messages and picks
 * businesses. Live-apply: every toggle calls `onApply` with the next params.
 */

// #region Props
export interface MessagesFilterPanelProps {
	role: MessagingRole;
	params: ConversationListParams;
	/** Service / product / entity options derived from the loaded conversation set. */
	services: FacetOption[];
	products: FacetOption[];
	entities: FacetOption[];
	onApply: (params: ConversationListParams) => void;
}
// #endregion

export function MessagesFilterPanel(props: MessagesFilterPanelProps): JSX.Element {
	const { role, params } = props;
	const filter: ConversationFilter = params.filter ?? {};
	const offering = showsOfferingFacets(role);
	const freelancer = role === "freelancer";

	function patch(next: ConversationFilter): void {
		props.onApply({ ...params, filter: next });
	}

	return (
		<>
			<LaneFilterChoices
				label="Relationship"
				options={relationFacetsForRole(role).map((f) => ({ value: f.relation, label: f.label }))}
				active={filter.relations ?? []}
				onToggle={(r) => patch({ ...filter, relations: toggleRelation(filter.relations, r) })}
			/>

			{offering && props.services.length > 0 && (
				<LaneFilterChoices
					label="Service"
					options={props.services.map((s) => ({ value: s.id, label: s.label }))}
					active={filter.serviceIds ?? []}
					onToggle={(id) => patch({ ...filter, serviceIds: toggleIn(filter.serviceIds, id) })}
				/>
			)}

			{offering && props.products.length > 0 && (
				<LaneFilterChoices
					label="Product"
					options={props.products.map((p) => ({ value: p.id, label: p.label }))}
					active={filter.productIds ?? []}
					onToggle={(id) => patch({ ...filter, productIds: toggleIn(filter.productIds, id) })}
				/>
			)}

			{props.entities.length > 0 && (
				<LaneFilterCombo
					label={freelancer ? "Teams" : "Businesses"}
					options={props.entities}
					selected={filter.entityIds ?? []}
					emptyPlaceholder={freelancer ? "All teams" : "All businesses"}
					onChange={(entityIds) => patch({ ...filter, entityIds })}
				/>
			)}
		</>
	);
}
