import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { InlineNotice, Popover, Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { CurrencyLabel, Flag } from "@projective/ui/display";
import { styleVars } from "@ui/core/style.ts";
import { DISPLAY_CURRENCIES } from "@projective/types/finance";
import { commitDisplayCurrency } from "@web/features/shell/core/currency-state.ts";
import { openSettings } from "@features/settings/core/settings-bridge.ts";
import { FLOW_PERIODS, type FlowPeriod, periodLabel, periodPhrase } from "../core/wallet-model.ts";
import { walletLedgerTools } from "../core/wallet-state.ts";

// #region Range ruler
/**
 * The overview's cash-flow window as a segmented ruler: seven equal cells under one sliding thumb,
 * pinned under the top bar over the aurora while the page scrolls beneath it (the footer rig draws
 * {@link PeriodRuler} instead). A radiogroup — the arrow keys move and select
 * (mirrored under a right-to-left writing direction), Home and End jump to the ends — so it is one tab
 * stop however many windows it offers.
 *
 * The thumb is decoration: the checked cell carries the state in its own ink and weight, so a frozen
 * animation clock can leave the thumb mid-slide without the ruler ever saying the wrong window.
 */
export function RangeRuler(
	{ value, onChange }: { value: FlowPeriod; onChange: (next: FlowPeriod) => void },
): JSX.Element {
	const groupRef = useRef<HTMLDivElement>(null);
	const index = Math.max(0, FLOW_PERIODS.indexOf(value));

	const move = (e: KeyboardEvent) => {
		const rtl = getComputedStyle(e.currentTarget as Element).direction === "rtl";
		const forward = rtl ? "ArrowLeft" : "ArrowRight";
		const back = rtl ? "ArrowRight" : "ArrowLeft";
		const last = FLOW_PERIODS.length - 1;
		let next = index;
		if (e.key === forward || e.key === "ArrowDown") next = Math.min(last, index + 1);
		else if (e.key === back || e.key === "ArrowUp") next = Math.max(0, index - 1);
		else if (e.key === "Home") next = 0;
		else if (e.key === "End") next = last;
		else return;
		e.preventDefault();
		if (next === index) return;
		onChange(FLOW_PERIODS[next]);
		groupRef.current?.querySelector<HTMLElement>(`[data-period="${FLOW_PERIODS[next]}"]`)?.focus();
	};

	return (
		<div
			ref={groupRef}
			class="wlt-ruler"
			role="radiogroup"
			aria-label="Cash-flow window"
			style={styleVars({ "--wlt-ruler-i": index, "--wlt-ruler-n": FLOW_PERIODS.length })}
			onKeyDown={move}
		>
			<span class="wlt-ruler__thumb" aria-hidden="true" />
			{FLOW_PERIODS.map((period) => {
				const checked = period === value;
				const label = periodLabel(period);
				return (
					<button
						key={period}
						type="button"
						role="radio"
						class="wlt-ruler__cell"
						data-period={period}
						aria-checked={checked ? "true" : "false"}
						tabIndex={checked ? 0 : -1}
						onClick={() => {
							if (!checked) onChange(period);
						}}
					>
						<span aria-hidden="true">{label}</span>
						<span class="ui-visually-hidden">{label}, {periodPhrase(period)}</span>
					</button>
				);
			})}
		</div>
	);
}
// #endregion

// #region Period ruler
// shortcut: mirrors `CalendarZoom`'s instrument rather than sharing it (that one is bound to the
// calendar's zoom stops); extract a generic `@projective/ui` ruler when a third surface needs one.

/** Minor ticks per window: the `/calendar` ruler's scale, drawn at the same density. */
const TICKS_PER_PERIOD = 4;

function clamp01(n: number): number {
	return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

/**
 * The cash-flow window as the `/calendar` view ruler (`CalendarZoom`): each window a zone with its
 * name above, a major tick at every boundary and minor ticks inside, and one marker resting on the
 * centre of the chosen zone. The marker follows a held pointer exactly and glides onto the zone it
 * is released in; the window is committed on release, not per zone crossed, because every window is
 * a server read where the calendar's zoom is only a layout.
 *
 * A `role="slider"` in its own right: the arrows move one window (mirrored under a right-to-left
 * writing direction), Home and End jump to the ends, and the window is the spoken value.
 */
export function PeriodRuler(
	{ value, onChange }: { value: FlowPeriod; onChange: (next: FlowPeriod) => void },
): JSX.Element {
	const rulerRef = useRef<HTMLDivElement>(null);
	/** The raw position under a held pointer; `null` at rest, when the marker shows the chosen window. */
	const held = useSignal<number | null>(null);
	const n = FLOW_PERIODS.length;
	const index = Math.max(0, FLOW_PERIODS.indexOf(value));
	const zoneAt = (along: number) => Math.min(n - 1, Math.floor(along * n));
	const active = held.value === null ? index : zoneAt(held.value);
	const steps = n * TICKS_PER_PERIOD;

	const commit = (i: number) => {
		if (FLOW_PERIODS[i] !== value) onChange(FLOW_PERIODS[i]);
	};

	const atPointer = (e: PointerEvent): number => {
		const el = rulerRef.current;
		if (!el) return (index + 0.5) / n;
		const r = el.getBoundingClientRect();
		const rtl = getComputedStyle(el).direction === "rtl";
		return clamp01((rtl ? r.right - e.clientX : e.clientX - r.left) / r.width);
	};

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
		const forward = rtl ? "ArrowLeft" : "ArrowRight";
		const back = rtl ? "ArrowRight" : "ArrowLeft";
		const next = e.key === forward || e.key === "ArrowUp"
			? Math.min(n - 1, index + 1)
			: e.key === back || e.key === "ArrowDown"
			? Math.max(0, index - 1)
			: e.key === "Home"
			? 0
			: e.key === "End"
			? n - 1
			: null;
		if (next === null) return;
		e.preventDefault();
		commit(next);
	};

	return (
		<div
			ref={rulerRef}
			class="wlt-scale"
			role="slider"
			tabIndex={0}
			aria-label="Cash-flow window"
			aria-orientation="horizontal"
			aria-valuemin={0}
			aria-valuemax={n - 1}
			aria-valuenow={active}
			aria-valuetext={`${periodLabel(FLOW_PERIODS[active])}, ${periodPhrase(FLOW_PERIODS[active])}`}
			data-held={held.value === null ? undefined : "true"}
			style={styleVars({ "--wlt-scale-n": n, "--wlt-scale-at": held.value ?? (index + 0.5) / n })}
			onPointerDown={(e) => {
				if (e.button !== 0) return;
				e.currentTarget.setPointerCapture(e.pointerId);
				e.currentTarget.focus();
				held.value = atPointer(e);
			}}
			onPointerMove={(e) => {
				if (held.value !== null) held.value = atPointer(e);
			}}
			onPointerUp={(e) => {
				if (held.value === null) return;
				const i = zoneAt(atPointer(e));
				held.value = null;
				commit(i);
			}}
			onPointerCancel={() => (held.value = null)}
			onLostPointerCapture={() => (held.value = null)}
			onKeyDown={onKeyDown}
		>
			<div class="wlt-scale__names" aria-hidden="true">
				{FLOW_PERIODS.map((period, i) => (
					<span
						key={period}
						class="wlt-scale__name"
						data-on={i === active ? "true" : undefined}
						style={styleVars({ "--wlt-tick-at": i / n })}
					>
						{periodLabel(period)}
					</span>
				))}
			</div>
			<div class="wlt-scale__track" aria-hidden="true">
				{Array.from({ length: steps + 1 }, (_, i) => (
					<span
						key={i}
						class="wlt-scale__tick"
						data-major={i % TICKS_PER_PERIOD === 0 ? "true" : undefined}
						style={styleVars({ "--wlt-tick-at": i / steps })}
					/>
				))}
				<span class="wlt-scale__marker" />
			</div>
		</div>
	);
}
// #endregion

// #region Ledger tools
/**
 * The Transactions and Analytics pages' footer rig (`walletFooterFor`): the window ruler in the
 * centre and an icon-only ghost Download on the trailing edge — the `/calendar` rig's anatomy. Both
 * drive the page body through {@link walletLedgerTools}; until the page has hydrated the ruler is an
 * address like any other and the download waits.
 *
 * The download is a request, not a link: only a CSV answer becomes a file, and a refusal is shown here
 * in its own words — never saved to disk as `export.csv`.
 */
export function LedgerTools({ fallback }: { fallback: FlowPeriod }): JSX.Element {
	const tools = walletLedgerTools.value;
	const exporting = useSignal(false);
	const error = useSignal<string | null>(null);

	const choose = (next: FlowPeriod) => {
		if (tools) return tools.choose(next);
		// An explicit `?flow=` is read the same way on both pages, whatever each one's default window.
		const url = new URL(location.href);
		url.searchParams.set("flow", next);
		location.assign(url);
	};

	const run = async () => {
		if (!tools || exporting.value) return;
		exporting.value = true;
		error.value = null;
		error.value = await tools.exportCsv();
		exporting.value = false;
	};

	return (
		<div class="wlt-ledgertools">
			<PeriodRuler value={tools?.period ?? fallback} onChange={choose} />
			<div class="wlt-ledgertools__actions">
				<Tooltip content="Download CSV">
					<Button
						iconOnly
						rounded
						size="sm"
						variant="text"
						severity="secondary"
						class="wlt-ledgertools__icon ui-hit"
						icon={<Icon name="download" size="sm" />}
						aria-label="Download"
						loading={exporting.value}
						disabled={exporting.value || !tools?.canExport}
						onClick={() => void run()}
					/>
				</Tooltip>
			</div>
			{error.value && (
				<InlineNotice
					text={error.value}
					assertive
					align="start"
					actionLabel="Try again"
					onAction={() => void run()}
					busy={exporting.value}
				/>
			)}
		</div>
	);
}
// #endregion

// #region Currency
/**
 * The display-currency trigger. It writes the SAME store as Settings → Language & region and the
 * checkout's picker, so they can never disagree about what the page is drawn in; the page hears the
 * change and re-reads its figures converted server-side. The list rows are the standard
 * `CurrencyLabel`; the trigger is a one-line glass pill (flag · symbol · code) by the hero's tool
 * contract.
 */
function CurrencyTrigger({ current }: { current: string }): JSX.Element {
	const open = useSignal(false);
	const saving = useSignal<string | null>(null);
	const failed = useSignal(false);
	const active = DISPLAY_CURRENCIES.find((c) => c.code === current);

	const pick = async (code: string) => {
		if (saving.value) return;
		open.value = false;
		if (code === current) return;
		saving.value = code;
		const saved = await commitDisplayCurrency(code);
		saving.value = null;
		failed.value = !saved;
	};

	return (
		<Popover
			open={open}
			placement="bottom-end"
			label="Display currency"
			class="wlt-glass-pop wlt-currency-pop"
			trigger={(api) => (
				<Tooltip content="Display currency" placement="bottom">
					<button
						type="button"
						ref={api.ref as RefObject<HTMLButtonElement>}
						class="wlt-tool wlt-tool--currency"
						aria-haspopup="dialog"
						aria-expanded={api.expanded ? "true" : "false"}
						aria-controls={api.panelId}
						aria-label={`Display currency: ${active?.label ?? current}`}
						aria-busy={saving.value ? "true" : undefined}
						onClick={api.toggle}
					>
						{active ? <Flag code={active.country} size="sm" class="wlt-tool__flag" /> : null}
						<span class="wlt-tool__symbol" aria-hidden="true">{active?.symbol ?? current}</span>
						<span class="wlt-tool__code" aria-hidden="true">{current}</span>
						<Icon name="chevron-down" size="xs" class="wlt-tool__chevron" />
					</button>
				</Tooltip>
			)}
		>
			<div class="wlt-currency">
				<p class="wlt-currency__note">
					Figures are converted for display. Money is always held and moved in its own currency.
				</p>
				{failed.value && (
					<p class="wlt-currency__note wlt-currency__note--warn" role="status">
						Showing {current} on this device — it couldn’t be saved to your account.
					</p>
				)}
				<ul class="wlt-currency__list" role="radiogroup" aria-label="Display currency">
					{DISPLAY_CURRENCIES.map((option) => {
						const selected = option.code === current;
						return (
							<li key={option.code}>
								<button
									type="button"
									role="radio"
									aria-checked={selected ? "true" : "false"}
									aria-label={`${option.code}, ${option.label}, ${option.countryName}`}
									class="wlt-currency__item"
									disabled={saving.value !== null}
									onClick={() => void pick(option.code)}
								>
									<CurrencyLabel currency={option} />
									{selected && <Icon name="check" size="xs" class="wlt-currency__check" />}
								</button>
							</li>
						);
					})}
				</ul>
			</div>
		</Popover>
	);
}
// #endregion

/**
 * The hero's corner tools: the display-currency trigger and the verification & payouts gear, as glass
 * buttons in the hero's top inline-end corner. They sit on the aurora, so they take the hero's own
 * glass and ink rather than the page's.
 *
 * The gear opens Settings → Verification & payouts in the contextual modal (`openSettings`, Decision
 * #150) — the settings a wallet actually depends on. It stays a real link to the console page, so a
 * modified click (new tab) and a page that never hydrated still arrive there.
 */
export function HeroTools({ display }: { display: string }): JSX.Element {
	return (
		<div class="wlt-hero__tools" role="group" aria-label="Wallet settings">
			<CurrencyTrigger current={display} />
			<Tooltip content="Verification & payouts" placement="bottom">
				<a
					class="wlt-tool wlt-tool--icon"
					href="/settings/verification"
					aria-label="Verification and payouts settings"
					onClick={(event) => {
						if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
						event.preventDefault();
						openSettings("verification");
					}}
				>
					<Icon name="settings" size="sm" />
				</a>
			</Tooltip>
		</div>
	);
}
