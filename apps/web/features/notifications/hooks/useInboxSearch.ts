import { type Signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import {
	type InboxFilter,
	inboxHref,
	parseQuery,
	SEARCH_DEBOUNCE_MS,
} from "../core/notification-model.ts";
import { patchInboxFilter } from "../core/inbox-filter-state.ts";

/** What {@link useInboxSearch} hands its field. */
export interface InboxSearch {
	/** The text in the field, ahead of the applied search while typing rests. */
	draft: Signal<string>;
	onInput: (value: string) => void;
}

/**
 * useInboxSearch — a search field over the shared `/notifications` filter: the field shows what is
 * typed at once, and the search is applied once typing rests for {@link SEARCH_DEBOUNCE_MS}. The field
 * follows a search changed elsewhere while nothing is pending. Before the page has seeded the shared
 * filter, the search is applied by loading its address instead.
 */
export function useInboxSearch(filter: InboxFilter): InboxSearch {
	const draft = useSignal(filter.query);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	useEffect(() => {
		if (timer.current === undefined) draft.value = filter.query;
	}, [filter.query]);
	useEffect(() => () => clearTimeout(timer.current), []);

	const apply = (value: string) => {
		timer.current = undefined;
		const query = parseQuery(value);
		if (!patchInboxFilter({ query })) {
			globalThis.location.assign(inboxHref(filter.tab, filter.view, query));
		}
	};

	return {
		draft,
		onInput(value) {
			draft.value = value;
			clearTimeout(timer.current);
			timer.current = setTimeout(() => apply(value), SEARCH_DEBOUNCE_MS);
		},
	};
}
