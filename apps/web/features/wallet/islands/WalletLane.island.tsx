import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/wallet.css";
import {
	LaneBar,
	LaneCollapseButton,
	LaneEmpty,
	LaneFooter,
	LaneHead,
	LaneList,
	LaneSearch,
	type LaneToggleOption,
	LaneToggleRow,
	NavItem,
} from "@projective/ui/navigation";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { Avatar } from "@projective/ui/display";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import { WalletIdCard } from "../components/WalletIdCard.tsx";
import {
	AccessGlyph,
	ActivityGlyph,
	CollapseGlyph,
	FundingGlyph,
	InvoicesGlyph,
	MethodsGlyph,
	OverviewGlyph,
	PayoutsGlyph,
	SearchGlyph,
	TransactionsGlyph,
} from "../core/glyphs.tsx";
import { FundStateMark } from "../components/FundStateMark.tsx";
import { laneItemsFor, viewHref, viewOf, type WalletView } from "../core/capability.ts";
import { fundFilter, notifyWalletChanged, seedWalletContext } from "../core/wallet-state.ts";
import type {
	FundState,
	VaultCapability,
	WalletRef,
	WalletSwitcher,
	WalletVariant,
	WalletVerification,
} from "../types/wallet-types.ts";

/**
 * WalletLane — the middle-nav lane: which wallet, which section, and whether this identity can be
 * paid.
 *
 * Both presentations are always in the DOM and CSS reveals exactly one, keyed off the splitter's
 * `data-mode`. That is the shipped repo pattern, and it matters particularly here: a width observer
 * would paint the wrong presentation for a frame on every load, and an account switcher that
 * flickers on a finance surface reads as a bug in the money.
 *
 * Navigation is gated by **absence, not disablement**. `Invoices` is a business instrument and
 * `Access` is vault governance, so a personal wallet and a plain member never receive them — a
 * greyed-out Access tab would advertise a power the viewer will never hold on this vault.
 */
export interface WalletLaneProps {
	switcher: WalletSwitcher;
	activeWallet: string;
	variant: WalletVariant;
	capabilities: VaultCapability[];
	verification: WalletVerification;
	display: string;
	path: string;
}

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

/**
 * The lane's icon-ONLY quick filters — the same permanent tag row `/projects` and `/catalogue` carry,
 * here narrowing the ledger by fund state.
 *
 * Each glyph is the state's canonical SILHOUETTE ({@link FundStateMark}, RULE C-3) rather than a
 * generic tag icon, so the row agrees shape-for-shape with the capital meter that also writes this
 * filter — one fact, two entry points, never two vocabularies. The row is deliberately single-select
 * (`fundFilter` holds one state or none, and the meter toggles it the same way), so pressing an
 * engaged toggle clears it.
 */
const FUND_TOGGLES: readonly LaneToggleOption<FundState>[] = [
	{ key: "available", label: "Available", icon: <FundStateMark state="available" /> },
	{ key: "locked", label: "Locked", icon: <FundStateMark state="locked" /> },
	{
		key: "pending",
		label: "Pending",
		icon: <FundStateMark state="pending" clearingFraction={0.6} />,
	},
	{ key: "on_hold", label: "On hold", icon: <FundStateMark state="on_hold" /> },
];

/**
 * The verification signal. Each state carries its own WORDS as well as its tone, so the meaning
 * survives a colour-blind palette and a greyscale print (RULE C-3).
 */
function verificationTone(v: WalletVerification): { tone: string; text: string } {
	if (v.kycStatus !== "verified") return { tone: "warn", text: "Verification needed" };
	if (!v.payoutReady) return { tone: "warn", text: "No payout method" };
	return { tone: "ok", text: "Verified · payouts on" };
}

export default function WalletLane(props: WalletLaneProps): JSX.Element {
	const collapsed = useSignal(false);
	const switcherOpen = useSignal(false);
	const query = useSignal("");
	const triggerRef = useRef<HTMLButtonElement>(null);

	const items = laneItemsFor(props.variant, props.capabilities, props.switcher.active.scope);
	const active = viewOf(props.path);
	const verify = verificationTone(props.verification);

	// Find-in-lane, exactly like the `/projects` feed: it narrows the rows this lane already holds and
	// changes nothing about the page, so it costs no navigation and no round trip.
	const q = query.value.trim().toLowerCase();
	const visible = q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;

	/**
	 * Single-select, mirroring the capital meter: pressing the engaged state clears the filter.
	 *
	 * The pulse is not optional. The Overview's recent ledger reads `fundFilter` reactively and needs
	 * nothing, but the Transactions page fetches its rows from the server with the fund state in the
	 * query — so without {@link notifyWalletChanged} the toggle would light up and the table under it
	 * would not move, which reads as a broken filter rather than an unfetched one.
	 */
	const onFundToggle = (state: FundState) => {
		fundFilter.value = fundFilter.value === state ? null : state;
		notifyWalletChanged();
	};

	useEffect(() => {
		seedWalletContext(props.activeWallet, props.display);
		// The splitter owns the width; the lane mirrors its state only so the toggle glyph is right.
		const el = document.querySelector(".ui-splitter") as HTMLElement | null;
		if (el) collapsed.value = el.dataset.mode === "collapsed";
	}, []);

	const setCollapsed = (next: boolean) => {
		collapsed.value = next;
		globalThis.dispatchEvent(
			new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
		);
	};

	const accountHref = (ref: WalletRef) => {
		const param = ref.scope === "personal"
			? "personal"
			: ref.scope === "aggregate"
			? "aggregate"
			: `${ref.scope}:${ref.id}`;
		return viewHref(active, param, props.display);
	};

	const isActive = (a: WalletRef) =>
		a.scope === "personal"
			? props.activeWallet === "personal"
			: `${a.scope}:${a.id}` === props.activeWallet;

	return (
		<div class="wlt-lanewrap">
			{/* Collapsed presentation — revealed by CSS at the rail density. */}
			<div class="wlt-rail">
				<div class="wlt-rail__brand">
					<Tooltip content={props.switcher.active.name} placement="right">
						<a
							class="wlt-rail__switch"
							href={viewHref("overview", props.activeWallet, props.display)}
							aria-label={`Active wallet: ${props.switcher.active.name}`}
							data-verify={verify.tone}
						>
							<Avatar
								image={props.switcher.active.avatar ?? undefined}
								label={props.switcher.active.name}
								size="sm"
								shape="circle"
							/>
						</a>
					</Tooltip>
				</div>

				<div class="wlt-rail__items" role="list">
					{items.map((item) => (
						<Tooltip content={item.label} placement="right" key={item.view}>
							<a
								class="wlt-rail__item"
								href={viewHref(item.view, props.activeWallet, props.display)}
								data-active={item.view === active ? "true" : "false"}
								aria-current={item.view === active ? "page" : undefined}
								aria-label={item.label}
							>
								{VIEW_GLYPH[item.view]}
							</a>
						</Tooltip>
					))}
				</div>

				<div class="wlt-rail__bottom">
					<Tooltip content={props.verification.prompt ?? verify.text} placement="right">
						<span
							class="wlt-rail__verify"
							data-tone={verify.tone}
							role="img"
							aria-label={verify.text}
						/>
					</Tooltip>
					<Tooltip content="Expand lane" placement="right">
						<button
							type="button"
							class="wlt-rail__toggle"
							aria-label="Expand lane"
							onClick={() => setCollapsed(false)}
						>
							{CollapseGlyph}
						</button>
					</Tooltip>
				</div>
			</div>

			{/* Expanded presentation. */}
			<div class="wlt-lane">
				<LaneHead class="wlt-lane__head">
					<button
						type="button"
						class="wlt-lane__switch"
						ref={triggerRef}
						aria-haspopup="listbox"
						aria-expanded={switcherOpen.value ? "true" : "false"}
						onClick={() => {
							switcherOpen.value = !switcherOpen.value;
						}}
					>
						<WalletIdCard account={props.switcher.active} size="md" active />
					</button>
					<Popover
						open={switcherOpen}
						targetRef={triggerRef}
						placement="bottom-start"
						avoid={[".ui-app-shell__sidebar"]}
					>
						<div class="wlt-lane__accounts" role="listbox" aria-label="Switch wallet">
							{props.switcher.accounts.map((a) => (
								<a
									class="wlt-lane__account"
									key={`${a.scope}:${a.id}`}
									href={accountHref(a)}
									role="option"
									aria-selected={isActive(a)}
								>
									<WalletIdCard account={a} size="md" active={isActive(a)} />
								</a>
							))}
							<div class="wlt-lane__accounts-sep" role="separator" />
							<a
								class="wlt-lane__account"
								href={accountHref(props.switcher.aggregate)}
								role="option"
								aria-selected={props.activeWallet === "aggregate"}
							>
								<WalletIdCard account={props.switcher.aggregate} size="md" readonly />
								<span class="wlt-lane__account-note">All accounts · read-only</span>
							</a>
						</div>
					</Popover>

					{/* The shared lane chrome: one search bar and one icon-only tag row, as on `/projects`. */}
					<LaneBar>
						<LaneSearch
							value={query.value}
							placeholder="Search this wallet"
							label="Search wallet sections"
							icon={SearchGlyph}
							onInput={(v) => (query.value = v)}
						/>
					</LaneBar>

					<LaneToggleRow
						label="Fund state"
						options={FUND_TOGGLES}
						active={fundFilter.value ? [fundFilter.value] : []}
						onToggle={onFundToggle}
					/>
				</LaneHead>

				<LaneList label="Wallet sections" class="wlt-lane__nav">
					{visible.length === 0
						? (
							<LaneEmpty
								title="No section matches"
								note="Try a shorter term, or clear the search."
							/>
						)
						: visible.map((item) => (
							<NavItem
								key={item.view}
								href={viewHref(item.view, props.activeWallet, props.display)}
								label={item.label}
								icon={VIEW_GLYPH[item.view]}
								active={item.view === active}
							/>
						))}
				</LaneList>

				{/* Ambient, not an alert: the state is always shown, the CTA only when there is one. */}
				<div class="wlt-lane__verify" data-tone={verify.tone}>
					<span class="wlt-lane__verify-dot" aria-hidden="true" />
					<span class="wlt-lane__verify-text">{verify.text}</span>
					{props.verification.href && props.verification.prompt && (
						<a class="wlt-lane__verify-link" href={props.verification.href}>Finish</a>
					)}
				</div>

				<LaneFooter>
					<LaneCollapseButton
						collapsed={collapsed.value}
						icon={CollapseGlyph}
						onToggle={() => setCollapsed(!collapsed.value)}
					/>
				</LaneFooter>
			</div>
		</div>
	);
}
