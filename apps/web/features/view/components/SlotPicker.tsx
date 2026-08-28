import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import type { BookableSlot, SlotGrid } from "@projective/types/scheduling";
import { plural } from "@projective/types/services";

/**
 * SlotPicker — the lower half of the booking modal: the chosen day's start times as rounded-rect
 * pills.
 *
 * # Times are the VIEWER's, and the surface says so
 *
 * Every slot carries an absolute instant, so the pills are formatted with
 * `Intl.DateTimeFormat(undefined, { timeZone: viewerTimezone })` — the buyer's own calendar, converted
 * from the provider's schedule zone by the server having bucketed the days. When the two zones differ
 * the header discloses both, because "2:00 PM" without a zone is the single most expensive ambiguity a
 * booking surface can ship, and a buyer in Sydney reading a provider's London afternoon has to be
 * shown which one they are looking at.
 *
 * # Unavailable slots are rendered, not hidden
 *
 * A day with four times of which three are taken is a different fact from a day with one time, and a
 * picker that hides the difference teaches a buyer that the provider is barely available. Taken slots
 * are `aria-disabled` and carry their reason in the accessible name; they refuse selection without
 * refusing attention (the same rule the date rail applies to closed days).
 *
 * # Multi-select for a session block
 *
 * A set-session purchase may schedule several sittings up front. `max` caps the selection; the
 * component enforces it by refusing the (max + 1)th press rather than by disabling every other pill,
 * because disabling the rest would make the cap look like the provider running out of availability.
 */
export interface SlotPickerProps {
	grid: SlotGrid;
	/** The day being shown. `null` renders the empty prompt rather than an arbitrary day. */
	dayKey: string | null;
	/** The chosen slot ids, in selection order. */
	selected: readonly string[];
	onToggle: (slotId: string) => void;
	/** How many slots may be chosen. `1` for everything except a set-session block. */
	max: number;
	busy?: boolean;
}

export function SlotPicker(props: SlotPickerProps): JSX.Element {
	const { grid, dayKey, selected, onToggle, max, busy } = props;
	const slots = dayKey ? grid.slots[dayKey] ?? [] : [];
	const atCap = selected.length >= max;

	if (grid.closed) {
		return (
			<div class="sbk-slots sbk-slots--empty">
				<Icon name="calendar" size="md" class="sbk-slots__glyph" aria-hidden />
				<p class="sbk-slots__note">
					{grid.closedReason ?? "This provider is not taking bookings at the moment."}
				</p>
			</div>
		);
	}

	if (!dayKey) {
		return (
			<div class="sbk-slots sbk-slots--empty">
				<p class="sbk-slots__note">Pick a date to see available times.</p>
			</div>
		);
	}

	if (slots.length === 0) {
		return (
			<div class="sbk-slots sbk-slots--empty">
				<p class="sbk-slots__note">No times on this date. Try another day.</p>
			</div>
		);
	}

	return (
		<div class="sbk-slots">
			<div
				class="sbk-slots__grid"
				role="group"
				aria-label={`Available times, ${grid.durationMinutes} minutes each`}
				aria-busy={busy ? "true" : undefined}
			>
				{slots.map((slot) => {
					const isSelected = selected.includes(slot.id);
					// At the cap an UNSELECTED pill is refused; a selected one must stay pressable or the
					// buyer cannot change their mind without starting over.
					const blocked = !slot.available || (atCap && !isSelected);
					return (
						<button
							key={slot.id}
							type="button"
							class="sbk-slot"
							// `aria-pressed` rather than `radio`: a set-session block is genuinely multi-select,
							// and one control that changes ARIA role with its `max` would announce differently
							// on two listings that look identical.
							aria-pressed={isSelected}
							aria-disabled={blocked ? "true" : undefined}
							data-selected={isSelected ? "true" : undefined}
							data-blocked={blocked ? "true" : undefined}
							onClick={() => !blocked && onToggle(slot.id)}
						>
							<span class="sbk-slot__time">{slotTime(slot, grid.viewerTimezone)}</span>
							{slot.seatsRemaining !== null && slot.available && (
								<span class="sbk-slot__seats">
									{slot.seatsRemaining} {plural(slot.seatsRemaining, "seat")}
								</span>
							)}
							<span class="ui-visually-hidden">{slotSummary(slot, grid)}</span>
						</button>
					);
				})}
			</div>

			<p class="sbk-slots__zone">
				{zoneLine(grid)}
			</p>
		</div>
	);
}

// #region Formatting
/** The pill's visible time, in the VIEWER's zone. */
function slotTime(slot: BookableSlot, timezone: string): string {
	try {
		return new Intl.DateTimeFormat(undefined, {
			timeZone: timezone,
			hour: "numeric",
			minute: "2-digit",
		}).format(new Date(slot.startsAt));
	} catch {
		return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
			.format(new Date(slot.startsAt));
	}
}

/**
 * The slot's full accessible name.
 *
 * A refused slot says WHY. "2:00 PM, unavailable" tells a screen-reader user nothing they can act on;
 * "2:00 PM, already booked" tells them to look elsewhere on this day, and "the provider is away" tells
 * them to look at another day entirely.
 */
function slotSummary(slot: BookableSlot, grid: SlotGrid): string {
	const time = slotTime(slot, grid.viewerTimezone);
	const length = `${grid.durationMinutes} minutes`;
	if (!slot.available) {
		const why = slot.reason === "taken"
			? "already booked"
			: slot.reason === "blackout"
			? "the provider is away"
			: slot.reason === "inside_minimum_notice"
			? "too soon to book"
			: slot.reason === "past"
			? "already passed"
			: "unavailable";
		return `${time}, ${why}`;
	}
	if (slot.seatsRemaining !== null) {
		return `${time}, ${length}, ${slot.seatsRemaining} ${plural(slot.seatsRemaining, "seat")} left`;
	}
	return `${time}, ${length}`;
}

/**
 * The timezone disclosure.
 *
 * Names the zone the times are drawn in — always — and the provider's too when the two differ. It does
 * NOT claim a conversion it is not performing: the instants are absolute and the browser formats them,
 * so "shown in your timezone" is true here in a way it was not on the listing's calendar, where the
 * engine renders one wall clock from the provider's zone (the Decision #79 correction).
 */
function zoneLine(grid: SlotGrid): string {
	const pretty = (z: string) => z.replace(/_/g, " ");
	if (grid.viewerTimezone !== grid.providerTimezone) {
		return `Times shown in your timezone (${pretty(grid.viewerTimezone)}). The provider is in ${
			pretty(grid.providerTimezone)
		}.`;
	}
	return `Times shown in ${pretty(grid.viewerTimezone)}.`;
}
// #endregion
