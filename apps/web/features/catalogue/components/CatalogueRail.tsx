import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { CatalogueIcon, KindIcon, PlusIcon } from "./catalogue-glyphs.tsx";
import type { ListingSummary } from "../types/catalogue-types.ts";

/**
 * CatalogueRail — the lane's collapsed presentation, revealed by `.ui-splitter[data-mode="collapsed"]`
 * (the same density switch as `ProjectSidebar`/`MessagesRail`). A compact icon column: a New action, the
 * most-recent listings as `--shell-nav-block` squares (portal-tooltip'd, active-tinted), and a bottom
 * Expand toggle reusing the global rail's morphing glyph. Dumb — the island owns state.
 */
export interface CatalogueRailProps {
	recent: ListingSummary[];
	activeId: string | null;
	onNew: () => void;
	onExpand: () => void;
}

export function CatalogueRail(
	{ recent, activeId, onNew, onExpand }: CatalogueRailProps,
): JSX.Element {
	return (
		<div class="cat-rail" aria-label="Catalogue (collapsed)">
			<div class="cat-rail__top">
				<Tooltip content="Catalogue" placement="right">
					<span class="cat-rail__brand" aria-hidden="true">
						<CatalogueIcon size={22} />
					</span>
				</Tooltip>
				<Tooltip content="New listing" placement="right">
					<button type="button" class="cat-rail__new" aria-label="New listing" onClick={onNew}>
						<PlusIcon size={20} />
					</button>
				</Tooltip>
			</div>

			<div class="cat-rail__items" role="list" aria-label="Recent listings">
				{recent.map((l) => (
					<Tooltip key={l.id} content={l.title} placement="right">
						<a
							class="cat-rail__item"
							href={`/catalogue/${l.id}`}
							data-active={activeId === l.id ? "true" : undefined}
							data-kind={l.kind}
							role="listitem"
							aria-label={l.title}
						>
							<KindIcon kind={l.kind} size={20} />
							{l.needsAttention && <span class="cat-rail__dot" aria-hidden="true" />}
						</a>
					</Tooltip>
				))}
			</div>

			<div class="cat-rail__bottom">
				<Tooltip content="Expand lane" placement="right">
					<button
						type="button"
						class="cat-rail__toggle"
						data-collapsed="true"
						aria-label="Expand lane"
						onClick={onExpand}
					>
						<SidebarToggleIcon />
					</button>
				</Tooltip>
			</div>
		</div>
	);
}
