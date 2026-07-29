import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { cx } from "@ui/core/cx.ts";
import { styleVars } from "@ui/core/style.ts";
import { Tooltip } from "@projective/ui/feedback";
import "../styles/wallet.css";
import { Money } from "../components/Money.tsx";
import { FundStateMark } from "../components/FundStateMark.tsx";
import { GateGlyph } from "../core/glyphs.tsx";
import type { CapitalShare } from "../core/hero-model.ts";
import {
	capitalShares,
	fxNote,
	hasConvertedMoney,
	legendNote,
	pendingFraction,
} from "../core/hero-model.ts";
import {
	composeParts,
	countUp,
	groupLike,
	prefersReducedMotion,
	splitMinor,
} from "../core/money-format.ts";
import { fundFilter, heroAnimated } from "../core/wallet-state.ts";
import { currencyExponent } from "../types/wallet-types.ts";
import type { FundState, MoneyView, WalletOverview } from "../types/wallet-types.ts";

/**
 * CapitalMeter — the wallet's signature instrument: one shared rail divided into the four fund
 * states, and the legend that carries every fact the rail only suggests.
 *
 * **Why a shared rail.** A wallet on Projective holds other people's money against contracted work,
 * so the surface's job is custody, not encouragement. Putting all four states on ONE track makes the
 * emotional claim geometric rather than written: on-hold occupies its true share and therefore
 * *cannot* dominate, and capital in escrow sits shoulder-to-shoulder with spendable cash in the same
 * hue at a lower temperature and therefore *cannot* read as subtracted. No copywriting reproduces
 * that, and no other geometry enforces it.
 *
 * **RULE H-1 (load-bearing).** The track is an ambient proportion instrument ONLY. It is
 * `aria-hidden`, it never carries a fact alone, and this component must stay fully legible with the
 * track deleted — which is why the legend prints five redundant, static channels per state: shape
 * mark · text label · money figure · printed percentage · tone. That is what survives a colour-vision
 * overlay, high-contrast flattening and reduced motion all at once.
 *
 * **RULE H-2.** There is no minimum segment width anywhere. `flex-grow` is always the honest share.
 * **RULE H-3.** A sliver's pip is achromatic — it says "there is something here", never "be alarmed".
 * **RULE H-4.** A state at zero never places its chroma anywhere on the instrument.
 * **RULE D-1.** Every figure here is a string the server formatted; the only arithmetic is the
 * display ratio `minor / capital.minor` and the count-up interpolation, whose final frame writes the
 * server's own string back verbatim.
 *
 * The right third of the hero band is the card deck, a separate island; this component renders the
 * left column only.
 */
export interface CapitalMeterProps {
	overview: WalletOverview;
	/** The wallet param (`personal` · `team:atlas-collective`), threaded into the legend filter hrefs. */
	scope: string;
}

// #region Pure helpers

/**
 * The BEM modifier for a fund state. `on_hold` shortens to `hold` because §2.3's inventory names it
 * that way; the underscore survives only where a shipped component already emits it.
 */
function modifierFor(state: FundState): string {
	return state === "on_hold" ? "hold" : state;
}

/** The legend cell's destination: the ledger, pre-filtered to this state, on this wallet. */
function filterHref(scope: string, state: FundState): string {
	const qs = new URLSearchParams({ fundState: state, w: scope });
	return `/wallet/transactions?${qs.toString()}`;
}

/**
 * A stable, SSR-identical id for a note element. Derived from the wallet scope and the state rather
 * than a counter, so the server and the hydrated island agree on every `aria-describedby`.
 */
function noteId(scope: string, state: FundState, suffix: string): string {
	return `wlt-key-${scope.replace(/[^a-z0-9]+/gi, "-")}-${state}-${suffix}`;
}

/** The printed share, always to one decimal so the four values stay tabular down the row. */
function sharePct(share: number): string {
	return `${share.toFixed(1)}%`;
}

/**
 * The cell's full accessible name. It names the state, the money, the proportion and the ACTION,
 * because RULE G8 makes this the single named control for the state — the segment beside it is
 * `aria-hidden`, so nothing is announced twice.
 */
function keyLabel(s: CapitalShare, active: boolean): string {
	const action = active ? "clear the transaction filter" : "filter transactions";
	return `${s.label}, ${s.money.display}, ${sharePct(s.share)} of capital, ${action}`;
}

/**
 * Mirror the selected state into the URL so a filtered view is shareable and survives a reload.
 * `replaceState`, not `pushState`: toggling a legend cell is data selection, and filling the back
 * stack with filter states would make Back stop meaning "the page I came from".
 */
function syncFilterUrl(state: FundState | null): void {
	try {
		const url = new URL(globalThis.location.href);
		if (state) url.searchParams.set("fundState", state);
		else url.searchParams.delete("fundState");
		globalThis.history.replaceState(globalThis.history.state, "", `${url.pathname}${url.search}`);
	} catch {
		/* no History API — the anchor's href remains the fallback */
	}
}

/** Whether an arbitrary string is one of the four fund states, for reading `?fundState=` back. */
function isFundState(v: string | null): v is FundState {
	return v === "available" || v === "locked" || v === "pending" || v === "on_hold";
}

// #endregion

export default function CapitalMeter(props: CapitalMeterProps): JSX.Element {
	const { overview, scope } = props;
	const shares = capitalShares(overview);
	const converted = hasConvertedMoney(overview);
	const clearing = pendingFraction(overview);
	const verification = overview.verification;

	/** The meter has nothing to divide — an honest empty rail, not a collapsed one (§9). */
	const meterEmpty = overview.capital.minor === 0;
	/** A genuinely brand-new wallet: nothing held in any state, and nothing has ever moved. */
	const brandNew = meterEmpty && overview.recent.length === 0;

	/**
	 * The interpolated hero string during the count-up, or `null` to render the server's own
	 * `display`. This is the only string this island ever writes, and it is discarded on completion.
	 */
	const heroText = useSignal<string | null>(null);
	/** The same, per legend cell, in rail order. Always length 4. */
	const keyText = useSignal<(string | null)[]>([null, null, null, null]);
	/** Announced only on a currency or account change — never a persistent live balance. */
	const liveMessage = useSignal<string>("");

	// #region Count-up (RULE M-2 / M-3)
	/**
	 * SSR emitted the final strings, so the figure is correct on the first byte. After hydration the
	 * major units interpolate up once; the pence are held at their final value throughout rather than
	 * rolling, because money that appears to be spinning reads as money being counted rather than
	 * held — and snapping them in at the end would jump the width of a 4.5rem figure.
	 *
	 * The guard is a MODULE-level signal, so a refetch (range change, currency flip, dev-axis flip,
	 * account switch) paints the new strings instantly and nothing re-animates.
	 *
	 * **The animation never lowers a figure it cannot then raise.** It does not paint a starting zero
	 * — the first interpolated value is written by the first animation frame, so if `rAF` never runs
	 * (a backgrounded tab, a throttled renderer, a browser that defers the callback) the SSR string
	 * simply stays. A wallet reading £0.00 because the tab was in the background is not a cosmetic
	 * glitch; it is the surface lying about a balance. A watchdog snaps every figure to its final
	 * server string if the run has not completed in time, so a stalled animation can never strand one.
	 */
	useEffect(() => {
		if (heroAnimated.value) return;
		heroAnimated.value = true;
		if (prefersReducedMotion()) return;

		const cancels: Array<() => void> = [];
		const timers: number[] = [];

		const drive = (
			money: MoneyView,
			ms: number,
			delay: number,
			write: (text: string | null) => void,
		) => {
			if (money.minor === 0) return;
			const parts = splitMinor(money.display, money.currency);
			const exp = currencyExponent(money.currency);
			const frame = (majorUnits: number) =>
				write(composeParts(parts, groupLike(parts.major, majorUnits), parts.minor));

			const timer = setTimeout(() => {
				cancels.push(countUp(money.minor, exp, ms, frame, () => write(null)));
			}, delay) as unknown as number;
			timers.push(timer);

			// Watchdog: whatever happened to the frame loop, the server's own string wins in the end.
			const guard = setTimeout(() => write(null), delay + ms + 400) as unknown as number;
			timers.push(guard);
		};

		drive(overview.available, 900, 0, (text) => {
			heroText.value = text;
		});
		shares.forEach((share, i) => {
			drive(share.money, 600, i * 70, (text) => {
				const next = [...keyText.value];
				next[i] = text;
				keyText.value = next;
			});
		});

		return () => {
			for (const timer of timers) clearTimeout(timer);
			for (const cancel of cancels) cancel();
		};
	}, []);
	// #endregion

	// #region URL ⇄ selection
	/** Adopt a deep-linked `?fundState=` so a shared filtered view arrives already selected. */
	useEffect(() => {
		const param = new URLSearchParams(globalThis.location?.search ?? "").get("fundState");
		if (isFundState(param)) fundFilter.value = param;
	}, []);

	/**
	 * The one thing worth announcing: the figures now describe a different wallet, or the same wallet
	 * in a different currency. A persistent `aria-live` on the balance would re-read it on every one
	 * of the six dev-axis flips, which is why RULE G8 rejects that pattern outright.
	 */
	const identityKey = `${overview.ref.scope}:${overview.ref.id}:${overview.available.currency}`;
	const lastIdentity = useSignal<string | null>(null);
	useEffect(() => {
		if (lastIdentity.value !== null && lastIdentity.value !== identityKey) {
			liveMessage.value = `${overview.ref.name} available balance ${overview.available.display}`;
		}
		lastIdentity.value = identityKey;
	}, [identityKey]);
	// #endregion

	// #region Selection
	/**
	 * The legend cell is an anchor first: with no JavaScript it navigates to the pre-filtered ledger,
	 * and a modified click still opens that in a new tab. On the Overview the Recent band can filter
	 * in place, so the navigation is intercepted and the selection becomes a signal plus a URL sync.
	 */
	const onSelect = (state: FundState) => (event: JSX.TargetedMouseEvent<HTMLAnchorElement>) => {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
			return;
		}
		if ((globalThis.location?.pathname ?? "") !== "/wallet") return;
		event.preventDefault();
		const next = fundFilter.value === state ? null : state;
		fundFilter.value = next;
		syncFilterUrl(next);
	};
	// #endregion

	// #region The balance figure
	const heroValue: MoneyView = heroText.value
		? { ...overview.available, display: heroText.value }
		: overview.available;

	/*
	 * A `<span>`, not a `<div>`: when the earn path is gated this is wrapped by `Tooltip`, whose
	 * anchor is an inline element, and a block child inside it would be invalid phrasing content.
	 * `.wlt-hero__figure` restores `display: block`.
	 */
	const figure = (
		<span
			class={cx("wlt-hero__figure", meterEmpty && "wlt-hero__figure--zero")}
			data-muted={verification.canEarn ? undefined : "true"}
		>
			<Money
				value={heroValue}
				size="hero"
				srLabel={`Available balance ${overview.available.display}`}
			/>
		</span>
	);
	// #endregion

	return (
		<div class={cx("wlt-hero", brandNew && "wlt-hero--empty", converted && "wlt-hero--converted")}>
			<div class="wlt-hero__body">
				<div class="wlt-hero__identity">
					<p class="wlt-hero__eyebrow wlt-label">Available</p>
					{/* §9 — a viewer who cannot yet earn gets the reason from a portal Tooltip, never `title`. */}
					{verification.canEarn || !verification.prompt
						? figure
						: <Tooltip content={verification.prompt}>{figure}</Tooltip>}
				</div>

				<div class="wlt-hero__lifetime">
					<p class="wlt-label">Lifetime earned</p>
					<div class="wlt-hero__lifetime-value">
						<Money value={overview.lifetime} size="key" tone="muted" />
					</div>
				</div>
			</div>

			<span class="wlt-hero__sr" role="status" aria-live="polite">{liveMessage.value}</span>

			<div class={cx("wlt-hero__meter", meterEmpty && "wlt-hero__meter--empty")}>
				{/* RULE H-1 — decorative: the rail proposes, the legend states. Hidden from AT entirely. */}
				<div class="wlt-hero__track" aria-hidden="true">
					{shares.map((share) => (
						<div
							key={share.state}
							class={cx(
								"wlt-hero__segment",
								`wlt-hero__segment--${modifierFor(share.state)}`,
								share.isSliver && "wlt-hero__segment--sliver",
								share.isZero && "wlt-hero__segment--zero",
							)}
							/* The honest share, written at SSR so the meter is correct at first paint. */
							style={styleVars({ "--wlt-seg": share.share })}
							tabIndex={-1}
							aria-hidden="true"
						>
							{share.isSliver && (
								<span
									class="wlt-hero__pip"
									/* Collision lift resolved in JS: whether two pips overlap depends on
									   which segments are slivers in THIS wallet, which CSS cannot know. */
									style={styleVars({ "--wlt-pip-lift": `${share.pipLift}px` })}
								>
									<span class="wlt-hero__pip-dot" />
									{share.label}
									<span class="wlt-hero__pip-stem" />
								</span>
							)}
						</div>
					))}
				</div>

				<p class="wlt-hero__caption">
					Total capital
					<span class="wlt-hero__caption-value">
						<Money value={overview.capital} size="body" />
					</span>
				</p>
			</div>

			<div class={cx("wlt-hero__legend", converted && "wlt-hero__legend--split")}>
				{shares.map((share, i) => {
					const modifier = modifierFor(share.state);
					const active = fundFilter.value === share.state;
					const note = legendNote(share, overview);
					const fx = converted ? fxNote(share.money) : null;
					const noteRef = note ? noteId(scope, share.state, "note") : null;
					const fxRef = fx ? noteId(scope, share.state, "fx") : null;
					const described = [noteRef, fxRef].filter(Boolean).join(" ");

					const value = keyText.value[i]
						? { ...share.money, display: keyText.value[i] as string }
						: share.money;

					const body = (
						<>
							<span class="wlt-hero__key-rail" aria-hidden="true" />
							<span class="wlt-hero__key-mark">
								<FundStateMark
									state={share.state}
									zero={share.isZero}
									clearingFraction={clearing}
								/>
							</span>
							<span class="wlt-hero__key-label">{share.label}</span>
							<span class="wlt-hero__key-value">
								<Money
									value={value}
									size="key"
									tone={share.isZero ? "muted" : "default"}
									showFx={false}
								/>
							</span>
							{/* G2 — the printed share. Proportion as a NUMBER survives every overlay. */}
							<span class="wlt-hero__key-share wlt-num">{sharePct(share.share)}</span>
							{note && <p class="wlt-hero__key-note" id={noteRef ?? undefined}>{note}</p>}
							{fx && (
								<p
									class="wlt-hero__key-note wlt-num"
									id={fxRef ?? undefined}
									data-fx="true"
								>
									{fx}
								</p>
							)}
						</>
					);

					/*
					 * RULE H-4 — a zero cell is a `<div>`, not a link. There is nothing to filter to,
					 * and offering a dead control would be worse than offering none.
					 */
					if (share.isZero) {
						return (
							<div
								key={share.state}
								class={cx(
									"wlt-hero__key",
									`wlt-hero__key--${modifier}`,
									"wlt-hero__key--zero",
								)}
							>
								{body}
							</div>
						);
					}

					return (
						<a
							key={share.state}
							class={cx(
								"wlt-hero__key",
								`wlt-hero__key--${modifier}`,
								active && "wlt-hero__key--active",
							)}
							href={filterHref(scope, share.state)}
							aria-label={keyLabel(share, active)}
							aria-describedby={described || undefined}
							aria-current={active ? "true" : undefined}
							onClick={onSelect(share.state)}
						>
							{body}
						</a>
					);
				})}
			</div>

			{verification.prompt && (
				<div class="wlt-hero__gate">
					{GateGlyph}
					<p class="wlt-hero__gate-text">{verification.prompt}</p>
					{verification.href && (
						<a class="wlt-hero__gate-link" href={verification.href}>
							Continue
						</a>
					)}
				</div>
			)}

			{brandNew && (
				<p class="wlt-hero__empty-note">
					No funds yet. Add money from the action bar below.
				</p>
			)}
		</div>
	);
}
