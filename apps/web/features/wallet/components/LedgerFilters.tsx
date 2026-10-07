import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { InlineNotice } from "@projective/ui/feedback";
import { Button, InputText, MultiSelect, SelectButton } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { LedgerKind } from "../types/wallet-types.ts";
import {
	LEDGER_KIND_CHOICES,
	type LedgerDirection,
	ledgerFiltered,
	type LedgerFilters as Filters,
	ledgerKindLabel,
} from "../core/wallet-model.ts";

/** Props for {@link LedgerFilters}. */
export interface LedgerFiltersProps {
	filters: Filters;
	onChange: (next: Filters) => void;
	/** Download the ledger as filtered; resolves with the refusal's sentence, or `null` on success. */
	onExport: () => Promise<string | null>;
	/** Whether there is anything to export. */
	canExport: boolean;
}

/** How long typing rests before the search is applied (ms). */
const SEARCH_REST_MS = 300;

const DIRECTIONS = [
	{ label: "All", value: "all" },
	{ label: "In", value: "in" },
	{ label: "Out", value: "out" },
];

const KIND_OPTIONS = LEDGER_KIND_CHOICES.map((kind) => ({
	label: ledgerKindLabel(kind),
	value: kind,
}));

/**
 * The Transactions page's filter bar, one row above the ledger it scopes: a text search (counterparty,
 * project, description), the direction toggle, the category selector, and the CSV download — with the
 * window on the pinned range ruler above. Every change is the caller's to apply and to write into the
 * URL; the search applies once typing rests, or at once on Enter.
 *
 * The download is a request, not a link: only a CSV answer becomes a file, and a refusal is shown here
 * as an alert in its own words — never saved to disk as `export.csv`.
 */
export function LedgerFilters(props: LedgerFiltersProps): JSX.Element {
	const { filters } = props;
	const draft = useSignal(filters.q);
	const exporting = useSignal(false);
	const exportError = useSignal<string | null>(null);
	const rest = useRef<ReturnType<typeof setTimeout> | null>(null);

	const commitSearch = (q: string) => {
		if (rest.current) clearTimeout(rest.current);
		rest.current = null;
		if (q.trim() !== filters.q.trim()) props.onChange({ ...filters, q });
	};

	const onType = (q: string) => {
		draft.value = q;
		if (rest.current) clearTimeout(rest.current);
		rest.current = setTimeout(() => commitSearch(q), SEARCH_REST_MS);
	};

	const runExport = async () => {
		if (exporting.value) return;
		exporting.value = true;
		exportError.value = null;
		exportError.value = await props.onExport();
		exporting.value = false;
	};

	return (
		<div class="wlt-filters">
			<div class="wlt-filters__row" role="search" aria-label="Filter transactions">
				<InputText
					type="search"
					class="wlt-filters__search"
					value={draft.value}
					placeholder="Search people, projects, descriptions"
					aria-label="Search transactions"
					start={<Icon name="search" size="sm" />}
					maxLength={160}
					enterKeyHint="search"
					onValueChange={onType}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							commitSearch(draft.value);
						}
					}}
				/>
				<SelectButton
					class="wlt-filters__dir"
					aria-label="Direction"
					options={DIRECTIONS}
					value={filters.dir}
					onValueChange={(v) => {
						if (typeof v === "string" && v !== filters.dir) {
							props.onChange({ ...filters, dir: v as LedgerDirection });
						}
					}}
				/>
				<MultiSelect
					class="wlt-filters__kinds"
					aria-label="Category"
					options={KIND_OPTIONS}
					value={filters.kinds}
					placeholder="All categories"
					maxSelectedLabels={1}
					showClear
					onValueChange={(v) => props.onChange({ ...filters, kinds: v as LedgerKind[] })}
				/>
				<span class="wlt-filters__end">
					{ledgerFiltered(filters) && (
						<Button
							variant="text"
							size="sm"
							label="Clear"
							onClick={() => {
								draft.value = "";
								props.onChange({ ...filters, q: "", dir: "all", kinds: [] });
							}}
						/>
					)}
					<Button
						variant="outlined"
						size="sm"
						icon={<Icon name="download" size="sm" />}
						label="Download CSV"
						loading={exporting.value}
						disabled={exporting.value || !props.canExport}
						onClick={() => void runExport()}
					/>
				</span>
			</div>
			{exportError.value && (
				<InlineNotice
					text={exportError.value}
					assertive
					align="start"
					actionLabel="Try again"
					onAction={() => void runExport()}
					busy={exporting.value}
					class="wlt-filters__notice"
				/>
			)}
		</div>
	);
}
