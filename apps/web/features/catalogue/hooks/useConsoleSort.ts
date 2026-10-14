import { type Signal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { setConsoleUrl } from "../core/console-store.ts";
import {
	CatalogueSort,
	type CatalogueSortDir,
	type ConsoleUrlState,
} from "../types/catalogue-types.ts";

/** A `SortControl`'s bindings to the console URL. */
export interface ConsoleSortBindings {
	sort: Signal<string>;
	dir: Signal<CatalogueSortDir>;
	onSort: (key: string) => void;
	onDir: (dir: CatalogueSortDir) => void;
}

/**
 * Bind a `SortControl` to the console URL. The control wants signals it can own; these follow the URL
 * (a Back press, the other sort control) and every choice is written back as a history entry.
 */
export function useConsoleSort(state: ConsoleUrlState): ConsoleSortBindings {
	const sort = useSignal<string>(state.sort);
	const dir = useSignal<CatalogueSortDir>(state.dir);

	useEffect(() => {
		sort.value = state.sort;
		dir.value = state.dir;
	}, [state.sort, state.dir]);

	return {
		sort,
		dir,
		onSort: (key) => {
			const parsed = CatalogueSort.safeParse(key);
			if (parsed.success) setConsoleUrl({ sort: parsed.data });
		},
		onDir: (next) => setConsoleUrl({ dir: next }),
	};
}
