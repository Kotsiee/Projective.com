import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/wallet.css";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { InputText, Select, SelectButton } from "@projective/ui/fields";
import { Avatar } from "@projective/ui/display";
import { FilterGlyph, SearchGlyph } from "../core/glyphs.tsx";
import type { WalletView } from "../core/capability.ts";
import { displayCurrency, flowPeriod, notifyWalletChanged } from "../core/wallet-state.ts";
import type { WalletRef, WalletVariant } from "../types/wallet-types.ts";

/**
 * WalletHeaderBand — the 48px sticky strip above the body.
 *
 * It answers "which wallet am I looking at, over what window, in what currency" and hosts the entry
 * points to search and filtering. Everything here is a 32px BORDERLESS control on one row — that is
 * the only way 48px holds this much without the band becoming a toolbar.
 *
 * The range and filter controls are here rather than in the body because the body's remit is
 * viewing and selecting data. A filter dropdown sitting above a table is the habit this region
 * contract exists to break: it makes the table's width negotiable, and the table's width is the
 * whole point.
 */
export interface WalletHeaderBandProps {
	account: WalletRef;
	variant: WalletVariant;
	view: WalletView;
	display: string;
	currencies?: string[];
}

const VARIANT_BADGE: Record<WalletVariant, string> = {
	personal: "Personal",
	team: "Team vault",
	business: "Business",
};

/** The range control belongs only where a range means something. */
const RANGED: ReadonlySet<WalletView> = new Set(["overview", "activity"]);
/** Search and filter belong only where there are rows to narrow. */
const SEARCHABLE: ReadonlySet<WalletView> = new Set([
	"transactions",
	"payouts",
	"invoices",
	"access",
]);

const RANGES = [
	{ label: "30d", value: "30d" },
	{ label: "60d", value: "60d" },
	{ label: "90d", value: "90d" },
];

export default function WalletHeaderBand(props: WalletHeaderBandProps): JSX.Element {
	const searchOpen = useSignal(false);
	const filterOpen = useSignal(false);
	const query = useSignal("");
	const searchRef = useRef<HTMLButtonElement>(null);
	const filterRef = useRef<HTMLButtonElement>(null);

	const currencies = props.currencies ?? ["GBP", "USD", "EUR"];
	const badge = props.account.scope === "aggregate" ? "All accounts" : VARIANT_BADGE[props.variant];

	return (
		<div class="wlt-headerband">
			<span class="wlt-headerband__identity">
				<Avatar
					image={props.account.avatar ?? undefined}
					label={props.account.name}
					size="sm"
					shape="circle"
				/>
				<span class="wlt-headerband__name">{props.account.name}</span>
				<span class="wlt-headerband__badge">{badge}</span>
			</span>

			<span class="wlt-headerband__controls">
				{RANGED.has(props.view) && (
					<span class="wlt-headerband__range">
						<SelectButton
							options={RANGES}
							value={flowPeriod.value}
							aria-label="Reporting window"
							onValueChange={(v) => {
								if (v === "30d" || v === "60d" || v === "90d") {
									flowPeriod.value = v;
									notifyWalletChanged();
								}
							}}
						/>
					</span>
				)}

				{SEARCHABLE.has(props.view) && (
					<>
						<Tooltip content="Search" placement="bottom">
							<button
								type="button"
								class="wlt-headerband__icon"
								ref={searchRef}
								aria-label="Search"
								aria-haspopup="dialog"
								aria-expanded={searchOpen.value}
								onClick={() => {
									searchOpen.value = !searchOpen.value;
								}}
							>
								{SearchGlyph}
							</button>
						</Tooltip>
						<Popover open={searchOpen} targetRef={searchRef} placement="bottom-end">
							<div class="wlt-headerband__panel">
								<InputText
									value={query.value}
									placeholder="Search this wallet…"
									aria-label="Search transactions"
									onValueChange={(v) => {
										query.value = v;
									}}
								/>
							</div>
						</Popover>

						<Tooltip content="Filter" placement="bottom">
							<button
								type="button"
								class="wlt-headerband__icon"
								ref={filterRef}
								aria-label="Filter"
								aria-haspopup="dialog"
								aria-expanded={filterOpen.value}
								onClick={() => {
									filterOpen.value = !filterOpen.value;
								}}
							>
								{FilterGlyph}
							</button>
						</Tooltip>
						<Popover open={filterOpen} targetRef={filterRef} placement="bottom-end">
							<div class="wlt-headerband__panel">
								<p class="wlt-headerband__panel-note">
									Select a state in the balance meter to filter the ledger.
								</p>
							</div>
						</Popover>
					</>
				)}

				<span class="wlt-headerband__currency">
					<Select
						options={currencies.map((c) => ({ label: c, value: c }))}
						value={displayCurrency.value || props.display}
						aria-label="Display currency"
						onValueChange={(v) => {
							if (typeof v === "string") {
								displayCurrency.value = v;
								notifyWalletChanged();
							}
						}}
					/>
				</span>
			</span>
		</div>
	);
}
