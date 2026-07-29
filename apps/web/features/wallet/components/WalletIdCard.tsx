import type { JSX } from "preact";
import "../styles/wallet-idcard.css";
import { cx } from "@ui/core/cx.ts";
import { Avatar } from "@projective/ui/display";
import { Money } from "./Money.tsx";
import type { WalletRef } from "../types/wallet-types.ts";

/**
 * WalletIdCard — the ACCOUNT itself (`wlt-idcard`), and the visual language of the account switcher.
 *
 * Where {@link PaymentCard} is a spendable instrument and may look like one, this is the opposite
 * object: restrained, near-monochrome, high-contrast — a private bank's account card, never a
 * neobank card. It is the same object at three densities — the lane switcher (`md`), a drawer's
 * read-only "From" block (`lg`), and a 48px square inside the 64px collapsed rail (`rail`) — so a
 * viewer who learns it once recognises it everywhere.
 *
 * **It has no border at all** (§12.4): separation is a tonal surface step plus a single 3px
 * `border-inline-start` rail, rendered as `__rail` so the rail can carry the scope tone without the
 * root ever growing a contour.
 *
 * **Scope is never encoded by colour alone.** The four scopes differ first by the silhouette of the
 * aperture mark — one ring, a triad, a divided block, a 2×2 rollup — so they stay distinguishable
 * under every `data-cvd` overlay and at `data-contrast="high"`, where the tonal rails converge.
 *
 * The aggregate rollup is deliberately *recessed* rather than raised, `cursor: default`, and never
 * takes an `--active` tint: it is a read-only view over other wallets, and an account you cannot act
 * on must not look like one you can (§9).
 */

// #region Props
/** Props for {@link WalletIdCard}. */
export interface WalletIdCardProps {
	/**
	 * The wallet this card identifies.
	 *
	 * Named `account`, not `ref`: Preact reserves `ref` on every element and extracts it into the
	 * vnode before props are assembled, so a `ref` prop on a function component silently arrives
	 * `undefined` — a failure mode that would blank a balance card at runtime instead of at
	 * type-check time.
	 */
	account: WalletRef;
	/** Density. `rail` is the aperture alone — 48px inside the 64px collapsed lane. */
	size?: "lg" | "md" | "rail";
	/** The wallet currently being viewed. Never applied to the aggregate. */
	active?: boolean;
	/** Suppresses the active tint and states the card cannot be acted on. */
	readonly?: boolean;
	class?: string;
}
// #endregion

// #region Vocabulary
/** The human name for a wallet scope. `organisation` reads as its own vault, not as a business. */
function scopeLabel(scope: WalletRef["scope"]): string {
	switch (scope) {
		case "personal":
			return "Personal wallet";
		case "team":
			return "Team vault";
		case "business":
			return "Business vault";
		case "organisation":
			return "Organisation vault";
		case "aggregate":
			return "All accounts";
	}
}

/** The viewer's coarse role on this wallet, in the surface's label register. */
function roleLabel(role: WalletRef["role"]): string | null {
	switch (role) {
		case "owner":
			return "Owner";
		case "admin":
			return "Admin";
		case "pm":
			return "PM";
		case "member":
			return "Member";
		default:
			return null;
	}
}

/**
 * The face modifier for a scope. The BEM inventory names four faces, so an `organisation` vault
 * shares the `business` face — both are entity-owned vaults governed by permissions rather than by
 * an individual, and inventing a fifth modifier would be a spec change made silently.
 */
function scopeModifier(scope: WalletRef["scope"]): string {
	return scope === "organisation" ? "business" : scope;
}

/**
 * The aperture mark — the scope's silhouette, used whenever the wallet has no avatar. Each shape is
 * structurally different (not merely differently coloured) so the scopes stay separable for a
 * colour-blind viewer and in a high-contrast theme where the tonal rails converge.
 *
 * Built by a function, not held as a module VNode constant, so a switcher listing several wallets
 * mounts a fresh instance per card.
 */
function apertureMark(scope: WalletRef["scope"]): JSX.Element {
	const shell = (path: JSX.Element) => (
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.6"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			{path}
		</svg>
	);

	switch (scope) {
		// One person: a single closed ring around a centre.
		case "personal":
			return shell(
				<>
					<circle cx="12" cy="12" r="8.2" />
					<circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
				</>,
			);
		// A team: three peers, no centre.
		case "team":
			return shell(
				<>
					<circle cx="12" cy="5.8" r="2.9" />
					<circle cx="5.8" cy="17" r="2.9" />
					<circle cx="18.2" cy="17" r="2.9" />
				</>,
			);
		// A rollup: four separate accounts read as one.
		case "aggregate":
			return shell(
				<>
					<rect x="3.6" y="3.6" width="7" height="7" rx="1.3" />
					<rect x="13.4" y="3.6" width="7" height="7" rx="1.3" />
					<rect x="3.6" y="13.4" width="7" height="7" rx="1.3" />
					<rect x="13.4" y="13.4" width="7" height="7" rx="1.3" />
				</>,
			);
		// An entity vault: one divided block.
		default:
			return shell(
				<>
					<rect x="3.8" y="4.4" width="16.4" height="15.2" rx="2.2" />
					<path d="M3.8 10.2h16.4" />
					<path d="M9.6 15h4.8" />
				</>,
			);
	}
}
// #endregion

/**
 * Render one wallet as an account card. See the module doc for the separation, colour-independence
 * and read-only contracts that govern it.
 */
export function WalletIdCard(props: WalletIdCardProps): JSX.Element {
	const { account, size = "md", active = false } = props;

	// The aggregate is structurally read-only: it is a view over wallets, not a wallet.
	const isAggregate = account.scope === "aggregate";
	const isReadonly = props.readonly === true || isAggregate;
	// An account that cannot be acted on must never wear the active tint, even while being viewed.
	const isActive = active && !isAggregate;
	const scope = scopeLabel(account.scope);
	const role = roleLabel(account.role);

	return (
		<div
			class={cx(
				"wlt-idcard",
				`wlt-idcard--${scopeModifier(account.scope)}`,
				`wlt-idcard--size-${size}`,
				isActive && "wlt-idcard--active",
				isReadonly && "wlt-idcard--readonly",
				props.class,
			)}
			data-readonly={isReadonly ? "true" : undefined}
			aria-readonly={isReadonly ? "true" : undefined}
		>
			<span class="wlt-idcard__rail" aria-hidden="true" />

			<span class="wlt-idcard__aperture">
				{account.avatar
					? (
						<Avatar
							image={account.avatar}
							alt=""
							label={account.name}
							size={size === "rail" ? 28 : 36}
						/>
					)
					: <span class="wlt-idcard__aperture-mark">{apertureMark(account.scope)}</span>}
			</span>

			{
				/*
				 * The rail density is the aperture alone (§5.1), so the wallet's name would otherwise be
				 * unreachable: it survives as the card's only accessible content while the mark carries
				 * the visual identity.
				 */
			}
			{size === "rail"
				? <span class="ui-visually-hidden">{`${account.name}, ${scope}`}</span>
				: (
					<span class="wlt-idcard__body">
						<span class="wlt-idcard__eyebrow">
							<span class="wlt-idcard__scope">{scope}</span>
							{role && <span class="wlt-idcard__role">{role}</span>}
						</span>

						<span class="wlt-idcard__name">{account.name}</span>
						{account.handle && <span class="wlt-idcard__handle">@{account.handle}</span>}

						<span class="wlt-idcard__balance">
							<span class="wlt-idcard__balance-label wlt-label">Available</span>
							<span class="wlt-idcard__balance-value">
								<Money
									value={account.available}
									size={size === "lg" ? "figure" : "key"}
									srLabel={`Available balance on ${account.name}, ${account.available.display}`}
								/>
							</span>
						</span>

						{
							/*
							 * A stated fact, not a padlock: the one lock glyph on this surface marks a
							 * verification step, and money the viewer can see but not move is a scope
							 * fact rather than a warning (RULE C-1).
							 */
						}
						{isReadonly && <span class="wlt-idcard__lock">Read-only</span>}
					</span>
				)}
		</div>
	);
}
