import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/wallet.css";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { InputText, Select, SelectButton } from "@projective/ui/fields";
import { Avatar } from "@projective/ui/display";
import {
	AccessGlyph,
	ActivityGlyph,
	ChevronGlyph,
	FilterGlyph,
	FundingGlyph,
	InvoicesGlyph,
	MethodsGlyph,
	OverviewGlyph,
	PayoutsGlyph,
	SearchGlyph,
	TransactionsGlyph,
} from "../core/glyphs.tsx";
import { FundStateMark } from "../components/FundStateMark.tsx";
import { laneItemsFor, viewHref, type WalletView } from "../core/capability.ts";
import {
	displayCurrency,
	flowPeriod,
	fundFilter,
	ledgerSearch,
	notifyWalletChanged,
} from "../core/wallet-state.ts";
import type {
	FundState,
	VaultCapability,
	WalletRef,
	WalletVariant,
} from "../types/wallet-types.ts";

/**
 * WalletHeaderBand — the sticky strip above the body.
 *
 * It answers "which wallet am I looking at, over what window, in what currency" and hosts search and
 * filtering. Everything here is a 32px BORDERLESS control on one row — that is the only way this band
 * holds this much without becoming a toolbar.
 *
 * The range and filter controls are here rather than in the body because the body's remit is viewing
 * and selecting data. A filter dropdown sitting above a table is the habit this region contract exists
 * to break: it makes the table's width negotiable, and the table's width is the whole point.
 *
 * Two of its controls were previously inert, which is a worse failure than a missing control because
 * the interface promises a capability and then declines to have it:
 *
 *  - **Search** rendered a field bound to a local signal that nothing read. It now writes the shared
 *    `ledgerSearch` and announces the change, so the ledger narrows as you type.
 *  - **Filter** opened a panel whose entire content was a sentence telling the reader to use the
 *    balance meter — a control that exists to redirect you to another control, on four pages where
 *    that meter is not rendered. It now carries the fund-state filter itself.
 */
export interface WalletHeaderBandProps {
	account: WalletRef;
	variant: WalletVariant;
	view: WalletView;
	display: string;
	currencies?: string[];
	/** The active wallet param, so the section links keep the scope. */
	scope: string;
	/** The viewer's vault capabilities, so the narrow-viewport section list matches the lane's. */
	capabilities: VaultCapability[];
}

const VARIANT_BADGE: Record<WalletVariant, string> = {
	personal: "Personal",
	team: "Team vault",
	business: "Business",
};

const VIEW_GLYPH: Record<WalletView, JSX.Element> = {
	overview: OverviewGlyph,
	transactions: TransactionsGlyph,
	activity: ActivityGlyph,
	payouts: PayoutsGlyph,
	funding: FundingGlyph,
	methods: MethodsGlyph,
	invoices: InvoicesGlyph,
	access: AccessGlyph,
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

const FUND_STATES: readonly { key: FundState; label: string }[] = [
	{ key: "available", label: "Available" },
	{ key: "locked", label: "In escrow" },
	{ key: "pending", label: "Pending" },
	{ key: "on_hold", label: "On hold" },
];

export default function WalletHeaderBand(props: WalletHeaderBandProps): JSX.Element {
	const searchOpen = useSignal(false);
	const filterOpen = useSignal(false);
	const sectionsOpen = useSignal(false);
	const searchRef = useRef<HTMLButtonElement>(null);
	const filterRef = useRef<HTMLButtonElement>(null);
	const sectionsRef = useRef<HTMLButtonElement>(null);

	const currencies = props.currencies ?? ["GBP", "USD", "EUR"];
	const badge = props.account.scope === "aggregate" ? "All accounts" : VARIANT_BADGE[props.variant];
	const sections = laneItemsFor(props.variant, props.capabilities, props.scope);
	const current = sections.find((s) => s.view === props.view);
	const activeFilter = fundFilter.value;

	return (
		<div class="wlt-headerband">
			{
				/*
				 * Revealed by CSS only where the lane is not rendered. Both presentations ship in the
				 * markup and one is revealed, the same technique the lane itself uses for its collapsed
				 * rail — a width observer would paint the wrong one for a frame on every load.
				 */
			}
			<span class="wlt-headerband__sections">
				<button
					type="button"
					class="wlt-headerband__section-trigger"
					ref={sectionsRef}
					aria-label={`Wallet section: ${current?.label ?? "Overview"}. Change section`}
					aria-haspopup="menu"
					aria-expanded={sectionsOpen.value ? "true" : "false"}
					onClick={() => {
						sectionsOpen.value = !sectionsOpen.value;
					}}
				>
					<span class="wlt-headerband__section-glyph" aria-hidden="true">
						{VIEW_GLYPH[props.view]}
					</span>
					<span class="wlt-headerband__section-name">{current?.label ?? "Overview"}</span>
					<span class="wlt-headerband__section-caret" aria-hidden="true">{ChevronGlyph}</span>
				</button>
				<Popover open={sectionsOpen} targetRef={sectionsRef} placement="bottom-start">
					<div class="wlt-headerband__menu" role="menu">
						{sections.map((s) => (
							<a
								key={s.view}
								class="wlt-headerband__menu-item"
								role="menuitem"
								href={viewHref(s.view, props.scope, props.display)}
								aria-current={s.view === props.view ? "page" : undefined}
							>
								<span class="wlt-headerband__menu-glyph" aria-hidden="true">
									{VIEW_GLYPH[s.view]}
								</span>
								{s.label}
							</a>
						))}
					</div>
				</Popover>
			</span>

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
								data-on={ledgerSearch.value ? "true" : "false"}
								aria-label={ledgerSearch.value ? `Search: ${ledgerSearch.value}` : "Search"}
								aria-haspopup="dialog"
								aria-expanded={searchOpen.value ? "true" : "false"}
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
									value={ledgerSearch.value}
									placeholder="Search this wallet…"
									aria-label="Search transactions"
									onValueChange={(v) => {
										ledgerSearch.value = v;
										notifyWalletChanged();
									}}
								/>
							</div>
						</Popover>

						<Tooltip content="Filter" placement="bottom">
							<button
								type="button"
								class="wlt-headerband__icon"
								ref={filterRef}
								data-on={activeFilter ? "true" : "false"}
								aria-label={activeFilter ? "Filter — one state selected" : "Filter"}
								aria-haspopup="dialog"
								aria-expanded={filterOpen.value ? "true" : "false"}
								onClick={() => {
									filterOpen.value = !filterOpen.value;
								}}
							>
								{FilterGlyph}
							</button>
						</Tooltip>
						<Popover open={filterOpen} targetRef={filterRef} placement="bottom-end">
							<div class="wlt-headerband__panel wlt-headerband__panel--filter">
								<p class="wlt-headerband__panel-note">Show only</p>
								{
									/*
									 * The same silhouettes the capital meter's legend uses (RULE C-3), so the two
									 * entry points to one filter never grow two vocabularies. Single-select, and
									 * pressing the engaged state clears it — exactly how the meter behaves.
									 */
								}
								{FUND_STATES.map((s) => (
									<button
										key={s.key}
										type="button"
										class="wlt-headerband__filter-option"
										aria-pressed={activeFilter === s.key}
										onClick={() => {
											fundFilter.value = activeFilter === s.key ? null : s.key;
											notifyWalletChanged();
										}}
									>
										<span class="wlt-headerband__filter-mark" aria-hidden="true">
											<FundStateMark state={s.key} />
										</span>
										{s.label}
									</button>
								))}
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
