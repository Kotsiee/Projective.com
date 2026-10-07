import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { styleVars } from "@ui/core/style.ts";
import { DISPLAY_CURRENCIES } from "@projective/types/finance";
import { commitDisplayCurrency } from "@web/features/shell/core/currency-state.ts";
import { openSettings } from "@features/settings/core/settings-bridge.ts";
import { FLOW_PERIODS, type FlowPeriod, periodLabel, periodPhrase } from "../core/wallet-model.ts";

// #region Range ruler
/**
 * The cash-flow window as a segmented ruler: seven equal cells under one sliding thumb, pinned under
 * the top bar while the page scrolls beneath it. A radiogroup — the arrow keys move and select
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

// #region Currency
/**
 * The display-currency trigger. It writes the SAME store as the account menu's currency picker, so the
 * two can never disagree about what the page is drawn in; the page hears the change and re-reads its
 * figures converted server-side.
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
									class="wlt-currency__item"
									disabled={saving.value !== null}
									onClick={() => void pick(option.code)}
								>
									<span class="wlt-currency__symbol" aria-hidden="true">{option.symbol}</span>
									<span class="wlt-currency__code">{option.code}</span>
									<span class="wlt-currency__label">{option.label}</span>
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
