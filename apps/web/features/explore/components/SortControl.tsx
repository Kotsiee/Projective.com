import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Select } from "@projective/ui/fields";
import { SORT_OPTIONS } from "../core/filter-config.ts";

/**
 * SortControl — the results sort selector. A `packages/ui` {@link Select} (no bespoke `<select>`),
 * rendered as the interactive control ALONE — the word "Sort" is intentionally dropped so the
 * dropdown reads as clean chrome. The parent island owns the value and writes it to the URL; a synced
 * local signal keeps the Select controlled across back/forward.
 */
export function SortControl(
	{ value, onChange }: { value: string; onChange: (value: string) => void },
): JSX.Element {
	const sel = useSignal(value);
	useEffect(() => {
		sel.value = value;
	}, [value]);
	return (
		<Select
			class="ex-sort"
			size="sm"
			aria-label="Sort results"
			options={SORT_OPTIONS}
			value={sel}
			onValueChange={(v) => onChange(v)}
		/>
	);
}
