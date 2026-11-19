import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Button, InputText } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { ViewerSeat } from "@projective/types/projects";
import { SeatLinkService, seatLinkHref } from "../core/SeatLinkService.ts";
import { currentOffer } from "../core/booking-state.ts";

/** Props for {@link SeatShare}. */
export interface SeatShareProps {
	seat: ViewerSeat;
	/** The listing, named in the share sentence. */
	title: string;
}

/**
 * SeatShare — the buyer's own place on a group session (Decision #522): how many seats they hold, who
 * claimed the ones they shared, and, for a paid booking of more than one seat on a cohort that has not
 * started, one link that hands the spare seats out first come first served. Copy, then turn the link
 * off when everyone has theirs; seats already claimed stay claimed. Unboxed rows inside the lane body.
 */
export function SeatShare({ seat, title }: SeatShareProps): JSX.Element {
	const code = useSignal<string | null>(seat.code);
	const busy = useSignal<"share" | "revoke" | null>(null);
	const status = useSignal("");
	const error = useSignal<string | null>(null);
	if (seat.code !== null && code.peek() === null && busy.peek() === null) code.value = seat.code;

	const link = code.value ? seatLinkHref(code.value, globalThis.location?.origin ?? "") : null;
	const spare = Math.max(0, seat.seats - 1);

	async function act(action: "share" | "revoke"): Promise<void> {
		if (busy.value) return;
		busy.value = action;
		error.value = null;
		const res = await SeatLinkService.act({ action, membershipId: seat.membershipId });
		busy.value = null;
		if (!res.ok || !res.data) {
			error.value = res.message ?? "That didn't go through. Try again.";
			return;
		}
		code.value = res.data.code;
		status.value = res.data.confirmation;
		const offer = currentOffer.peek();
		if (offer?.seat) currentOffer.value = { ...offer, seat: { ...offer.seat, code: res.data.code } };
	}

	async function copy(): Promise<void> {
		if (!link) return;
		try {
			await globalThis.navigator.clipboard.writeText(link);
			status.value = "Link copied.";
		} catch {
			status.value = "Couldn't copy. Select the link and copy it.";
		}
	}

	return (
		<section class="evp-seatshare" aria-label="Your seats">
			<p class="evp-seatshare__fact">
				{seat.sponsored
					? "You have a seat someone shared with you."
					: seat.seats === 1
					? "You have 1 seat."
					: `You hold ${seat.seats} seats: yours and ${spare} to hand on.`}
			</p>
			{seat.claimed.length > 0 && (
				<p class="evp-seatshare__meta">
					Claimed by {seat.claimed.map((c) => c.name).join(", ")}
				</p>
			)}
			{seat.canShare && !link && (
				<Button
					label={spare === 1 ? "Share your spare seat" : `Share ${spare} seats`}
					icon={<Icon name="link" size="sm" />}
					size="sm"
					severity="neutral"
					variant="outlined"
					aria-busy={busy.value === "share"}
					onClick={() => void act("share")}
				/>
			)}
			{link && (
				<div class="evp-seatshare__link">
					<InputText
						value={link}
						readOnly
						aria-label={`Seat link for ${title}`}
						fluid
						onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
					/>
					<div class="evp-seatshare__actions">
						<Button
							label="Copy link"
							icon={<Icon name="copy" size="sm" />}
							size="sm"
							severity="neutral"
							variant="outlined"
							onClick={() => void copy()}
						/>
						<Button
							label="Turn off"
							size="sm"
							variant="text"
							severity="secondary"
							aria-busy={busy.value === "revoke"}
							onClick={() => void act("revoke")}
						/>
					</div>
					<p class="evp-seatshare__meta">
						Anyone with the link can claim one seat until the first session starts. Nothing more is charged.
					</p>
				</div>
			)}
			{error.value && <p class="evp-seatshare__error" role="alert">{error.value}</p>}
			<p class="ui-visually-hidden" role="status" aria-live="polite">{status.value}</p>
		</section>
	);
}
