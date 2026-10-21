import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import "../styles/fx-toolbar.css";
import { InputText, MultiSelect, SortControl } from "@projective/ui/fields";
import { FILE_KIND_OPTIONS, FILE_SORT_OPTIONS } from "../core/file-model.ts";
import {
	commitExplorer,
	explorerKinds,
	explorerQuery,
	explorerSortDir,
	explorerSortKey,
} from "../core/explorer-state.ts";
import { SearchIcon } from "./file-glyphs.tsx";

/**
 * ExplorerToolbar — the explorers' one toolbar: search · Attachment-Types filter · sort, over the shared
 * `explorer-state` intent (Decision #317).
 *
 * It is drawn in ONE of two places per route, never both: inside the middle-nav header band beside the
 * folder's title where that band is free (`placement="band"`, the project's own Files and Submissions),
 * or as the sticky glass `.fx-toolbar` pill above the grid where the band is a channel's or a
 * conversation's (`placement="body"`). Either way it writes the intent and calls `commitExplorer`, so
 * the body — the single fetch owner — re-reads once. A keystroke is not a decision: search waits for
 * typing to pause; a filter or a sort commits at once.
 */
export interface ExplorerToolbarProps {
	/** What the search finds — named in the field and its accessible name. */
	noun: "files" | "submissions";
	/** `band`: inside the header band (no pill, no pin); `body`: the sticky pill above the grid. */
	placement?: "band" | "body";
}

const SEARCH_DEBOUNCE_MS = 300;

export function ExplorerToolbar({ noun, placement = "body" }: ExplorerToolbarProps): JSX.Element {
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => () => {
		if (timer.current !== null) clearTimeout(timer.current);
	}, []);

	function onSearch(value: string): void {
		explorerQuery.value = value;
		if (timer.current !== null) clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			timer.current = null;
			commitExplorer();
		}, SEARCH_DEBOUNCE_MS);
	}

	return (
		<div class={placement === "band" ? "fx-toolbar fx-toolbar--band" : "fx-toolbar"}>
			<div class="fx-toolbar__search">
				<InputText
					type="search"
					variant="bare"
					size="sm"
					block
					placeholder={`Search ${noun}…`}
					aria-label={`Search ${noun}`}
					value={explorerQuery}
					onValueChange={onSearch}
					start={
						<span class="fx-toolbar__searchicon" aria-hidden="true">
							<SearchIcon size={16} />
						</span>
					}
				/>
			</div>
			<span class="fx-toolbar__spacer" />
			<MultiSelect
				class="ui-field--bare"
				size="sm"
				display="chip"
				placeholder="All types"
				aria-label="Filter by type"
				options={FILE_KIND_OPTIONS}
				value={explorerKinds}
				onValueChange={(kinds: string[]) => {
					explorerKinds.value = kinds;
					commitExplorer();
				}}
			/>
			<SortControl
				size="sm"
				options={FILE_SORT_OPTIONS}
				value={explorerSortKey}
				direction={explorerSortDir}
				onValueChange={() => commitExplorer()}
				onDirectionChange={() => commitExplorer()}
			/>
		</div>
	);
}
