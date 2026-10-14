import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { LaneCollapseButton } from "@projective/ui/navigation";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { listingHref } from "../core/catalogue-model.ts";
import type { ListingSummary } from "../types/catalogue-types.ts";

/**
 * CatalogueRail — the lane's collapsed presentation, revealed by `.ui-splitter[data-mode="collapsed"]`
 * (the same density switch as `ProjectSidebar` / `MessagesRail`): a New action, the most recent
 * listings as tooltip'd squares, and the Expand toggle. Dumb — the island owns state.
 */
export interface CatalogueRailProps {
	recent: ListingSummary[];
	activeId: string | null;
	/** Where "New listing" goes when it navigates (the outline lane) — otherwise `onNew` runs. */
	newHref?: string;
	onNew?: () => void;
	onExpand: () => void;
}

export function CatalogueRail(
	{ recent, activeId, newHref, onNew, onExpand }: CatalogueRailProps,
): JSX.Element {
	return (
		<div class="cat-rail" aria-label="Catalogue (collapsed)">
			<div class="cat-rail__top">
				<Tooltip content="Catalogue" placement="right">
					<a class="cat-rail__brand" href="/catalogue" aria-label="Catalogue">
						<Icon name="catalogue" size="md" />
					</a>
				</Tooltip>
				<Tooltip content="New listing" placement="right">
					{newHref
						? (
							<a class="cat-rail__new" href={newHref} aria-label="New listing">
								<Icon name="plus" size="md" />
							</a>
						)
						: (
							<button type="button" class="cat-rail__new" aria-label="New listing" onClick={onNew}>
								<Icon name="plus" size="md" />
							</button>
						)}
				</Tooltip>
			</div>

			<div class="cat-rail__items" role="list" aria-label="Recent listings">
				{recent.map((l) => (
					<Tooltip key={l.id} content={l.title} placement="right">
						<a
							class={activeId === l.id ? "cat-rail__item cat-rail__item--active" : "cat-rail__item"}
							href={listingHref(l.id)}
							role="listitem"
							aria-label={l.needsAttention ? `${l.title}, needs attention` : l.title}
							aria-current={activeId === l.id ? "page" : undefined}
						>
							<Icon name={l.kind === "service" ? "service" : "box"} size="md" />
							{l.needsAttention && <span class="cat-rail__dot" aria-hidden="true" />}
						</a>
					</Tooltip>
				))}
			</div>

			<div class="cat-rail__bottom">
				<LaneCollapseButton
					collapsed
					icon={<SidebarToggleIcon />}
					tooltipPlacement="right"
					onToggle={onExpand}
				/>
			</div>
		</div>
	);
}
