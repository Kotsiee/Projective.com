import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { MetaLine } from "@projective/ui/display";
import { MoneyView } from "@projective/ui/display/money";
import { InlineNotice, Skeleton } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { FlowAreaChart } from "@features/wallet/components/FlowAreaChart.tsx";
import { WalletService } from "@features/wallet/core/WalletService.ts";
import type { ActivityView, MoneyView as Money } from "@features/wallet/types/wallet-types.ts";
import {
	CASH_FLOW_PHRASE,
	CASH_FLOW_RANGE,
	type CashFlowSource,
	flowIsEmpty,
} from "../../core/overview-deck.ts";

/** Props for {@link CashFlowPanel}. */
export interface CashFlowPanelProps {
	source: CashFlowSource;
}

/** Where the read is: in flight, landed, or refused with the server's words. */
type FlowState =
	| { status: "loading" }
	| { status: "ready"; activity: ActivityView }
	| { status: "error"; message: string };

const READ_FAILED = "Cash flow couldn't be loaded just now.";

/** The browser's zone, so a day bucket is the reader's day; the server's default when unknown. */
function readerZone(): string | null {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
	} catch {
		return null;
	}
}

/** A signed total: the true minus beside a positive figure, never a hyphen from the formatter. */
function Signed({ value, sign }: { value: Money; sign: "+" | "−" | null }): JSX.Element {
	if (value.minor < 0) {
		return (
			<MoneyView minor={-value.minor} currency={value.currency} size="key" sign="−" hideOrigin />
		);
	}
	return <MoneyView value={value} size="key" sign={value.minor > 0 ? sign : null} hideOrigin />;
}

function Totals({ activity }: { activity: ActivityView }): JSX.Element {
	return (
		<dl class="wsp-flow__totals">
			<div class="wsp-flow__total">
				<dt class="wsp-flow__term">
					<span class="wsp-flow__key wsp-flow__key--in" aria-hidden="true" />
					Money in
				</dt>
				<dd class="wsp-flow__figure">
					<Signed value={activity.totalIn} sign="+" />
				</dd>
			</div>
			<div class="wsp-flow__total">
				<dt class="wsp-flow__term">
					<span class="wsp-flow__key wsp-flow__key--out" aria-hidden="true" />
					Money out
				</dt>
				<dd class="wsp-flow__figure">
					<Signed value={activity.totalOut} sign="−" />
				</dd>
			</div>
			<div class="wsp-flow__total">
				<dt class="wsp-flow__term">Net</dt>
				<dd class="wsp-flow__figure">
					<Signed value={activity.net} sign={null} />
				</dd>
			</div>
		</dl>
	);
}

/** The block the chart will fill, held at its size while the read is in flight. */
function Placeholder(): JSX.Element {
	return (
		<div class="wsp-flow__skeleton">
			<span class="ui-visually-hidden">Loading cash flow</span>
			<div class="wsp-flow__skeleton-totals">
				<Skeleton class="wsp-flow__skeleton-figure" shape="text" />
				<Skeleton class="wsp-flow__skeleton-figure" shape="text" />
				<Skeleton class="wsp-flow__skeleton-figure" shape="text" />
			</div>
			<Skeleton class="wsp-flow__skeleton-plot" />
		</div>
	);
}

/**
 * CashFlowPanel — the entity wallet's money in and out over the last 30 days, read from
 * `/api/wallet/activity` (the wallet's own projection, summed in the database per day of the reader's
 * zone) and drawn by the wallet's `FlowAreaChart`: in above the baseline, out below, net as a line,
 * with its keyboard readout and hidden table.
 *
 * The panel's block size is reserved before the read lands (a skeleton the chart's size), so nothing
 * below it moves. A refused read is a sentence and a tier-4 Try again in place — never a broken
 * page — and a window in which nothing moved says so instead of drawing a flat line.
 */
export function CashFlowPanel({ source }: CashFlowPanelProps): JSX.Element {
	const state = useSignal<FlowState>({ status: "loading" });
	const attempt = useSignal(0);
	const retrying = useSignal(false);

	useSignalEffect(() => {
		void attempt.value;
		let current = true;
		WalletService.activity(
			{ wallet: source.wallet, display: null, timezone: readerZone() },
			CASH_FLOW_RANGE,
		)
			.then((res) => {
				if (!current) return;
				state.value = res.ok && res.data
					? { status: "ready", activity: res.data.activity }
					: { status: "error", message: res.message ?? READ_FAILED };
			})
			.catch((error: unknown) => {
				if (!current) return;
				state.value = {
					status: "error",
					message: error instanceof Error && error.message ? error.message : READ_FAILED,
				};
			})
			.finally(() => {
				if (current) retrying.value = false;
			});
		return () => {
			current = false;
		};
	});

	function retry(): void {
		retrying.value = true;
		attempt.value++;
	}

	const now = state.value;
	return (
		<div class="wsp-flow" aria-busy={now.status === "loading" || retrying.value}>
			{now.status === "loading" && <Placeholder />}
			{now.status === "error" && (
				<div class="wsp-flow__state">
					<InlineNotice align="start" text={now.message} />
					<Button
						severity="neutral"
						variant="outlined"
						size="sm"
						label="Try again"
						loading={retrying.value}
						onClick={retry}
					/>
				</div>
			)}
			{now.status === "ready" && flowIsEmpty(now.activity.flow) && (
				<div class="wsp-flow__state">
					<MetaLine items={[`No money moved in ${CASH_FLOW_PHRASE}.`]} />
				</div>
			)}
			{now.status === "ready" && !flowIsEmpty(now.activity.flow) && (
				<div class="wsp-flow__body">
					<Totals activity={now.activity} />
					<div class="wsp-flow__plot">
						<FlowAreaChart
							points={now.activity.flow}
							currency={now.activity.totalIn.currency}
							phrase={CASH_FLOW_PHRASE}
							spans={now.activity.grain !== "day"}
						/>
					</div>
				</div>
			)}
		</div>
	);
}
