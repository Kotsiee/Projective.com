import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { Avatar } from "@projective/ui/display";
import { MoneyView } from "@projective/ui/display/money";
import type {
	FundState,
	MoneyView as Money,
	WalletOverview,
	WalletRef,
	WalletSwitcher,
} from "../types/wallet-types.ts";
import { type HeroActions, type ResolvedAction } from "../core/wallet-home.ts";
import { fundStateLabel, heldIn, walletHref, walletParam } from "../core/wallet-model.ts";
import { ActionIcon, FundStateIcon } from "./wallet-glyphs.tsx";

/** Props for {@link WalletHero}. */
export interface WalletHeroProps {
	overview: WalletOverview;
	switcher: WalletSwitcher;
	actions: HeroActions;
	/** The currency the page is drawn in (`?display=`), carried into account links. */
	display: string;
	onAction: (action: ResolvedAction) => void;
	heroRef?: RefObject<HTMLElement>;
}

const ROLE_LABEL: Readonly<Record<string, string>> = {
	owner: "Owner",
	admin: "Admin",
	pm: "Manager",
	member: "Member",
};

const VAULT_NOUN: Readonly<Record<string, string>> = {
	team: "Team vault",
	business: "Business vault",
	organisation: "Organisation vault",
};

/** Whether the read-only "All accounts" rollup is worth offering: with one account it only repeats it. */
export function showsAggregate(switcher: WalletSwitcher): boolean {
	return switcher.accounts.length > 1 || switcher.active.scope === "aggregate";
}

/** Who an account belongs to, as the scope pill and rail describe it. */
export function accountKind(ref: WalletRef): string {
	if (ref.scope === "aggregate") return "All accounts";
	if (ref.scope === "personal") return "Your wallet";
	const noun = VAULT_NOUN[ref.scope] ?? "Vault";
	return ref.role ? `${ROLE_LABEL[ref.role]} · ${noun}` : noun;
}

function heldCurrency(ref: WalletRef): string {
	return heldIn(ref.available).currency;
}

function ScopePill(
	{ switcher, display }: { switcher: WalletSwitcher; display: string },
): JSX.Element {
	const open = useSignal(false);
	const active = switcher.active;
	const accounts = showsAggregate(switcher) ? [...switcher.accounts, switcher.aggregate] : switcher.accounts;
	const name = active.scope === "personal" ? "Personal" : active.name;
	return (
		<Popover
			open={open}
			placement="bottom"
			label="Choose a wallet"
			class="wlt-scope-pop"
			trigger={(api) => (
				<button
					type="button"
					ref={api.ref as RefObject<HTMLButtonElement>}
					class="wlt-scope"
					aria-haspopup="dialog"
					aria-expanded={api.expanded}
					aria-controls={api.panelId}
					onClick={api.toggle}
				>
					{active.scope === "aggregate"
						? <Icon name="wallet" size="xs" class="wlt-scope__glyph" />
						: (
							<Avatar
								image={active.avatar ?? undefined}
								label={active.name}
								size={20}
								class="wlt-scope__avatar"
							/>
						)}
					<span class="wlt-scope__name">{name}</span>
					<span class="wlt-scope__sep" aria-hidden="true">·</span>
					<span class="wlt-scope__currency">
						{active.scope === "aggregate" ? display : heldCurrency(active)}
					</span>
					<Icon name="chevron-down" size="xs" class="wlt-scope__chevron" />
				</button>
			)}
		>
			<ul class="wlt-scope-menu">
				{accounts.map((ref) => {
					const param = walletParam(ref.scope, ref.id);
					const current = param === walletParam(active.scope, active.id);
					return (
						<li key={param}>
							<a
								class="wlt-scope-menu__item"
								href={walletHref(param, display)}
								aria-current={current ? "page" : undefined}
							>
								{ref.scope === "aggregate"
									? (
										<span class="wlt-scope-menu__all">
											<Icon name="wallet" size="xs" />
										</span>
									)
									: <Avatar image={ref.avatar ?? undefined} label={ref.name} size={28} />}
								<span class="wlt-scope-menu__text">
									<span class="wlt-scope-menu__name">
										{ref.scope === "personal" ? "Personal" : ref.name}
									</span>
									<span class="wlt-scope-menu__meta">{accountKind(ref)}</span>
								</span>
								<MoneyView
									value={ref.available}
									size="micro"
									hideOrigin
									class="wlt-scope-menu__amount"
								/>
								{current && <Icon name="check" size="xs" class="wlt-scope-menu__check" />}
							</a>
						</li>
					);
				})}
			</ul>
		</Popover>
	);
}

interface Metric {
	state: FundState;
	value: Money;
	hint: string;
}

function metricsOf(o: WalletOverview): Metric[] {
	const stages = o.lockedStageCount;
	const metrics: Metric[] = [
		{ state: "available", value: o.available, hint: "Spendable now" },
		{
			state: "locked",
			value: o.locked,
			hint: stages > 0
				? `Held on ${stages} active ${stages === 1 ? "stage" : "stages"} until the work is approved`
				: "Held in escrow until work is approved",
		},
		{ state: "pending", value: o.pending, hint: "Released, finishing the 7-day safety window" },
	];
	if (o.onHold.minor > 0) {
		const cases = o.heldCaseCount;
		metrics.push({
			state: "on_hold",
			value: o.onHold,
			hint: `Frozen while ${cases} ${cases === 1 ? "case is" : "cases are"} reviewed`,
		});
	}
	return metrics;
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
			class="wlt-more-pop"
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
						class="wlt-menu__item"
						data-locked={item.locked ? "true" : undefined}
						onClick={() => {
							open.value = false;
							onAction(item);
						}}
					>
						<ActionIcon action={item.action} size="sm" class="wlt-menu__icon" />
						<span class="wlt-menu__label">{item.label}</span>
						{item.locked && <Icon name="lock" size="xs" class="wlt-menu__lock" />}
					</button>
				))}
			</div>
		</Popover>
	);
}

/**
 * The luminous hero: the scope pill, the total balance with its fund-state breakdown, and the
 * capability-gated action pills. Stays pinned while the dashboard sheet slides over it.
 */
export function WalletHero(props: WalletHeroProps): JSX.Element {
	const { overview, switcher, actions } = props;
	const aggregate = overview.ref.scope === "aggregate";
	const accountCount = switcher.accounts.length;
	return (
		<section class="wlt-hero" ref={props.heroRef} aria-labelledby="wlt-title">
			<div class="wlt-hero__atmos" aria-hidden="true">
				<span class="wlt-hero__glow wlt-hero__glow--teal" />
				<span class="wlt-hero__glow wlt-hero__glow--indigo" />
			</div>
			<div class="wlt-hero__inner">
				<h1 id="wlt-title" class="ui-visually-hidden">Wallet</h1>
				<ScopePill switcher={switcher} display={props.display} />

				<div class="wlt-hero__balance">
					<p class="wlt-hero__label">
						{aggregate
							? `Available across ${accountCount} ${accountCount === 1 ? "account" : "accounts"}`
							: "Total balance"}
					</p>
					<p class="wlt-hero__figure">
						<MoneyView value={overview.capital} size="hero" />
					</p>
					{!aggregate && <Conversion overview={overview} />}
				</div>

				{!aggregate && (
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

				{actions.pills.length + actions.more.length > 0
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
								: "You can view this vault."}
						</p>
					)}
			</div>
		</section>
	);
}
