import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/wallet.css";
import {
	LaneCollapseButton,
	LaneFooter,
	LaneFooterActions,
	LaneHead,
	LaneList,
} from "@projective/ui/navigation";
import { NavItem } from "@projective/ui/navigation";
import { Popover } from "@projective/ui/feedback";
import { Avatar } from "@projective/ui/display";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import { WalletRail } from "../components/WalletRail.tsx";
import WalletActionModals from "./WalletActionModals.island.tsx";
import { ChevronIcon, WalletIcon } from "../components/wallet-glyphs.tsx";
import { WalletService } from "../core/WalletService.ts";
import { capabilitiesForRole, walletVariant } from "../types/wallet-types.ts";
import { visibleNav, walletHref, type WalletView } from "../core/wallet-model.ts";
import { seedWalletContext } from "../core/wallet-state.ts";
import { currentWalletContext, type FlowPeriod, flowPeriod } from "../core/wallet-state.ts";
import { useWalletSeam } from "../core/wallet-seam.ts";
import type { WalletRef, WalletSwitcher } from "../types/wallet-types.ts";

/**
 * WalletLane — the middle-nav lane for `/wallet`, the finance face of the active context. Dual
 * presentation (an expanded stack + a collapsed {@link WalletRail}, CSS-switched by
 * `.ui-splitter[data-mode]`), composed from the shared `@projective/ui/navigation` lane chrome. It hosts
 * the account/context switcher (the active wallet + selectable vaults + the read-only "All accounts"
 * aggregate), the capability-gated sub-nav (Overview · Transactions · Activity · Payouts · Funding ·
 * Methods · (Invoices) · (Access)), and a footer (collapse toggle + a flow-period selector). Dumb — it
 * navigates + reads the shared context; the pages own their data. Active row is the SSR `path` prop (no
 * partials, Decision #52); the switcher balances refresh live when the dev currency axis changes.
 */

export interface WalletLaneProps {
	switcher: WalletSwitcher;
	activeWallet: string;
	activeView: WalletView;
	display: string;
	path: string;
}

export default function WalletLane(props: WalletLaneProps): JSX.Element {
	const switcher = useSignal<WalletSwitcher>(props.switcher);
	const collapsed = useSignal(false);

	// Seed the shared context, then mirror the dev seam (currency + sim) and refresh the switcher balances.
	seedWalletContext(props.activeWallet, props.display);
	useWalletSeam({
		display: props.display,
		wallet: props.activeWallet,
		onRefetch: async () => {
			const res = await WalletService.switcher(currentWalletContext());
			if (res.ok && res.data) switcher.value = res.data.switcher;
		},
	});

	// Seed the collapse glyph from the splitter density on mount (deterministic; no width observer).
	useEffect(() => {
		const el = globalThis.document?.querySelector(".ui-splitter");
		collapsed.value = (el as HTMLElement | null)?.dataset.mode === "collapsed";
	}, []);

	function setLaneCollapsed(next: boolean): void {
		collapsed.value = next;
		try {
			globalThis.dispatchEvent(
				new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
			);
		} catch { /* SSR / no window */ }
	}

	const active = switcher.value.active;
	const variant = walletVariant(active.scope);
	const caps = capabilitiesForRole(active.role ?? "owner");
	const nav = visibleNav(variant, caps);

	return (
		<div class="wallet-lane">
			<WalletRail
				switcher={switcher.value}
				nav={nav}
				activeView={props.activeView}
				activeWallet={props.activeWallet}
				onExpand={() => setLaneCollapsed(false)}
			/>

			<div class="wallet-lane__full">
				<LaneHead class="wallet-lane__head">
					<WalletSwitcherControl switcher={switcher.value} activeWallet={props.activeWallet} />
				</LaneHead>

				<LaneList label="Wallet sections" class="wallet-lane__nav">
					{nav.map((entry) => (
						<NavItem
							key={entry.view}
							href={walletHref(entry.view, props.activeWallet)}
							label={entry.label}
							icon={<WalletIcon name={entry.icon} size={20} />}
							active={entry.view === props.activeView}
						/>
					))}
				</LaneList>

				<LaneFooter>
					<LaneCollapseButton
						collapsed={collapsed.value}
						icon={<SidebarToggleIcon />}
						onToggle={() => setLaneCollapsed(!collapsed.value)}
					/>
					<LaneFooterActions>
						<PeriodSelector />
					</LaneFooterActions>
				</LaneFooter>
			</div>

			{/* Money-move modals — mounted once in the lane (present on every wallet page), opened via signals. */}
			<WalletActionModals />
		</div>
	);
}

// #region Account switcher (Popover: active wallet + accounts + aggregate)
function WalletSwitcherControl(
	{ switcher, activeWallet }: { switcher: WalletSwitcher; activeWallet: string },
): JSX.Element {
	const active = switcher.active;
	function switchTo(ref: WalletRef): void {
		const param = ref.scope === "personal"
			? "personal"
			: ref.scope === "aggregate"
			? "aggregate"
			: `${ref.scope}:${ref.id}`;
		try {
			const url = new URL(globalThis.location.href);
			if (param === "personal") url.searchParams.delete("w");
			else url.searchParams.set("w", param);
			globalThis.location.assign(url.pathname + url.search);
		} catch { /* no window */ }
	}

	return (
		<Popover
			placement="bottom-start"
			matchWidth
			trigger={(api) => (
				<button
					type="button"
					class="wallet-switch"
					aria-haspopup="menu"
					aria-expanded={api.expanded}
					aria-controls={api.panelId}
					ref={api.ref as RefObject<HTMLButtonElement>}
					onClick={api.toggle}
				>
					<WalletAvatar w={active} />
					<span class="wallet-switch__meta">
						<span class="wallet-switch__name">{active.name}</span>
						<span class="wallet-switch__balance">{active.available.display}</span>
					</span>
					<ChevronIcon size={16} class="wallet-switch__caret" />
				</button>
			)}
		>
			<div class="wallet-accounts" role="menu" aria-label="Switch wallet">
				{switcher.accounts.map((w) => (
					<WalletAccountRow
						key={`${w.scope}:${w.id}`}
						w={w}
						active={isActive(w, activeWallet)}
						onSelect={() => switchTo(w)}
					/>
				))}
				<div class="wallet-accounts__sep" role="separator" />
				<WalletAccountRow
					w={switcher.aggregate}
					active={activeWallet === "aggregate"}
					onSelect={() => switchTo(switcher.aggregate)}
					aggregate
				/>
			</div>
		</Popover>
	);
}

function isActive(w: WalletRef, activeWallet: string): boolean {
	if (w.scope === "personal") return activeWallet === "personal";
	if (w.scope === "aggregate") return activeWallet === "aggregate";
	return activeWallet === `${w.scope}:${w.id}`;
}

function WalletAvatar({ w }: { w: WalletRef }): JSX.Element {
	if (w.scope === "aggregate") {
		return (
			<span class="wallet-switch__agg" aria-hidden="true">
				<WalletIcon name="wallet" size={18} />
			</span>
		);
	}
	return <Avatar image={w.avatar ?? undefined} label={w.name} size={28} alt="" />;
}

function WalletAccountRow(
	{ w, active, onSelect, aggregate }: {
		w: WalletRef;
		active: boolean;
		onSelect: () => void;
		aggregate?: boolean;
	},
): JSX.Element {
	return (
		<button
			type="button"
			class="wallet-account"
			role="menuitemradio"
			aria-checked={active}
			data-active={active ? "true" : undefined}
			onClick={onSelect}
		>
			<WalletAvatar w={w} />
			<span class="wallet-account__meta">
				<span class="wallet-account__name">{w.name}</span>
				<span class="wallet-account__sub">
					{aggregate ? "Rollup" : w.role ? capitalise(w.role) : "Personal"}
				</span>
			</span>
			<span class="wallet-account__balance">{w.available.display}</span>
		</button>
	);
}

function capitalise(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
// #endregion

// #region Flow-period selector (lane footer)
const PERIODS: readonly FlowPeriod[] = ["30d", "60d", "90d"];

function PeriodSelector(): JSX.Element {
	return (
		<div class="wallet-period" role="group" aria-label="Flow period">
			{PERIODS.map((p) => (
				<button
					key={p}
					type="button"
					class="wallet-period__btn"
					data-on={flowPeriod.value === p ? "true" : undefined}
					aria-pressed={flowPeriod.value === p}
					onClick={() => (flowPeriod.value = p)}
				>
					{p}
				</button>
			))}
		</div>
	);
}
// #endregion
