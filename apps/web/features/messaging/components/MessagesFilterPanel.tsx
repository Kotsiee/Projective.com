import type { JSX } from "preact";
import {
	activeFilterCount,
	type FacetOption,
	relationFacetsForRole,
	showsOfferingFacets,
	toggleIn,
	toggleRelation,
} from "../core/conversation-filters.ts";
import type {
	ConversationFilter,
	ConversationListParams,
	ConversationRelation,
	MessagingRole,
} from "../types/messaging-types.ts";

/**
 * MessagesFilterPanel — the advanced faceted filter body inside the inbox sidebar's Filter popover
 * (task §2A). The facet SET is role-specific: a freelancer filters by Client / Co-Freelancers / Teams /
 * Team Members (+ Service / Product); a client/business by Businesses / Business Members / Hired
 * Freelancers / Direct Messages. Live-apply (no submit): every toggle calls `onApply` with the next
 * params (mirrors the projects `FilterPanel`). Multi-select toggle matrices, not a flat tag wall.
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
	onReset: () => void;
}
// #endregion

export function MessagesFilterPanel(props: MessagesFilterPanelProps): JSX.Element {
	const { role, params } = props;
	const filter: ConversationFilter = params.filter ?? {};
	const count = activeFilterCount(params);
	const relationFacets = relationFacetsForRole(role);
	const offering = showsOfferingFacets(role);
	const entityLabel = role === "freelancer" ? "Teams" : "Businesses";

	function patch(next: ConversationFilter): void {
		props.onApply({ ...params, filter: next });
	}

	function relOn(r: ConversationRelation): boolean {
		return (filter.relations ?? []).includes(r);
	}

	return (
		<div class="msg-filter" role="group" aria-label="Advanced filters">
			<div class="msg-filter__head">
				<span class="msg-filter__title">Filter conversations</span>
				{count > 0 && <span class="msg-filter__count">{count}</span>}
				{count > 0 && (
					<button type="button" class="msg-filter__reset" onClick={props.onReset}>Reset</button>
				)}
			</div>

			<div class="msg-filter__facet">
				<span class="msg-filter__label">Relationship</span>
				<div class="msg-matrix" role="group" aria-label="Relationship">
					{relationFacets.map((f) => (
						<button
							key={f.relation}
							type="button"
							class="msg-matrix__opt"
							data-on={relOn(f.relation) ? "true" : undefined}
							aria-pressed={relOn(f.relation)}
							onClick={() =>
								patch({ ...filter, relations: toggleRelation(filter.relations, f.relation) })}
						>
							{f.label}
						</button>
					))}
				</div>
			</div>

			{offering && props.services.length > 0 && (
				<div class="msg-filter__facet">
					<span class="msg-filter__label">Service</span>
					<div class="msg-matrix" role="group" aria-label="Service">
						{props.services.map((s) => (
							<button
								key={s.id}
								type="button"
								class="msg-matrix__opt"
								data-on={(filter.serviceIds ?? []).includes(s.id) ? "true" : undefined}
								aria-pressed={(filter.serviceIds ?? []).includes(s.id)}
								onClick={() => patch({ ...filter, serviceIds: toggleIn(filter.serviceIds, s.id) })}
							>
								{s.label}
							</button>
						))}
					</div>
				</div>
			)}

			{offering && props.products.length > 0 && (
				<div class="msg-filter__facet">
					<span class="msg-filter__label">Product</span>
					<div class="msg-matrix" role="group" aria-label="Product">
						{props.products.map((p) => (
							<button
								key={p.id}
								type="button"
								class="msg-matrix__opt"
								data-on={(filter.productIds ?? []).includes(p.id) ? "true" : undefined}
								aria-pressed={(filter.productIds ?? []).includes(p.id)}
								onClick={() => patch({ ...filter, productIds: toggleIn(filter.productIds, p.id) })}
							>
								{p.label}
							</button>
						))}
					</div>
				</div>
			)}

			{props.entities.length > 0 && (
				<div class="msg-filter__facet">
					<span class="msg-filter__label">{entityLabel}</span>
					<div class="msg-matrix" role="group" aria-label={entityLabel}>
						{props.entities.map((e) => (
							<button
								key={e.id}
								type="button"
								class="msg-matrix__opt"
								data-on={(filter.entityIds ?? []).includes(e.id) ? "true" : undefined}
								aria-pressed={(filter.entityIds ?? []).includes(e.id)}
								onClick={() => patch({ ...filter, entityIds: toggleIn(filter.entityIds, e.id) })}
							>
								{e.label}
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
