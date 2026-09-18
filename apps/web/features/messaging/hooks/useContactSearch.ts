import { type ReadonlySignal, type Signal, useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { ContactsService } from "../core/ContactsService.ts";
import { type ContactTierGroup, groupContactsByTier } from "@projective/types/messaging";
import type { RankedContact } from "../types/messaging-types.ts";

/**
 * useContactSearch — the fetch + search state behind every ranked people picker (New message ·
 * New group · Add members · Share with…).
 *
 * On mount it loads the SUGGESTIONS (no query): the viewer's relationships, ranked server-side. As
 * the viewer types it debounces and asks the same endpoint for a SEARCH, which returns the known
 * people that match first and directory hits after. The picker never ranks, never filters and
 * never sorts — it renders what the server decided, so the fixture path, the live path and the
 * share modal cannot disagree about who comes first.
 *
 * Failure is a stated state, not an empty list: a failed fetch sets `error` and leaves `contacts`
 * alone, because "nobody matched" and "the request failed" are different facts and only one of
 * them is true of the viewer's account.
 */

// #region Options + result
export interface ContactSearchOptions {
	/** Ids to leave out — people already in the conversation being extended. */
	exclude?: readonly string[];
	/** Result cap; the server applies its own default when absent. */
	limit?: number;
}

export interface ContactSearch {
	/** The live query text (bind it to the search field). */
	query: Signal<string>;
	/** Set the query; debounced, and an empty value returns to the suggestions. */
	setQuery: (value: string) => void;
	/** The rows to render, in server order. */
	contacts: ReadonlySignal<RankedContact[]>;
	/** The rows grouped by tier — populated only for the suggestion view (`searched === false`). */
	groups: ReadonlySignal<ContactTierGroup[]>;
	/** Whether `contacts` is a search result (flat) rather than the ranked suggestions (grouped). */
	searched: ReadonlySignal<boolean>;
	/** A request is in flight. */
	loading: ReadonlySignal<boolean>;
	/** The last failure, or null. */
	error: ReadonlySignal<string | null>;
	/** Re-run the current query after a failure. */
	retry: () => void;
}
// #endregion

const SEARCH_DEBOUNCE_MS = 220;

export function useContactSearch(options: ContactSearchOptions = {}): ContactSearch {
	const query = useSignal("");
	const contacts = useSignal<RankedContact[]>([]);
	const searched = useSignal(false);
	const loading = useSignal(true);
	const error = useSignal<string | null>(null);

	const reqId = useRef(0);
	const timer = useRef<number | null>(null);
	const live = useRef(true);
	// Read at request time rather than captured, so an `exclude` list that grows (a member added a
	// moment ago) is honoured by the next fetch without re-creating the hook.
	const optionsRef = useRef(options);
	optionsRef.current = options;

	async function load(q: string): Promise<void> {
		const id = ++reqId.current;
		loading.value = true;
		error.value = null;
		const res = await ContactsService.suggestions({
			q: q || undefined,
			exclude: optionsRef.current.exclude ? [...optionsRef.current.exclude] : undefined,
			limit: optionsRef.current.limit,
		});
		if (!live.current || id !== reqId.current) return; // unmounted, or superseded
		if (res.ok && res.data) {
			contacts.value = res.data.contacts.contacts;
			searched.value = res.data.contacts.searched;
		} else {
			error.value = res.message ?? "Couldn't load people to pick from.";
		}
		loading.value = false;
	}

	useEffect(() => {
		live.current = true;
		void load("");
		return () => {
			live.current = false;
			if (timer.current) clearTimeout(timer.current);
		};
	}, []);

	function setQuery(value: string): void {
		query.value = value;
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(
			() => void load(value.trim()),
			SEARCH_DEBOUNCE_MS,
		) as unknown as number;
	}

	function retry(): void {
		void load(query.value.trim());
	}

	const groups = useComputed(() => (searched.value ? [] : groupContactsByTier(contacts.value)));

	return { query, setQuery, contacts, groups, searched, loading, error, retry };
}
