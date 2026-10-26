import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import "@web/features/projects/styles/fx-toolbar.css";
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
 * The Transactions page's filter bar, as the SHARED `.fx-toolbar` the File Explorer, the member
 * rosters and the Catalogue console draw (borderless search · bare filter fields): a text search
 * (counterparty, project, description), the direction toggle and the category selector. The window
 * ruler and the CSV download live in the footer band (`LedgerTools`). Every change is the caller's to
 * apply and to write into the URL; the search applies once typing rests, or at once on Enter.
 */
export function LedgerFilters(props: LedgerFiltersProps): JSX.Element {
	const { filters } = props;
	const draft = useSignal(filters.q);
	const rest = useRef<ReturnType<typeof setTimeout> | null>(null);

	const commitSearch = (q: string) => {
		if (rest.current) clearTimeout(rest.current);
		rest.current = null;
		if (q.trim() !== filters.q.trim()) props.onChange({ ...filters, q });
	};

	const onType = (q: string) => {
		if (rest.current) clearTimeout(rest.current);
		rest.current = setTimeout(() => commitSearch(q), SEARCH_REST_MS);
	};

	return (
		<div class="fx-toolbar wlt-filters" role="search" aria-label="Filter transactions">
			<div class="fx-toolbar__search">
				<InputText
					type="search"
					variant="bare"
					size="sm"
					block
					value={draft}
					placeholder="Search people, projects, descriptions"
					aria-label="Search transactions"
					start={
						<span class="fx-toolbar__searchicon" aria-hidden="true">
							<Icon name="search" size="sm" />
						</span>
					}
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
			</div>
			<span class="fx-toolbar__spacer" />
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
				class="ui-field--bare wlt-filters__kinds"
				size="sm"
				display="chip"
				aria-label="Category"
				options={KIND_OPTIONS}
				value={filters.kinds}
				placeholder="All categories"
				maxSelectedLabels={1}
				onValueChange={(v) => props.onChange({ ...filters, kinds: v as LedgerKind[] })}
			/>
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
		</div>
	);
}
