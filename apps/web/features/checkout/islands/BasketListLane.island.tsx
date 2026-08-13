import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/checkout.css";
import {
	LaneCollapseButton,
	LaneEmpty,
	LaneFooter,
	LaneHead,
	LaneIconButton,
	LaneList,
	LaneSearch,
	LaneSection,
	LaneSections,
} from "@projective/ui/navigation";
import { Button, InputText } from "@projective/ui/fields";
import { Dialog, Popover, Tooltip } from "@projective/ui/feedback";
import { Icon, type IconName } from "@projective/ui/icons";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import { Amount } from "../components/Amount.tsx";
import { CollapseGlyph } from "../components/checkout-glyphs.tsx";
import { BasketService } from "../core/BasketService.ts";
import { basketHref } from "../core/basket-model.ts";
import {
	applyBasket,
	applyResponse,
	baskets as basketsSignal,
	currentCheckoutContext,
} from "../core/basket-state.ts";
import { activeListId, lists as listsSignal } from "../core/checkout-state.ts";
import { useCheckoutSeamPassive } from "../core/checkout-seam.ts";
import type {
	BasketListEntry,
	BasketLists,
	CheckoutStep,
	MoneyView,
} from "../types/checkout-types.ts";

/**
 * BasketListLane — the middle-nav LANE for step 1: **which basket, and what else the buyer keeps**.
 *
 * Per the region contract (Decisions #60 / #63) a lane owns navigation and scope, and NOTHING else.
 * This one reads top to bottom as the buyer's own filing: a search field, the open Basket, the
 * Invoices destination beside it, then the named Lists they park things in and the engagement-derived
 * Tickets and Sessions the server grouped over the open basket.
 *
 * **It holds no total and no commit control.** Both moved to the footer band, which is the region the
 * contract gives every money action on this surface — and which stays visible when the lane is
 * collapsed or removed on a phone, so the flow can always be advanced. The one figure that survives
 * here is the open basket's running total, printed against the Basket row it belongs to: that is a
 * property of a destination, the way a count is, not a commitment.
 *
 * **Both presentations live in the DOM at once** and CSS reveals exactly one, keyed off the splitter's
 * `data-mode`. That is the shipped repo pattern (`ProjectSidebar`, `WalletLane`, `CatalogueLane`): a
 * client width observer paints the wrong presentation for a frame on every load, and a list switcher
 * that flickers reads as a bug in the basket.
 *
 * **Every figure is a server `MoneyView`** rendered through {@link Amount}. Nothing here sums a list,
 * converts a currency or formats an amount; the entries arrive priced.
 *
 * **Mobile:** `.ui-middle-nav__lane` is `display: none` below 767px, so the whole lane is unreachable
 * on a phone and both the navigation and the advance duty transfer to the bands.
 */

// #region Props
/** Props for {@link BasketListLane}. */
export interface BasketListLaneProps {
	/** The SSR-resolved navigation model, so the explorer paints its rows in the first byte. */
	lists: BasketLists;
	/** The basket currently open. */
	activeBasketId: string | null;
	/** The acting owner scope (`personal` · `team:northwind` · …). */
	owner: string;
	/** The display currency every server figure was formatted in. */
	display: string;
	/** Which step of the flow the URL addresses — the lane only navigates within step 1. */
	step: CheckoutStep;
	/** How many active lines have gone unavailable — the lane's one ambient status. */
	unavailableCount: number;
}
// #endregion

/** Where the Invoices destination points — the wallet owns billing documents, the basket does not. */
const INVOICES_HREF = "/wallet/invoices";

export default function BasketListLane(props: BasketListLaneProps): JSX.Element {
	const collapsed = useSignal(false);
	const query = useSignal("");
	const listsOpen = useSignal(true);
	const ticketsOpen = useSignal(true);
	const sessionsOpen = useSignal(true);
	const railSwitchOpen = useSignal(false);
	const createOpen = useSignal(false);
	const createName = useSignal("");
	const creating = useSignal(false);

	// The lane renders shared state but owns no fetch: the body is the single reader, so a passive
	// mirror keeps the two from racing for the same basket.
	useCheckoutSeamPassive({
		basketId: props.activeBasketId,
		owner: props.owner,
		display: props.display,
	});

	useEffect(() => {
		const el = document.querySelector(".ui-splitter") as HTMLElement | null;
		if (el) collapsed.value = el.dataset.mode === "collapsed";
	}, []);

	const setCollapsed = (next: boolean) => {
		collapsed.value = next;
		globalThis.dispatchEvent(
			new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
		);
	};

	/*
	 * The BODY is the one region that reads, so the live model is preferred and the SSR prop is the
	 * fallback for the frames before hydration. Reading the other way round would leave the lane
	 * describing a basket the body has already replaced.
	 */
	const model = listsSignal.value ?? props.lists;
	const active = activeListId.value ?? model.activeId;

	/*
	 * The open basket is lifted OUT of the list stack and pinned above the section headers. It is not
	 * one of the buyer's named shelves — it is the thing the rest of the surface is about — so filing
	 * it under "Lists" alongside "3D Assets" would bury the one row that carries a running total.
	 */
	const primary = model.lists.find((entry) => entry.kind === "basket" && entry.isDefault) ??
		model.lists.find((entry) => entry.kind === "basket") ?? null;
	const named = model.lists.filter((entry) => entry.id !== primary?.id);

	const q = query.value.trim().toLowerCase();
	const matches = (label: string) => q === "" || label.toLowerCase().includes(q);
	const filter = (entries: readonly BasketListEntry[]) =>
		q === "" ? entries : entries.filter((entry) => matches(entry.label));

	const primaryShown = primary !== null && matches(primary.label);
	const invoicesShown = matches("Invoices");
	const namedShown = filter(named);
	const ticketsShown = filter(model.tickets);
	const sessionsShown = filter(model.sessions);

	/*
	 * A search that narrows only part of the lane is a search the reader cannot trust, so every row is
	 * subject to it — including the two pinned destinations. When nothing survives, ONE empty state
	 * speaks for the whole lane rather than three section-shaped ones repeating each other.
	 */
	const nothingMatches = q !== "" && !primaryShown && !invoicesShown &&
		namedShown.length === 0 && ticketsShown.length === 0 && sessionsShown.length === 0;

	/** Create a further named list, then open it — a list nobody lands in is a list nobody uses. */
	const createList = async (): Promise<void> => {
		const name = createName.value.trim();
		if (name === "" || creating.value) return;
		creating.value = true;
		const res = await BasketService.createBasket({ name }, currentCheckoutContext());
		const ok = applyResponse(res, applyBasket);
		creating.value = false;
		if (!ok || !res.data) return;
		basketsSignal.value = res.data.baskets;
		createOpen.value = false;
		createName.value = "";
		globalThis.location.assign(basketHref(res.data.basket.id, props.owner));
	};

	return (
		<div class="bsk-lane" data-step={props.step}>
			{/* Expanded presentation */}
			<div class="bsk-lane__full">
				<LaneHead>
					<LaneSearch
						value={query.value}
						placeholder="Search…"
						label="Search baskets, lists and tickets"
						icon={<Icon name="search" />}
						onInput={(value) => (query.value = value)}
					/>
				</LaneHead>

				<LaneList label="Baskets and lists">
					{nothingMatches
						? (
							<LaneEmpty
								title="Nothing matches"
								note="Clear the search to see every list."
								icon={<Icon name="basket" />}
							/>
						)
						: (
							<>
								{
									/*
									 * The two pinned destinations. The Basket is where the flow happens; Invoices is
									 * its sibling record of what the buyer has already paid for, which is why it is a
									 * plain row with neither a count nor a figure — it is a place, not a pile.
									 */
								}
								<ul class="bsk-lane__list bsk-lane__list--pinned">
									{primary && primaryShown && (
										<li>
											<LaneRow
												href={primary.href}
												icon="basket"
												label={primary.label}
												active={primary.id === active}
												count={primary.itemCount}
												money={primary.checkoutable ? primary.subtotal : null}
											/>
										</li>
									)}
									{invoicesShown && (
										<li>
											<LaneRow href={INVOICES_HREF} icon="document" label="Invoices" />
										</li>
									)}
								</ul>

								<LaneSections>
									<LaneSection
										id="bsk-lists"
										icon={<Icon name="list" />}
										label="Lists"
										open={listsOpen.value}
										onToggle={() => (listsOpen.value = !listsOpen.value)}
										action={
											<LaneIconButton
												icon={<Icon name="plus" />}
												label="New list"
												onClick={() => (createOpen.value = true)}
											/>
										}
									>
										{namedShown.length === 0
											? (
												<LaneEmpty
													title={q === "" ? "No other lists yet" : "No lists match"}
													note={q === ""
														? "Park something for later and it lands in a list."
														: undefined}
												/>
											)
											: (
												<ul class="bsk-lane__list">
													{namedShown.map((entry) => (
														<li key={entry.id}>
															<LaneRow
																href={entry.href}
																icon={entryIcon(entry)}
																label={entry.label}
																active={entry.id === active}
																count={entry.itemCount}
															/>
														</li>
													))}
												</ul>
											)}
									</LaneSection>

									{(q === "" || ticketsShown.length > 0) && (
										<LaneSection
											id="bsk-tickets"
											icon={<Icon name="ticket" />}
											label="Tickets"
											open={ticketsOpen.value}
											onToggle={() => (ticketsOpen.value = !ticketsOpen.value)}
										>
											{ticketsShown.length === 0
												? <LaneEmpty title="No tickets in this basket" />
												: (
													<ul class="bsk-lane__list">
														{ticketsShown.map((entry) => (
															<li key={entry.id}>
																<LaneRow
																	href={entry.href}
																	icon="ticket"
																	thumbnail={entry.thumbnail}
																	label={entry.label}
																	active={entry.id === active}
																	count={entry.itemCount}
																/>
															</li>
														))}
													</ul>
												)}
										</LaneSection>
									)}

									{(q === "" || sessionsShown.length > 0) && (
										<LaneSection
											id="bsk-sessions"
											icon={<Icon name="calendar" />}
											label="Sessions"
											open={sessionsOpen.value}
											onToggle={() => (sessionsOpen.value = !sessionsOpen.value)}
										>
											{sessionsShown.length === 0
												? <LaneEmpty title="No sessions in this basket" />
												: (
													<ul class="bsk-lane__list">
														{sessionsShown.map((entry) => (
															<li key={entry.id}>
																<LaneRow
																	href={entry.href}
																	icon="calendar"
																	thumbnail={entry.thumbnail}
																	label={entry.label}
																	active={entry.id === active}
																	count={entry.itemCount}
																/>
															</li>
														))}
													</ul>
												)}
										</LaneSection>
									)}
								</LaneSections>
							</>
						)}
				</LaneList>

				{
					/*
					 * The lane's one ambient status. It is a STATE, not an action — acting on an unavailable
					 * line happens on the line itself — and it carries its own words as well as its tone, so
					 * the meaning survives a colour-blind palette (§B.6).
					 */
				}
				{props.unavailableCount > 0 && (
					<p class="bsk-lane__status" role="status" data-tone="warn">
						<Icon name="warning" />
						<span>
							{props.unavailableCount === 1
								? "1 item needs attention"
								: `${props.unavailableCount} items need attention`}
						</span>
					</p>
				)}

				{
					/* The footer band holds the collapse toggle and nothing else — the total and the commit
				    control belong to the frame's footer rig (Decisions #60 / #63). */
				}
				<LaneFooter>
					<LaneCollapseButton
						collapsed={collapsed.value}
						onToggle={() => setCollapsed(!collapsed.value)}
						icon={CollapseGlyph}
					/>
				</LaneFooter>
			</div>

			{/* Collapsed rail — one square per destination, each with a portal Tooltip (§B.6) */}
			<div class="bsk-lane__rail">
				<Tooltip content="Basket" placement="right">
					<a
						class="bsk-lane__railbtn"
						href={basketHref(props.activeBasketId, props.owner)}
						aria-label="Basket"
						data-active={props.step === "basket" ? "true" : undefined}
					>
						<Icon name="basket" size="md" />
					</a>
				</Tooltip>

				<Tooltip content="Invoices" placement="right">
					<a class="bsk-lane__railbtn" href={INVOICES_HREF} aria-label="Invoices">
						<Icon name="document" size="md" />
					</a>
				</Tooltip>

				{
					/*
					 * ONE control opening the list rather than a square per list: every list resolves to the
					 * same two glyphs, so N identical squares would be a list nobody could read without
					 * hovering each one in turn.
					 */
				}
				{model.lists.length > 1 && (
					<Popover
						open={railSwitchOpen}
						placement="right-start"
						label="Switch list"
						class="bsk-menu"
						trigger={(api) => (
							<Tooltip content="Switch list" placement="right">
								<button
									type="button"
									class="bsk-lane__railbtn"
									aria-label="Switch list"
									aria-haspopup="dialog"
									aria-expanded={api.expanded ? "true" : "false"}
									aria-controls={api.panelId}
									onClick={api.toggle}
									ref={api.ref as RefObject<HTMLButtonElement>}
								>
									<Icon name="switch" size="md" />
								</button>
							</Tooltip>
						)}
					>
						{model.lists.map((entry) => (
							<a
								key={entry.id}
								class="bsk-menu__item"
								href={entry.href}
								aria-current={entry.id === active ? "page" : undefined}
							>
								<Icon name={entryIcon(entry)} />
								<span>{entry.label}</span>
								<span class="bsk-menu__count">{entry.itemCount}</span>
							</a>
						))}
					</Popover>
				)}

				{model.tickets.length > 0 && (
					<Tooltip content="Tickets" placement="right">
						<a
							class="bsk-lane__railbtn"
							href={model.tickets[0].href}
							aria-label={`Tickets, ${model.tickets.length} groups`}
						>
							<Icon name="ticket" size="md" />
						</a>
					</Tooltip>
				)}

				{model.sessions.length > 0 && (
					<Tooltip content="Sessions" placement="right">
						<a
							class="bsk-lane__railbtn"
							href={model.sessions[0].href}
							aria-label={`Sessions, ${model.sessions.length} groups`}
						>
							<Icon name="calendar" size="md" />
						</a>
					</Tooltip>
				)}

				{props.unavailableCount > 0 && (() => {
					// One sentence, used twice on purpose: the Tooltip carries it for a sighted viewer and
					// the visually-hidden span carries it for assistive tech. The glyph is `aria-hidden`, so
					// without the span this `role="status"` region would announce nothing at all.
					const one = props.unavailableCount === 1;
					const attention = `${props.unavailableCount} item${one ? "" : "s"} ${
						one ? "needs" : "need"
					} attention`;
					return (
						<Tooltip content={attention} placement="right">
							<span class="bsk-lane__railbtn" data-tone="warn" role="status">
								<Icon name="warning" size="md" />
								<span class="ui-visually-hidden">{attention}</span>
							</span>
						</Tooltip>
					);
				})()}

				<div class="bsk-lane__railfoot">
					<LaneIconButton
						icon={CollapseGlyph}
						label="Expand lane"
						tooltipPlacement="right"
						onClick={() => setCollapsed(false)}
					/>
				</div>
			</div>

			<Dialog
				visible={createOpen}
				header="New list"
				width="26rem"
				onVisibleChange={(open) => {
					if (!open) createName.value = "";
				}}
				footer={
					<>
						<Button
							variant="text"
							severity="secondary"
							disabled={creating.value}
							onClick={() => (createOpen.value = false)}
						>
							Cancel
						</Button>
						<Button
							variant="filled"
							severity="primary"
							loading={creating.value}
							disabled={createName.value.trim() === ""}
							onClick={() => void createList()}
						>
							Create list
						</Button>
					</>
				}
			>
				<p class="bsk-lane__dialognote">
					A list is a basket you have named. Anything parked in one stays there until you move it
					back, and nothing in it is charged for.
				</p>
				<label class="bsk-lane__dialoglabel" for="bsk-new-list">List name</label>
				<InputText
					id="bsk-new-list"
					fluid
					placeholder="3D assets"
					autoComplete="off"
					value={createName}
					disabled={creating.value}
				/>
			</Dialog>
		</div>
	);
}

// #region Rows
/** The glyph a list entry is represented by — its kind, never a guess from its name. */
function entryIcon(entry: BasketListEntry): IconName {
	switch (entry.kind) {
		case "ticket":
			return "ticket";
		case "session":
			return "calendar";
		case "saved":
			return "bookmark";
		case "basket":
		default:
			return entry.isDefault ? "basket" : "bookmark";
	}
}

/** Props for {@link LaneRow}. */
interface LaneRowProps {
	href: string;
	icon: IconName;
	label: string;
	/**
	 * The engagement's own face — a service's cover, a project owner's avatar — drawn INSTEAD of the
	 * category glyph.
	 *
	 * A Tickets section whose every row carries the same ticket glyph is a list a reader has to read
	 * word by word; the artwork is the fastest channel they have for "which project is this". The glyph
	 * remains the fallback: an entry that carries no image draws its category rather than a placeholder,
	 * because a grey box in an avatar's shape reads as a person whose picture failed to load.
	 */
	thumbnail?: string | null;
	/** Whether this row is the destination the surface is currently showing. */
	active?: boolean;
	/** Line count, right-aligned and quiet. Omit for a destination that counts nothing. */
	count?: number;
	/** The server-computed running total. Only the open basket carries one. */
	money?: MoneyView | null;
}

/**
 * One destination in the explorer.
 *
 * The trailing block is deliberately asymmetric: a figure sits ABOVE its count, because the total is
 * what the buyer came to read and the count is the sentence that qualifies it. A row with neither
 * renders no trailing block at all rather than an empty column, so a plain destination reads as a
 * place rather than as a pile someone forgot to fill.
 */
function LaneRow(props: LaneRowProps): JSX.Element {
	const { count, money } = props;
	const hasMeta = money != null || count != null;
	return (
		<a
			class="bsk-lane__row"
			href={props.href}
			data-active={props.active ? "true" : undefined}
			aria-current={props.active ? "page" : undefined}
		>
			{props.thumbnail
				? (
					<span class="bsk-lane__row-face" aria-hidden="true">
						<img src={props.thumbnail} alt="" loading="lazy" decoding="async" />
					</span>
				)
				: <Icon name={props.icon} />}
			<span class="bsk-lane__row-label">{props.label}</span>
			{hasMeta && (
				<span class="bsk-lane__row-meta">
					{money != null && <Amount value={money} size="micro" hideOrigin />}
					{count != null && (
						<span class="bsk-lane__row-count">
							{count} {count === 1 ? "item" : "items"}
						</span>
					)}
				</span>
			)}
		</a>
	);
}
// #endregion
