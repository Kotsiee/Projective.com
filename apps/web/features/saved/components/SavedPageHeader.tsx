import type { JSX } from "preact";
import type { SavedCollection, SavedTab } from "@projective/types/org";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { itemCount, TAB_LABEL } from "../core/saved-model.ts";

/** Props for {@link SavedPageHeader}. */
export interface SavedPageHeaderProps {
	tab: SavedTab;
	/** The open list's name (or the unfiled filter's), `null` for every save. */
	listLabel: string | null;
	/** The open list, when it is one of the viewer's own (not the unfiled filter). */
	list: SavedCollection | null;
	onNewList: () => void;
	onBuyList: () => void;
	onRenameList: () => void;
	onDeleteList: () => void;
}

/**
 * SavedPageHeader — the `/saved` title band, the same anatomy as `/notifications`': the display-register
 * "Saved" with the open scope inline in the Meta register, then the actions — Buy list, Rename and
 * Delete while one of the viewer's lists is open, and New list always.
 */
export function SavedPageHeader(props: SavedPageHeaderProps): JSX.Element {
	const { tab, listLabel, list } = props;
	const scope = [
		listLabel,
		tab === "all" ? null : TAB_LABEL[tab],
		list ? itemCount(list.count ?? 0) : null,
	].filter(Boolean).join(" · ");

	return (
		<header class="svd-page__head">
			<div class="svd-page__titles">
				<h1 class="svd-page__title">Saved</h1>
				{scope ? <p class="svd-page__meta">{scope}</p> : null}
			</div>
			<div class="svd-page__actions">
				{list && (
					<>
						<Button
							severity="neutral"
							variant="outlined"
							size="sm"
							icon={<Icon name="basket" />}
							label="Buy list"
							aria-label={`Put the items in ${list.name} into a basket`}
							aria-haspopup="dialog"
							onClick={props.onBuyList}
						/>
						<Button
							variant="text"
							severity="secondary"
							size="sm"
							icon={<Icon name="edit" />}
							label="Rename"
							aria-label={`Rename ${list.name}`}
							aria-haspopup="dialog"
							onClick={props.onRenameList}
						/>
						<Button
							variant="text"
							severity="secondary"
							size="sm"
							icon={<Icon name="trash" />}
							label="Delete list"
							aria-label={`Delete ${list.name}. Its items stay saved.`}
							onClick={props.onDeleteList}
						/>
					</>
				)}
				<Button
					severity="neutral"
					variant="outlined"
					size="sm"
					icon={<Icon name="plus" />}
					label="New list"
					aria-haspopup="dialog"
					onClick={props.onNewList}
				/>
			</div>
		</header>
	);
}
