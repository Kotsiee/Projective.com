import { type JSX, type RefObject, type VNode } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { Avatar } from "@projective/ui/display";
// The action lane reuses the profile lane's `pf-lane*` skeleton (header + collapse machinery + the
// `.ui-splitter[data-mode]` / `:root[data-guest-nav]` density reveals), so profile.css must ride this
// island's client bundle. `view.css` layers the pricing/CTA/trust content styling on top.
import "@features/profile/styles/profile.css";
import "../styles/view.css";
import { ProfileIcon } from "@features/profile/components/profile-glyphs.tsx";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import { type ViewGlyph, ViewIcon } from "../components/view-glyphs.tsx";
import { messageHrefFor, signInHref } from "../core/view-model.ts";
import { basketIds, hydrateBasket, inBasket, toggleBasket } from "../core/basket-state.ts";
import type { EntityPricing, ExploreItem, TrustFact } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";

/**
 * ViewActionLane — the Entity View page's contextual navigation-sidebar action panel (Part 2). It
 * REUSES the profile page's `pf-lane` skeleton verbatim (the same `pf-lane__header`, collapse toggle,
 * and both the expanded-stack ⁄ collapsed-icon-rail density presentations revealed by
 * `.ui-splitter[data-mode="collapsed"]` in the authed lane and `:root[data-guest-nav]` in the guest
 * aside) — so it drops into `ui-guest-aside` (guests) and `ui-middle-nav__lane` (users) with identical
 * chrome. On top of that skeleton it hosts the transactional block: the resolved price, the stacked
 * Buy · Add-to-basket · Message CTAs (basket state synced + persisted cross-island), and the
 * operational trust chips. Dumb island — optimistic stubs until `/api/basket` + checkout land.
 */

// #region Collapsed rail model
interface RailAction {
	key: string;
	label: string;
	icon: VNode;
	href?: string;
	onClick?: () => void;
	on?: boolean;
	primary?: boolean;
}

function cls(...parts: Array<string | false | undefined>): string {
	return parts.filter(Boolean).join(" ");
}

/** The global site sidebar the header's `bottom-end` kebab menu must never slide under. */
const SHELL_AVOID = [".ui-app-shell__sidebar"] as const;
// #endregion

export interface ViewActionLaneProps {
	item: ExploreItem;
	pricing: EntityPricing;
	trust: TrustFact[];
	/** Whether the viewer is signed in — gates the message/purchase CTAs to a sign-in bounce. */
	authed: boolean;
	/** The render context (public Explore vs a profile namespace) — drives the sign-in return path. */
	ctx: HrefContext;
}

export default function ViewActionLane(
	{ item, pricing, trust, authed, ctx }: ViewActionLaneProps,
): JSX.Element {
	const favorited = useSignal(false);
	const menuOpen = useSignal(false);
	const status = useSignal("");
	// Track basket membership reactively (the signal is shared cross-island + persisted).
	const added = basketIds.value.includes(item.id);

	useEffect(() => {
		hydrateBasket();
	}, []);

	function setLaneCollapsed(next: boolean): void {
		try {
			globalThis.dispatchEvent(
				new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
			);
		} catch { /* SSR / no window — non-fatal */ }
	}

	function announce(msg: string): void {
		status.value = msg;
	}

	function share(): void {
		try {
			const url = globalThis.location?.href ?? "";
			const nav = globalThis.navigator as Navigator & {
				share?: (d: { title: string; url: string }) => Promise<void>;
			};
			if (nav?.share) nav.share({ title: item.title, url }).catch(() => {});
			else {
				nav?.clipboard?.writeText(url).catch(() => {});
				announce("Link copied");
			}
		} catch { /* non-fatal */ }
	}

	function copyLink(): void {
		try {
			globalThis.navigator?.clipboard?.writeText(globalThis.location?.href ?? "").catch(() => {});
			announce("Link copied");
		} catch { /* clipboard unavailable — non-fatal */ }
	}

	// #region Derived
	const purchasable = item.type === "services" || item.type === "products";
	const msgHref = authed ? messageHrefFor(item) : signInHref(item, ctx);
	const msgLabel = item.owner.kind === "team" || item.owner.kind === "business"
		? "Message team"
		: "Message";

	function onBuy(): void {
		if (!authed) {
			globalThis.location.href = signInHref(item, ctx);
			return;
		}
		if (!inBasket(item.id)) toggleBasket(item.id);
		// Checkout is a Phase-2 route; for now confirm the basket + intent.
		announce("Added to basket — checkout coming soon");
	}
	function onToggleBasket(): void {
		const now = toggleBasket(item.id);
		announce(now ? "Added to basket" : "Removed from basket");
	}
	// #endregion

	// #region Collapsed rail actions
	const railActions: RailAction[] = [
		{
			key: "share",
			label: "Share",
			icon: <ProfileIcon name="share" />,
			onClick: share,
		},
		{
			key: "favourite",
			label: favorited.value ? "Saved" : "Save",
			icon: <ProfileIcon name="star" />,
			onClick: () => (favorited.value = !favorited.value),
			on: favorited.value,
		},
		...(purchasable
			? [
				{
					key: "buy",
					label: "Buy now",
					icon: <ViewIcon name="buy" />,
					onClick: onBuy,
					primary: true,
				},
				{
					key: "basket",
					label: added ? "In basket" : "Add to basket",
					icon: <ViewIcon name={added ? "check" : "basket"} />,
					onClick: onToggleBasket,
					on: added,
				},
			]
			: []),
		{
			key: "message",
			label: msgLabel,
			icon: <ViewIcon name="message" />,
			href: msgHref,
			primary: !purchasable,
		},
	];
	// #endregion

	// #region Renderers
	function railBtn(item: RailAction): VNode {
		const className = cls("pf-railbtn", item.primary && "pf-railbtn--primary");
		return (
			<Tooltip key={item.key} content={item.label} placement="right">
				{item.href
					? (
						<a
							class={className}
							href={item.href}
							aria-label={item.label}
							data-on={item.on ? "true" : undefined}
						>
							{item.icon}
						</a>
					)
					: (
						<button
							type="button"
							class={className}
							onClick={item.onClick}
							aria-label={item.label}
							data-on={item.on ? "true" : undefined}
						>
							{item.icon}
						</button>
					)}
			</Tooltip>
		);
	}
	// #endregion

	return (
		<div class="pf-lane vw-lane">
			{/* Collapsed icon rail — CSS reveals it only at the narrow rail density. */}
			<nav class="pf-lane__rail" aria-label={`Actions for ${item.title}`}>
				<div class="pf-lane__rail-group">
					{railActions.map(railBtn)}
				</div>
				<div class="pf-lane__rail-group pf-lane__rail-group--bottom">
					<Tooltip content="Expand lane" placement="right">
						<button
							type="button"
							class="pf-railbtn pf-railbtn--toggle"
							data-collapsed="true"
							aria-label="Expand lane"
							aria-pressed={true}
							onClick={() => setLaneCollapsed(false)}
						>
							<SidebarToggleIcon />
						</button>
					</Tooltip>
				</div>
			</nav>

			{/* Expanded stack. */}
			<div class="pf-lane__full">
				<div class="pf-lane__header vw-lane__header">
					<a
						class="vw-lane__creator"
						href={`/${item.owner.handle}`}
						aria-label={`${item.owner.name} — view profile`}
					>
						<Avatar
							image={item.owner.avatar}
							alt=""
							size="sm"
							shape={item.owner.kind === "business" ? "square" : "circle"}
						/>
						<span class="vw-lane__creator-name">{item.owner.name}</span>
					</a>
					<div class="pf-lane__header-actions">
						<Tooltip content="Share" placement="bottom">
							<button type="button" class="pf-lane__headbtn" aria-label="Share" onClick={share}>
								<ProfileIcon name="share" />
							</button>
						</Tooltip>
						<Tooltip
							content={favorited.value ? "Remove favourite" : "Favourite"}
							placement="bottom"
						>
							<button
								type="button"
								class="pf-lane__headbtn"
								data-on={favorited.value ? "true" : undefined}
								aria-pressed={favorited.value}
								aria-label={favorited.value ? "Remove from favourites" : "Add to favourites"}
								onClick={() => (favorited.value = !favorited.value)}
							>
								<ProfileIcon name="star" />
							</button>
						</Tooltip>
						<Popover
							open={menuOpen}
							placement="bottom-end"
							avoid={SHELL_AVOID}
							allowOverflow={["bottom"]}
							trigger={(api) => (
								<button
									type="button"
									ref={api.ref as RefObject<HTMLButtonElement>}
									class="pf-lane__headbtn"
									data-open={api.expanded ? "true" : undefined}
									aria-label="More actions"
									aria-haspopup="menu"
									aria-expanded={api.expanded}
									aria-controls={api.panelId}
									onClick={api.toggle}
								>
									<ProfileIcon name="kebab" />
								</button>
							)}
						>
							<div class="pf-lane__menu" role="menu" aria-label={`Actions for ${item.title}`}>
								<button
									type="button"
									role="menuitem"
									class="pf-lane__menu-item"
									onClick={() => {
										menuOpen.value = false;
										copyLink();
									}}
								>
									<ProfileIcon name="link" />
									<span>Copy link</span>
								</button>
								<button
									type="button"
									role="menuitem"
									class="pf-lane__menu-item"
									data-danger="true"
									onClick={() => (menuOpen.value = false)}
								>
									<ProfileIcon name="flag" />
									<span>Report listing</span>
								</button>
							</div>
						</Popover>
					</div>
				</div>

				<div class="pf-lane__scroll vw-lane__scroll">
					{/* Pricing block. */}
					<div class="vw-price" data-mode={pricing.mode}>
						<span class="vw-price__value">{pricing.display}</span>
						{pricing.caption ? <span class="vw-price__caption">{pricing.caption}</span> : null}
					</div>

					{/* Primary action CTAs, stacked. */}
					<div class="vw-ctas">
						{purchasable
							? (
								<>
									<button type="button" class="vw-cta vw-cta--primary" onClick={onBuy}>
										<ViewIcon name="buy" size={18} />
										<span>Buy now</span>
									</button>
									<button
										type="button"
										class="vw-cta vw-cta--outline"
										data-on={added ? "true" : undefined}
										aria-pressed={added}
										onClick={onToggleBasket}
									>
										<ViewIcon name={added ? "check" : "basket"} size={18} />
										<span>{added ? "In basket" : "Add to basket"}</span>
									</button>
									<a class="vw-cta vw-cta--ghost" href={msgHref}>
										<ViewIcon name="message" size={18} />
										<span>{msgLabel}</span>
									</a>
								</>
							)
							: (
								<>
									<a class="vw-cta vw-cta--primary" href={msgHref}>
										<ViewIcon name="message" size={18} />
										<span>{msgLabel}</span>
									</a>
									<button
										type="button"
										class="vw-cta vw-cta--outline"
										data-on={favorited.value ? "true" : undefined}
										aria-pressed={favorited.value}
										onClick={() => (favorited.value = !favorited.value)}
									>
										<ProfileIcon name="star" class="vw-cta__glyph" />
										<span>{favorited.value ? "Saved" : "Save"}</span>
									</button>
								</>
							)}
					</div>

					<p class="vw-ctas__status" role="status" aria-live="polite">{status.value}</p>

					{/* Trust & operational meta. */}
					<ul class="vw-trust" aria-label="Trust & delivery">
						{trust.map((t) => (
							<li key={t.label} class="vw-trust__item">
								<span class="vw-trust__icon" data-icon={t.icon} aria-hidden="true">
									<ViewIcon name={t.icon as ViewGlyph} size={18} />
								</span>
								<span class="vw-trust__text">
									<span class="vw-trust__label">{t.label}</span>
									<span class="vw-trust__value">{t.value}</span>
								</span>
							</li>
						))}
					</ul>
				</div>

				<div class="pf-lane__footer">
					<Tooltip content="Collapse lane" placement="top">
						<button
							type="button"
							class="pf-lane__collapse"
							aria-label="Collapse lane"
							aria-pressed={false}
							onClick={() => setLaneCollapsed(true)}
						>
							<SidebarToggleIcon />
						</button>
					</Tooltip>
				</div>
			</div>
		</div>
	);
}
