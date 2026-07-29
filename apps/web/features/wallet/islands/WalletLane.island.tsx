import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/wallet.css";
import {
	LaneCollapseButton,
	LaneFooter,
	LaneHead,
	LaneList,
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
	TransactionsGlyph,
} from "../core/glyphs.tsx";
import { laneItemsFor, viewHref, viewOf, type WalletView } from "../core/capability.ts";
import { seedWalletContext } from "../core/wallet-state.ts";
import type {
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
	const triggerRef = useRef<HTMLButtonElement>(null);

	const items = laneItemsFor(props.variant, props.capabilities, props.switcher.active.scope);
	const active = viewOf(props.path);
	const verify = verificationTone(props.verification);

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
						aria-expanded={switcherOpen.value}
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
				</LaneHead>

				<LaneList label="Wallet sections" class="wlt-lane__nav">
					{items.map((item) => (
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
