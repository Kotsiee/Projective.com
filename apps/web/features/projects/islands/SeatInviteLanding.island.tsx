import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "@features/projects/styles/invite-landing.css";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { SeatInviteView } from "@projective/types/projects";
import { SeatLinkService } from "@features/view/core/SeatLinkService.ts";
import { seatInviteCopy } from "../core/seat-invite-copy.ts";

/** Props for {@link SeatInviteLanding}. */
export interface SeatInviteLandingProps {
	code: string;
	/** `null` for a code that names no link. */
	view: SeatInviteView | null;
}

/**
 * SeatInviteLanding — the `/invite/[token]` page for a buyer's seat link (Decision #522): who shared a
 * seat on which session, how many are left, and, only while the link is open to this person, Claim your
 * seat, which takes one first come first served and seats them on the cohort. Shares the stage link's
 * page layout (`invite-landing.css`).
 */
export default function SeatInviteLanding(props: SeatInviteLandingProps): JSX.Element {
	const view = useSignal<SeatInviteView | null>(props.view);
	const busy = useSignal(false);
	const error = useSignal<string | null>(null);
	const claimed = useSignal<string | null>(null);

	async function claim(): Promise<void> {
		if (busy.value) return;
		busy.value = true;
		error.value = null;
		const res = await SeatLinkService.act({ action: "claim", code: props.code });
		busy.value = false;
		if (!res.ok || !res.data) {
			error.value = res.message ?? "That seat couldn't be claimed. Please try again.";
			return;
		}
		claimed.value = res.data.projectSlug ? `/projects/${res.data.projectSlug}` : "/projects";
		if (view.value) view.value = { ...view.value, state: "seated" };
	}

	const copy = claimed.value
		? {
			title: "Your seat is confirmed",
			body: "It's on the booking that was shared with you, so there's nothing to pay. The sessions are in Projects.",
			canClaim: false,
			next: { label: "Open the sessions", href: claimed.value },
		}
		: seatInviteCopy(view.value);

	return (
		<div class="invite-landing">
			<span class="invite-landing__glyph" aria-hidden="true">
				<Icon name={claimed.value ? "check" : "user-plus"} size="lg" />
			</span>
			{view.value && (
				<p class="invite-landing__meta">
					{view.value.cohortName}
					{view.value.firstStartsAt
						? ` · starts ${new Date(view.value.firstStartsAt).toLocaleDateString(undefined, {
							day: "numeric",
							month: "short",
							year: "numeric",
						})}`
						: ""}
				</p>
			)}
			<h1 class="invite-landing__title">{copy.title}</h1>
			<p class="invite-landing__body" role={claimed.value ? "status" : undefined}>{copy.body}</p>
			{copy.canClaim && (
				<div class="invite-landing__ask">
					<Button
						label="Claim your seat"
						icon={<Icon name="check" size="sm" />}
						loading={busy.value}
						onClick={() => void claim()}
					/>
				</div>
			)}
			{error.value && <p class="invite-landing__error" role="alert">{error.value}</p>}
			{copy.next && (
				<a class="invite-landing__next" href={copy.next.href}>
					{copy.next.label}
					<Icon name="arrow-right" size="sm" />
				</a>
			)}
		</div>
	);
}
