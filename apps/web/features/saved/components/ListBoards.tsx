import type { JSX } from "preact";
import type { SavedCollection, SavedTab } from "@projective/types/org";
import { Icon } from "@projective/ui/icons";
import { itemCount, savedHref } from "../core/saved-model.ts";

/** Props for {@link ListBoards}. */
export interface ListBoardsProps {
	lists: readonly SavedCollection[];
	/** The category the boards open into. */
	tab: SavedTab;
	/** Open a list in place; `true` when it did (the link then does not navigate). */
	onOpen: (list: SavedCollection) => boolean;
	onNew: () => void;
}

const COVER_SLOTS = 3;

/**
 * ListBoards — the viewer's lists as boards: a cover mosaic of the list's newest pictures, its name
 * and how much it holds, each a link into the list; then a New list tile.
 */
export function ListBoards({ lists, tab, onOpen, onNew }: ListBoardsProps): JSX.Element {
	return (
		<section class="svd-boards" aria-labelledby="svd-boards-title">
			<h2 class="svd-section__title" id="svd-boards-title">Your lists</h2>
			<ul class="svd-boards__grid" role="list">
				{lists.map((list) => {
					const covers = list.covers ?? [];
					return (
						<li key={list.id} class="svd-boards__cell">
							<a
								class="svd-board"
								href={savedHref(tab, list.id)}
								onClick={(event) => {
									if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
									if (onOpen(list)) event.preventDefault();
								}}
							>
								<span class="svd-board__cover" aria-hidden="true">
									{Array.from({ length: COVER_SLOTS }, (_, i) =>
										covers[i]
											? (
												<img
													key={i}
													class="svd-board__img"
													src={covers[i]}
													alt=""
													loading="lazy"
												/>
											)
											: <span key={i} class="svd-board__img svd-board__img--empty" />)}
								</span>
								<span class="svd-board__name">{list.name}</span>
								<span class="svd-board__meta">{itemCount(list.count ?? 0)}</span>
							</a>
						</li>
					);
				})}
				<li class="svd-boards__cell">
					<button type="button" class="svd-board svd-board--new" onClick={onNew}>
						<span class="svd-board__cover svd-board__cover--new" aria-hidden="true">
							<Icon name="plus" />
						</span>
						<span class="svd-board__name">New list</span>
						<span class="svd-board__meta">Group saves you want to come back to</span>
					</button>
				</li>
			</ul>
		</section>
	);
}
