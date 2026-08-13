import type { JSX } from "preact";
import { fulfilmentKindOf, itemKindMeta } from "@projective/types/finance";
import { Icon } from "@projective/ui/icons";
import { Amount } from "./Amount.tsx";
import { groupIconName } from "./checkout-glyphs.tsx";
import { DownloadAction } from "./DownloadAction.tsx";
import CalendarActions from "../islands/CalendarActions.island.tsx";
import type { OrderLine } from "../types/checkout-types.ts";

/**
 * OrderLineRow — one purchased line and the single thing the buyer can now do with it.
 *
 * **The route is resolved by {@link fulfilmentKindOf}, never by reading `line.fulfilment`.** That
 * field is a CLAIM; the resolver checks whether the facts supporting it are actually present. A line
 * claiming `download` with no `downloadHref` therefore renders the honest "not ready yet" instead of
 * a button that 404s, and a line claiming `session` with no slot never draws a calendar export for a
 * time nobody booked. Switching on the claim directly would put that failure one absent field away on
 * every row.
 *
 * **`pending` is a first-class outcome, not an absence.** A stage ticket bought into an unfunded
 * stage has nothing to open yet; rendering that as a missing control reads as a broken page, so the
 * row states the reason and offers nothing to press. A disabled control would be worse still — it
 * advertises a capability and then refuses it.
 *
 * **No figure on this row is computed here.** `lineTotal` is a server-formatted `MoneyView`; the row
 * never multiplies a unit price by a quantity, which is the second arithmetic path a money surface
 * cannot afford. The quantity is rendered as a COUNT beside it, never folded into the price.
 *
 * Every destination follows a canonical route shape: an engagement resolves into the project channel
 * namespace `/projects/[projectId]/[channelId]` (the SSOT's `engagementHref`, mapped stage → channel
 * server-side), and a download is a same-origin path. This component builds no URL of its own.
 */

// #region Props
/** Props for {@link OrderLineRow}. */
export interface OrderLineRowProps {
	/** The purchased line, exactly as the server projected it. */
	line: OrderLine;
}
// #endregion

/** Render one line of the purchased-items hub. */
export function OrderLineRow(props: OrderLineRowProps): JSX.Element {
	const { line } = props;
	const kind = fulfilmentKindOf(line);
	const meta = itemKindMeta(line.itemType);

	return (
		<li class="cko-order__line" data-fulfilment={kind}>
			<span class="cko-order__figure" aria-hidden="true">
				{line.thumbnail
					? <img class="cko-order__img" src={line.thumbnail} alt="" loading="lazy" />
					: <Icon name={groupIconName(meta.group)} size="md" />}
			</span>

			<div class="cko-order__body">
				<p class="cko-order__linetitle">{line.title}</p>
				{line.subtitle ? <p class="cko-order__linesub">{line.subtitle}</p> : null}

				<p class="cko-order__meta">
					<span>{meta.label}</span>
					{line.sellerName ? <span>{line.sellerName}</span> : null}
					{line.quantity > 1 ? <span>{`Quantity ${line.quantity}`}</span> : null}
				</p>

				<Fulfilment line={line} kind={kind} />
			</div>

			<span class="cko-order__price">
				<Amount value={line.lineTotal} />
			</span>
		</li>
	);
}

// #region Fulfilment branches
/** Props for the per-route fulfilment block. */
interface FulfilmentProps {
	line: OrderLine;
	kind: ReturnType<typeof fulfilmentKindOf>;
}

/**
 * The one action a line's resolved route affords.
 *
 * A `switch` over the RESOLVED kind (not the claimed one) with no `default` fall-through to a
 * control: an unrecognised route lands on `pending`, which is the state that promises nothing.
 */
function Fulfilment({ line, kind }: FulfilmentProps): JSX.Element | null {
	if (kind === "download") return <DownloadAction line={line} />;

	if (kind === "engagement" && line.engagementHref) {
		return (
			<div class="cko-order__fulfil">
				<a
					class="cko-order__act"
					href={line.engagementHref}
					aria-label={`Open ${line.engagementLabel ?? line.title}`}
				>
					<Icon name="arrow-right" optical="right" />
					<span>{line.engagementLabel ?? "Open the workspace"}</span>
				</a>
			</div>
		);
	}

	if (kind === "session") return <SessionFulfilment line={line} />;

	return (
		<p class="cko-order__pending">
			<Icon name="hourglass" />
			<span>
				{line.pendingNote ??
					"This starts once the work it belongs to is ready. Nothing else is needed from you."}
			</span>
		</p>
	);
}

/**
 * A booked session: when it is, where it happens, and how to put it in the buyer's own calendar.
 *
 * The slot is printed from `scheduledLabel` — a server-formatted string that already carries the
 * timezone the buyer is being shown it in. Formatting the instant client-side would resolve against
 * the BROWSER's zone, so a buyer who booked a London slot while travelling would be told a different
 * time by the page than by the confirmation email.
 */
function SessionFulfilment({ line }: { line: OrderLine }): JSX.Element {
	return (
		<div class="cko-order__fulfil">
			<p class="cko-order__slot">
				<span class="cko-order__slottime">{line.scheduledLabel ?? "Scheduled"}</span>
				<span class="cko-order__slotzone">
					{[
						line.timezone,
						line.durationMinutes ? `${line.durationMinutes} minutes` : null,
						line.seats && line.seats > 1 ? `${line.seats} seats` : null,
					].filter(Boolean).join(" · ")}
				</span>
			</p>

			<div class="cko-order__fulfilrow">
				{line.joinUrl
					? (
						<a
							class="cko-order__act"
							href={line.joinUrl}
							target="_blank"
							rel="noopener noreferrer"
							aria-label={`Join ${line.title}${
								line.conferencingLabel ? ` on ${line.conferencingLabel}` : ""
							}`}
						>
							<Icon name="video-camera" />
							<span>{line.conferencingLabel ? `Join on ${line.conferencingLabel}` : "Join"}</span>
						</a>
					)
					: (
						/*
						 * No room yet. The provider mints it closer to the time, so the row says which
						 * provider will host and stops — a disabled Join would imply the link exists and
						 * is merely withheld.
						 */
						<p class="cko-order__pending">
							<Icon name="clock" />
							<span>
								{line.conferencingLabel
									? `The ${line.conferencingLabel} link appears here nearer the time.`
									: "The joining link appears here nearer the time."}
							</span>
						</p>
					)}
			</div>

			{line.calendar ? <CalendarActions links={line.calendar} title={line.title} /> : null}
		</div>
	);
}
// #endregion
