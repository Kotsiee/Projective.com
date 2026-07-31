import { type JSX, type VNode } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
// The action lane reuses the profile lane's `pf-lane*` skeleton (header + collapse machinery + the
// `.ui-splitter[data-mode]` / `:root[data-guest-nav]` density reveals), so profile.css must ride this
// island's client bundle. `view.css` layers the pricing/CTA/trust content styling on top.
import "@features/profile/styles/profile.css";
import "../styles/view.css";
// A stage-showcase service (Pipeline / One-Off) reuses the project lane's stage-jump navigation +
// collapsed numbered rail, so `project-view.css` (`.vw-jumps*` / `.vw-railnum*`) must ride this bundle.
import "../styles/project-view.css";
import { ProfileIcon } from "@features/profile/components/profile-glyphs.tsx";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import { ViewLaneHeader } from "../components/ViewLaneHeader.tsx";
import { type ViewGlyph, ViewIcon } from "../components/view-glyphs.tsx";
import { commerceFor, messageHrefFor, scheduleHrefFor, signInHref } from "../core/view-model.ts";
import { availabilityMode, jumpToStage, setAvailabilityMode } from "../core/view-state.ts";
import { basketIds, hydrateBasket, inBasket, toggleBasket } from "../core/basket-state.ts";
import type {
	EntityPricing,
	ExploreItem,
	ProjectStage,
	TrustFact,
} from "@projective/types/explore";
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
// #endregion

export interface ViewActionLaneProps {
	item: ExploreItem;
	pricing: EntityPricing;
	trust: TrustFact[];
	/** Whether the viewer is signed in — gates the message/purchase CTAs to a sign-in bounce. */
	authed: boolean;
	/** The render context (public Explore vs a profile namespace) — drives the sign-in return path. */
	ctx: HrefContext;
	/**
	 * A stage-showcase service's stages (Pipeline / One-Off). When present the lane adds the same
	 * stage-jump navigation the Projects view uses — quick-jump list (expanded) + numbered squares
	 * (collapsed rail) that drive the shared `selectedStageId`, expanding + scrolling the `StageFlow`.
	 */
	stages?: ProjectStage[];
}

export default function ViewActionLane(
	{ item, pricing, trust, authed, ctx, stages }: ViewActionLaneProps,
): JSX.Element {
	const hasStages = !!stages && stages.length > 0;
	const favorited = useSignal(false);
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

	// #region Derived
	// A Session service is booked from its schedule, not bought outright (root CLAUDE.md Decision #37):
	// its primary CTA opens the availability calendar instead of Buy/Add-to-basket. Shared with the
	// ≤767px in-body `ViewBuyBar` so the two CTA stacks cannot drift.
	const { bookable, group, purchasable, bookLabel, msgLabel } = commerceFor(item);
	const scheduleHref = bookable ? scheduleHrefFor(item, ctx) : null;
	const msgHref = authed ? messageHrefFor(item) : signInHref(item, ctx);

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
		...(bookable
			? [
				{
					key: "book",
					label: group ? "View session times" : "View availability",
					icon: <ViewIcon name="calendar" />,
					onClick: () => setAvailabilityMode(true),
					on: availabilityMode.value,
					primary: true,
				},
			]
			: []),
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
			primary: !purchasable && !bookable,
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
					{/* Stage-showcase service — numbered stage-jump squares (mirrors the Projects rail). */}
					{hasStages
						? stages!.map((s) => (
							<Tooltip key={s.id} content={s.name} placement="right">
								<button
									type="button"
									class="pf-railbtn vw-railnum"
									data-status={s.status}
									aria-label={`Jump to stage ${s.index}: ${s.name}`}
									onClick={() => jumpToStage(s.id)}
								>
									<span class="vw-railnum__n">{s.index}</span>
								</button>
							</Tooltip>
						))
						: null}
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
				<ViewLaneHeader
					item={item}
					ctx={ctx}
					saved={favorited}
					onToggleSaved={() => (favorited.value = !favorited.value)}
					onStatus={announce}
				/>

				<div class="pf-lane__scroll vw-lane__scroll">
					{/* Pricing block. */}
					<div class="vw-price" data-mode={pricing.mode}>
						<span class="vw-price__value">{pricing.display}</span>
						{pricing.caption ? <span class="vw-price__caption">{pricing.caption}</span> : null}
					</div>

					{
						/* Availability toggle (Session / Group Session) — swaps the main showcase for the
					    calendar via the shared `availabilityMode` signal (Part 2). */
					}
					{bookable
						? (
							<div class="pf-availtoggle" role="tablist" aria-label="Showcase or availability">
								<button
									type="button"
									class="pf-availtoggle__opt"
									role="tab"
									aria-selected={!availabilityMode.value}
									data-active={!availabilityMode.value ? "true" : undefined}
									onClick={() => setAvailabilityMode(false)}
								>
									<ViewIcon name="image" size={16} />
									<span>Showcase</span>
								</button>
								<button
									type="button"
									class="pf-availtoggle__opt"
									role="tab"
									aria-selected={availabilityMode.value}
									data-active={availabilityMode.value ? "true" : undefined}
									onClick={() => setAvailabilityMode(true)}
								>
									<ViewIcon name="calendar" size={16} />
									<span>{group ? "Session times" : "Availability"}</span>
								</button>
							</div>
						)
						: null}

					{
						/* Primary action CTAs, stacked. `Button` variants carry the interaction weight (§B.8.1)
					    — exactly one `filled` commitment, a real alternative `outlined`, and the escape
					    hatch as `text`. They were three identically-shaped full-width pills distinguished
					    only by fill. */
					}
					<div class="vw-ctas">
						{bookable
							? (
								<>
									<Button
										fluid
										rounded
										icon={<ViewIcon name="calendar" size={18} />}
										label={bookLabel}
										onClick={() => setAvailabilityMode(true)}
									/>
									<Button
										variant="text"
										fluid
										rounded
										icon={<ViewIcon name="message" size={18} />}
										label={msgLabel}
										onClick={() => (globalThis.location.href = msgHref)}
									/>
									{scheduleHref
										? (
											<a class="vw-lane__fulllink" href={scheduleHref}>
												Open full calendar
											</a>
										)
										: null}
								</>
							)
							: purchasable
							? (
								<>
									<Button
										fluid
										rounded
										icon={<ViewIcon name="buy" size={18} />}
										label="Buy now"
										onClick={onBuy}
									/>
									<Button
										variant="outlined"
										fluid
										rounded
										aria-pressed={added}
										icon={<ViewIcon name={added ? "check" : "basket"} size={18} />}
										label={added ? "In basket" : "Add to basket"}
										onClick={onToggleBasket}
									/>
									<Button
										variant="text"
										fluid
										rounded
										icon={<ViewIcon name="message" size={18} />}
										label={msgLabel}
										onClick={() => (globalThis.location.href = msgHref)}
									/>
								</>
							)
							: (
								<>
									<Button
										fluid
										rounded
										icon={<ViewIcon name="message" size={18} />}
										label={msgLabel}
										onClick={() => (globalThis.location.href = msgHref)}
									/>
									<Button
										variant="outlined"
										fluid
										rounded
										aria-pressed={favorited.value}
										icon={<ProfileIcon name="star" />}
										label={favorited.value ? "Saved" : "Save"}
										onClick={() => (favorited.value = !favorited.value)}
									/>
								</>
							)}
					</div>

					<p class="vw-ctas__status" role="status" aria-live="polite">{status.value}</p>

					{/* Stage quick-jumps — Pipeline / One-Off services (same nav as the Projects view). */}
					{hasStages
						? (
							<section class="vw-jumps" aria-label="Jump to a stage">
								<span class="vw-jumps__head">Stages</span>
								<ul class="vw-jumps__list" role="list">
									{stages!.map((s) => (
										<li key={s.id}>
											<button
												type="button"
												class="vw-jump"
												data-status={s.status}
												onClick={() => jumpToStage(s.id)}
											>
												<span class="vw-jump__idx" aria-hidden="true">{s.index}</span>
												<span class="vw-jump__text">
													<span class="vw-jump__name">{s.name}</span>
													<span class="vw-jump__sub">
														{s.turnaround ? `${s.turnaround} · ` : ""}
														{s.price.label}
													</span>
												</span>
												<ViewIcon name="chevron-right" size={16} class="vw-jump__chev" />
											</button>
										</li>
									))}
								</ul>
							</section>
						)
						: null}

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
