import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Icon } from "@projective/ui/icons";
import { MoneyView } from "@projective/ui/display/money";
import { LaneIconButton, LaneSection } from "@projective/ui/navigation";
import type { WalletOverview, WalletPotView } from "../types/wallet-types.ts";
import { scheduleRows } from "../core/wallet-home.ts";
import { openWalletDialog, type WalletSchedules } from "../core/wallet-state.ts";
import { WalletGlyph } from "./wallet-glyphs.tsx";

/** Props for {@link WalletRails}. */
export interface WalletRailsProps {
	overview: WalletOverview;
	/** The wallet's recurring deposits and automatic payout; `null` where they could not be read. */
	schedules: WalletSchedules | null;
	/** Keeps the sections' ids unique where the lane and the phone sheet both hold a copy. */
	idPrefix: string;
}

function potMeta(pot: WalletPotView): string | null {
	const share = pot.autoAllocateBp / 100;
	return share > 0 ? `Sets aside ${share.toLocaleString("en-GB")}% of income` : null;
}

function Pots(
	{ overview, idPrefix }: { overview: WalletOverview; idPrefix: string },
): JSX.Element | null {
	const open = useSignal(true);
	const pots = overview.personal?.pots ?? [];
	const lock = overview.locks.find((l) => l.code === "pots_not_running") ?? null;
	const canSave = overview.potActions.includes("save_pot");
	if (!overview.personal || (pots.length === 0 && !canSave)) return null;
	const trigger = canSave && lock
		? (
			<LaneIconButton
				icon={
					<span class="wlt-lane__actionicon" aria-hidden="true">
						<Icon name="plus" size="sm" />
						<Icon name="lock" class="wlt-lane__lock" />
					</span>
				}
				label="New pot, unavailable"
				tooltip={`New pot — ${lock.reason}`}
				onClick={() => openWalletDialog({ kind: "lock", code: lock.code })}
			/>
		)
		: undefined;
	return (
		<LaneSection
			id={`${idPrefix}-pots`}
			icon={<WalletGlyph name="escrow" size="sm" />}
			label="Pots & reserves"
			open={open.value}
			onToggle={() => (open.value = !open.value)}
			action={trigger}
		>
			{pots.length > 0
				? (
					<ul class="wlt-glance">
						{pots.map((pot) => {
							const meta = potMeta(pot);
							return (
								<li key={pot.id} class="wlt-glance__row">
									<span class="wlt-glance__name">{pot.name}</span>
									<MoneyView
										value={pot.balance}
										size="micro"
										hideOrigin
										class="wlt-glance__amount"
									/>
									{meta && <span class="wlt-glance__meta">{meta}</span>}
								</li>
							);
						})}
					</ul>
				)
				: <p class="wlt-glance__empty">Set money aside for tax or a goal.</p>}
		</LaneSection>
	);
}

function Scheduled(
	{ schedules, idPrefix }: { schedules: WalletSchedules | null; idPrefix: string },
): JSX.Element {
	const open = useSignal(true);
	const rows = scheduleRows(schedules?.rules ?? null, schedules?.schedule ?? null);
	return (
		<LaneSection
			id={`${idPrefix}-schedules`}
			icon={<Icon name="calendar" size="sm" />}
			label="Scheduled"
			open={open.value}
			onToggle={() => (open.value = !open.value)}
		>
			{rows.length > 0
				? (
					<ul class="wlt-glance">
						{rows.map((row) => (
							<li
								key={row.id}
								class="wlt-glance__row"
								data-paused={row.paused ? "true" : undefined}
							>
								<span class="wlt-glance__name">{row.title}</span>
								{row.amount && (
									<MoneyView
										value={row.amount}
										size="micro"
										hideOrigin
										class="wlt-glance__amount"
									/>
								)}
								{row.when && <span class="wlt-glance__meta">{row.when}</span>}
							</li>
						))}
					</ul>
				)
				: (
					<p class="wlt-glance__empty">
						{schedules ? "No active schedules" : "Schedules couldn’t be read just now."}
					</p>
				)}
		</LaneSection>
	);
}

/**
 * The wallet at a glance, beneath the page links: the money set aside in pots (a personal wallet's,
 * the only ones the overview projects), then the standing schedules — recurring deposits and the
 * automatic payout, each with its next run. Rows of facts in the meta register, never boxed or
 * pressable; the one control is a pot trigger, drawn only while pots are locked so it opens the
 * sentence that says why. Nothing for the read-only rollup, which holds no pots or schedules.
 */
export function WalletRails(props: WalletRailsProps): JSX.Element | null {
	if (props.overview.ref.scope === "aggregate") return null;
	return (
		<div class="wlt-rails">
			<Pots overview={props.overview} idPrefix={props.idPrefix} />
			<Scheduled schedules={props.schedules} idPrefix={props.idPrefix} />
		</div>
	);
}
