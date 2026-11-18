import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Select } from "@projective/ui/fields";
import { sortOptionsFor } from "../core/filter-config.ts";

/** The sort selector's inputs: the active order, the query it orders, and the commit handler. */
interface SortControlProps {
	value: string;
	query: string;
	onChange: (value: string) => void;
}

/**
 * SortControl — the results sort selector. A `packages/ui` {@link Select} (no bespoke `<select>`),
 * rendered as the interactive control ALONE — the word "Sort" is intentionally dropped so the
 * dropdown reads as clean chrome. The parent island owns the value and writes it to the URL; a synced
 * local signal keeps the Select controlled across back/forward. Best match is offered only while
 * there is a query (`sortOptionsFor`).
 */
export function SortControl({ value, query, onChange }: SortControlProps): JSX.Element {
	const sel = useSignal(value);
	useEffect(() => {
		sel.value = value;
	}, [value]);
	return (
		<Select
			class="ex-sort"
			size="sm"
			aria-label="Sort results"
			options={sortOptionsFor(query)}
			value={sel}
			onValueChange={(v) => onChange(v)}
		/>
	);
}
