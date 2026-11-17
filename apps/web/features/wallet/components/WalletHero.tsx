import type { JSX, RefObject } from "preact";
import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { MoneyView } from "@projective/ui/display/money";
import type {
	FundState,
	MoneyView as Money,
	WalletOverview,
	WalletSwitcher,
} from "../types/wallet-types.ts";
import {
	ALLOCATION_ORDER,
	fundStateHint,
	type HeroActions,
	type ResolvedAction,
} from "../core/wallet-home.ts";
import {
	type FlowPeriod,
	fundStateLabel,
	viewLabel,
	walletPageHref,
	walletParam,
	type WalletView,
} from "../core/wallet-model.ts";
import { deckParam, deckPosition, neighbourOf, scopeDeck, scopeHref } from "../core/scope-deck.ts";
import { useScopeSwipe } from "../hooks/useScopeSwipe.ts";
import { ActionIcon, FundStateIcon } from "./wallet-glyphs.tsx";
import { HeroTools } from "./WalletTools.tsx";
import { HeroAurora } from "./HeroAurora.tsx";
import { ScopeSwitcher } from "./ScopeSwitcher.tsx";

/** Props for {@link WalletHero}. */
export interface WalletHeroProps {
	/**
	 * The page the hero heads. The overview carries the balance and the actions; every other page a
	 * compact hero naming the page, so the chrome stays one surface as the reader moves between them.
	 */
	view: WalletView;
	overview: WalletOverview;
	switcher: WalletSwitcher;
	actions: HeroActions;
	/** The currency the page is drawn in (`?display=`), carried into account links. */
	display: string;
	/** The page's window (`?flow=`), carried when the reader moves to another wallet. */
	flow: FlowPeriod | null;
	onAction: (action: ResolvedAction) => void;
	heroRef?: RefObject<HTMLElement>;
}

interface Metric {
	state: FundState;
	value: Money;
	hint: string;
}

/**
 * The hero's fund-state figures, in the allocation meter's order so the two read the same way; Reserved
 * appears only while something is reserved.
 */
function metricsOf(o: WalletOverview): Metric[] {
	const values: Record<FundState, Money> = {
		available: o.available,
		pending: o.pending,
		locked: o.locked,
		on_hold: o.onHold,
	};
	return ALLOCATION_ORDER
		.filter((state) => state !== "on_hold" || o.onHold.minor > 0)
		.map((state) => ({ state, value: values[state], hint: fundStateHint(state, o) }));
}

function Conversion({ overview }: { overview: WalletOverview }): JSX.Element | null {
	const origin = overview.available.origin;
	const shown = overview.capital.currency.toUpperCase();
	const held = origin?.currency.toUpperCase();
	if (!origin || !held || held === shown) return null;
	const rate = origin.fxRate.toLocaleString("en-GB", { maximumFractionDigits: 4 });
	const detail = `Held in ${held}, shown in ${shown} at 1 ${held} = ${rate} ${shown}.`;
	return (
		<p class="wlt-hero__fx">
			<Tooltip content={detail}>
				<span class="wlt-hero__fx-term">Converted from {held}</span>
			</Tooltip>
			<span class="ui-visually-hidden">. {detail}</span>
		</p>
	);
}

function CurrencyTabs(
	{ overview, switcher, view }: {
		overview: WalletOverview;
		switcher: WalletSwitcher;
		view: WalletView;
	},
): JSX.Element | null {
	const rows = overview.currencies;
	const narrowed = rows.some((row) => row.selected);
	if (rows.length < 2 && !narrowed) return null;
	const param = walletParam(switcher.active.scope, switcher.active.id);
	return (
		<nav class="wlt-currencies" aria-label="Currency wallets">
			<a
				class="wlt-currencies__item"
				href={walletPageHref(view, param)}
				aria-current={narrowed ? undefined : "page"}
			>
				All currencies
			</a>
			{rows.map((row) => (
				<a
					key={row.currency}
					class="wlt-currencies__item"
					href={walletPageHref(view, param, null, null, row.currency)}
					aria-current={row.selected ? "page" : undefined}
				>
					<span class="wlt-currencies__code">{row.currency}</span>
					<MoneyView value={row.available} size="micro" exact class="wlt-currencies__amount" />
				</a>
			))}
		</nav>
	);
}

function MetricMark({ state }: { state: FundState }): JSX.Element {
	return state === "available"
		? <span class="wlt-metric__dot" aria-hidden="true" />
		: <FundStateIcon state={state} size="2xs" class="wlt-metric__glyph" />;
}

function ActionPill(
	{ item, onAction }: { item: ResolvedAction; onAction: (a: ResolvedAction) => void },
): JSX.Element {
	const button = (
		<button
			type="button"
			class="wlt-pill"
			data-locked={item.locked ? "true" : undefined}
			aria-label={item.locked ? `${item.label}, unavailable` : undefined}
			onClick={() => onAction(item)}
		>
			<span class="wlt-pill__icon" aria-hidden="true">
				<ActionIcon action={item.action} size="sm" />
				{item.locked && <Icon name="lock" class="wlt-pill__lock" />}
			</span>
			<span class="wlt-pill__label">{item.label}</span>
		</button>
	);
	return item.locked && item.reason ? <Tooltip content={item.reason}>{button}</Tooltip> : button;
}

function MorePill(
	{ items, onAction }: { items: ResolvedAction[]; onAction: (a: ResolvedAction) => void },
): JSX.Element {
	const open = useSignal(false);
	return (
		<Popover
			open={open}
			placement="bottom"
			class="wlt-glass-pop wlt-more-pop"
			trigger={(api) => (
				<button
					type="button"
					ref={api.ref as RefObject<HTMLButtonElement>}
					class="wlt-pill"
					aria-haspopup="menu"
					aria-expanded={api.expanded}
					aria-controls={api.panelId}
					onClick={api.toggle}
				>
					<span class="wlt-pill__icon" aria-hidden="true">
						<Icon name="kebab-horizontal" size="sm" />
					</span>
					<span class="wlt-pill__label">More</span>
				</button>
			)}
		>
			<div class="wlt-menu" role="menu" aria-label="More actions">
				{items.map((item) => (
					<button
						key={item.action}
						type="button"
						role="menuitem"
						class="ui-menu-item wlt-menu__item"
						data-locked={item.locked ? "true" : undefined}
						onClick={() => {
							open.value = false;
							onAction(item);
						}}
					>
						<ActionIcon action={item.action} size="sm" class="ui-menu-item__icon wlt-menu__icon" />
						<span class="wlt-menu__label">{item.label}</span>
						{item.locked && <Icon name="lock" size="xs" class="wlt-menu__lock" />}
					</button>
				))}
			</div>
		</Popover>
	);
}

/**
 * The luminous hero on every wallet page: the scope carousel over the balance it names, the
 * fund-state figures, and the capability-gated action pills — the one home of every money action
 * (the lane carries none). Off the overview the balance gives way to a compact title naming the page,
 * with the same carousel and the same actions.
 *
 * The carousel and the balance are one deck: dragging it sideways moves the balance with the pointer
 * and, past the commit point, navigates to the neighbouring wallet's address for the same page; the
 * chevrons, the arrow keys and the dropdown go to the same addresses. The gradient runs up behind the
 * glass top bar, the hero stays pinned while the dashboard sheet slides over it, and its top
 * inline-end corner holds the display-currency and settings tools.
 */
export function WalletHero(props: WalletHeroProps): JSX.Element {
	const { overview, switcher, actions, view } = props;
	const aggregate = overview.ref.scope === "aggregate";
	const accountCount = switcher.accounts.length;
	const compact = view !== "overview";
	const balanceLabel = aggregate
		? `Available across ${accountCount} ${accountCount === 1 ? "account" : "accounts"}`
		: "Total balance";
	const ownRef = useRef<HTMLElement>(null);
	const heroRef = props.heroRef ?? ownRef;
	const at = deckPosition(scopeDeck(switcher), deckParam(switcher.active));
	const swipe = useScopeSwipe({
		enabled: at.count > 1,
		onCommit: (step) => {
			const target = neighbourOf(at, step);
			if (target) location.assign(scopeHref(target, view, props.display, props.flow));
		},
	});
	const hasActions = actions.pills.length + actions.more.length > 0;
	return (
		<section
			class={compact ? "wlt-hero wlt-hero--compact" : "wlt-hero"}
			ref={heroRef}
			aria-labelledby="wlt-title"
		>
			<HeroAurora host={heroRef} />
			<HeroTools display={props.display} />
			<div class="wlt-hero__inner">
				<div
					ref={swipe.deckRef}
					class="wlt-hero__deck"
					data-phase={swipe.phase.value}
					data-swipe={at.count > 1 ? "true" : undefined}
					{...swipe.handlers}
				>
					<ScopeSwitcher
						switcher={switcher}
						view={view}
						display={props.display}
						flow={props.flow}
						onStep={swipe.leave}
					/>

					<div ref={swipe.slideRef} class="wlt-hero__slide">
						{compact
							? (
								<div class="wlt-hero__balance">
									<h1 id="wlt-title" class="wlt-hero__title">{viewLabel(view)}</h1>
									<p class="wlt-hero__meta">
										{balanceLabel} <MoneyView value={overview.capital} size="body" hideOrigin />
									</p>
								</div>
							)
							: (
								<div class="wlt-hero__balance">
									<h1 id="wlt-title" class="ui-visually-hidden">Wallet</h1>
									<p class="wlt-hero__label">{balanceLabel}</p>
									<p class="wlt-hero__figure">
										<MoneyView value={overview.capital} size="hero" />
									</p>
									{!aggregate && <Conversion overview={overview} />}
								</div>
							)}

						{!aggregate && <CurrencyTabs overview={overview} switcher={switcher} view={view} />}

						{!compact && !aggregate && (
							<dl class="wlt-metrics">
								{metricsOf(overview).map((m) => (
									<div class="wlt-metric" key={m.state}>
										<dt class="wlt-metric__label">
											<Tooltip content={m.hint}>
												<span class="wlt-metric__term">
													<MetricMark state={m.state} />
													{fundStateLabel(m.state)}
												</span>
											</Tooltip>
											<span class="ui-visually-hidden">: {m.hint}</span>
										</dt>
										<dd class="wlt-metric__value">
											<MoneyView value={m.value} size="body" hideOrigin />
										</dd>
									</div>
								))}
							</dl>
						)}
					</div>
				</div>

				{hasActions
					? (
						<div class="wlt-actions" role="group" aria-label="Wallet actions">
							{actions.pills.map((item) => (
								<ActionPill key={item.action} item={item} onAction={props.onAction} />
							))}
							{actions.more.length > 0 && (
								<MorePill items={actions.more} onAction={props.onAction} />
							)}
						</div>
					)
					: (
						<p class="wlt-hero__note">
							{aggregate
								? "A read-only total. Choose an account to move money."
								: "You can view this vault. Money actions belong to its owners and admins."}
						</p>
					)}
			</div>
		</section>
	);
}
