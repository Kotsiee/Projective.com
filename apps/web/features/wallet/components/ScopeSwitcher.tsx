import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { Avatar } from "@projective/ui/display";
import { MoneyView } from "@projective/ui/display/money";
import { personFallbackImage } from "@web/components/UserAvatar.tsx";
import type { WalletRef, WalletSwitcher } from "../types/wallet-types.ts";
import { type FlowPeriod, heldIn, walletScopeNoun, type WalletView } from "../core/wallet-model.ts";
import {
	deckParam,
	deckPosition,
	neighbourOf,
	type ScopeStep,
	scopeDeck,
	scopeHref,
	stepForKey,
} from "../core/scope-deck.ts";

/** Props for {@link ScopeSwitcher}. */
export interface ScopeSwitcherProps {
	switcher: WalletSwitcher;
	/** The page on screen; every step keeps the reader on it. */
	view: WalletView;
	/** The currency the page is drawn in (`?display=`), carried to every wallet. */
	display: string;
	/** The page's window (`?flow=`), carried where the page reads one. */
	flow: FlowPeriod | null;
	/** Plays the hero's leave motion for a step the reader took here. */
	onStep: (step: ScopeStep) => void;
}

/** The most dots the carousel draws; past it, the position is a count instead. */
const MAX_DOTS = 7;

const ROLE_LABEL: Readonly<Record<string, string>> = {
	owner: "Owner",
	admin: "Admin",
	pm: "Manager",
	member: "Member",
};

/** Who an account belongs to, as the scope menu describes it. */
export function accountKind(ref: WalletRef): string {
	if (ref.scope === "aggregate") return "Read-only total";
	if (ref.scope === "personal") return "Your wallet";
	const noun = walletScopeNoun(ref.scope);
	return ref.role ? `${ROLE_LABEL[ref.role]} · ${noun}` : noun;
}

/** A wallet's name as the switcher prints it. */
export function scopeName(ref: WalletRef): string {
	return ref.scope === "personal" ? "Personal" : ref.name;
}

function plainClick(e: MouseEvent): boolean {
	return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

function ScopeMark({ wallet, size }: { wallet: WalletRef; size: number }): JSX.Element {
	if (wallet.scope === "aggregate") {
		return (
			<span class="wlt-scope__all" aria-hidden="true">
				<Icon name="wallet" size="xs" />
			</span>
		);
	}
	return (
		<Avatar
			image={wallet.avatar ?? undefined}
			fallbackImage={personFallbackImage(wallet.scope)}
			label={wallet.name}
			size={size}
			class="wlt-scope__avatar"
		/>
	);
}

function StepLink(
	{ step, target, href, onStep }: {
		step: ScopeStep;
		target: WalletRef;
		href: string;
		onStep: (step: ScopeStep) => void;
	},
): JSX.Element {
	const label = step === "prev" ? "Previous wallet" : "Next wallet";
	return (
		<Tooltip content={`${label}: ${scopeName(target)}`} placement="bottom">
			<a
				class="wlt-tool wlt-tool--icon wlt-scope-switcher__step"
				href={href}
				aria-label={label}
				data-step={step}
				onClick={(e) => {
					if (plainClick(e)) onStep(step);
				}}
			>
				<Icon
					name={step === "prev" ? "chevron-left" : "chevron-right"}
					size="sm"
					class="wlt-mirror"
				/>
			</a>
		</Tooltip>
	);
}

/**
 * The hero's scope carousel: `‹ · [avatar · name · currency ▾] · ›` over a row of position dots. The
 * chevrons are real `?w=` links to the neighbouring wallets (the deck wraps), the pill opens the
 * dropdown of every wallet in the same order, and ←/→ step it while focus is anywhere in the group
 * (mirrored under a right-to-left writing direction). Every way of switching is a navigation to an
 * address — the page and the lane are read again for the new wallet, and the acting context is never
 * touched. With one wallet only the pill is drawn.
 */
export function ScopeSwitcher(props: ScopeSwitcherProps): JSX.Element {
	const { switcher, display } = props;
	const open = useSignal(false);
	const active = switcher.active;
	const deck = scopeDeck(switcher);
	const at = deckPosition(deck, deckParam(active));
	const stepping = at.prev !== null && at.next !== null;
	const hrefOf = (ref: WalletRef) => scopeHref(ref, props.view, display, props.flow);

	const onKeyDown = (e: KeyboardEvent) => {
		if (!stepping || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
		const rtl = getComputedStyle(e.currentTarget as Element).direction === "rtl";
		const step = stepForKey(e.key, rtl);
		const target = step ? neighbourOf(at, step) : null;
		if (!step || !target) return;
		e.preventDefault();
		props.onStep(step);
		location.assign(hrefOf(target));
	};

	return (
		<div class="wlt-scope-switcher">
			<div
				class="wlt-scope-switcher__row"
				role="group"
				aria-label="Wallets"
				onKeyDown={onKeyDown}
			>
				{stepping && at.prev && (
					<StepLink step="prev" target={at.prev} href={hrefOf(at.prev)} onStep={props.onStep} />
				)}
				<Popover
					open={open}
					placement="bottom"
					label="Choose a wallet"
					class="wlt-glass-pop wlt-scope-pop"
					trigger={(api) => (
						<button
							type="button"
							ref={api.ref as RefObject<HTMLButtonElement>}
							class="wlt-scope"
							aria-haspopup="dialog"
							aria-expanded={api.expanded}
							aria-controls={api.panelId}
							aria-keyshortcuts={stepping ? "ArrowLeft ArrowRight" : undefined}
							onClick={api.toggle}
						>
							<ScopeMark wallet={active} size={20} />
							<span class="wlt-scope__name">{scopeName(active)}</span>
							<span class="wlt-scope__sep" aria-hidden="true">·</span>
							<span class="wlt-scope__currency">
								{active.scope === "aggregate" ? display : heldIn(active.available).currency}
							</span>
							{stepping && (
								<span class="ui-visually-hidden">, wallet {at.index + 1} of {at.count}</span>
							)}
							<Icon name="chevron-down" size="xs" class="wlt-scope__chevron" />
						</button>
					)}
				>
					<ul class="wlt-scope-menu">
						{deck.map((ref) => {
							const param = deckParam(ref);
							const current = param === deckParam(active);
							return (
								<li key={param}>
									<a
										class="ui-menu-item wlt-scope-menu__item"
										href={hrefOf(ref)}
										aria-current={current ? "page" : undefined}
									>
										{ref.scope === "aggregate"
											? (
												<span class="wlt-scope-menu__all">
													<Icon name="wallet" size="xs" />
												</span>
											)
											: (
												<Avatar
													image={ref.avatar ?? undefined}
													fallbackImage={personFallbackImage(ref.scope)}
													label={ref.name}
													size={28}
												/>
											)}
										<span class="wlt-scope-menu__text">
											<span class="wlt-scope-menu__name">{scopeName(ref)}</span>
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
				{stepping && at.next && (
					<StepLink step="next" target={at.next} href={hrefOf(at.next)} onStep={props.onStep} />
				)}
			</div>
			{stepping && (at.count <= MAX_DOTS
				? (
					<span class="wlt-scope-dots" aria-hidden="true">
						{deck.map((ref, i) => (
							<span
								key={deckParam(ref)}
								class="wlt-scope-dots__dot"
								data-on={i === at.index ? "true" : undefined}
							/>
						))}
					</span>
				)
				: (
					<span class="wlt-scope-dots wlt-scope-dots--count" aria-hidden="true">
						{at.index + 1} / {at.count}
					</span>
				))}
		</div>
	);
}
