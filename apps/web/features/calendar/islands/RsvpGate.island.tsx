import type { JSX } from "preact";
import "../styles/rsvp.css";
import { Button } from "@projective/ui/fields";
import { EmptyState } from "@projective/ui/utils";
import {
	GUEST_ANSWER_SAID,
	type GuestAnswer,
	guestWhen,
	type LiveGuestInvitation,
	RSVP_ACTIONS,
} from "@projective/types/scheduling";
import { Logo } from "@web/components/Logo.tsx";

/**
 * RsvpGate — a guest's invitation, on a page with no shell (Decision #391).
 *
 * An island only so that its sheet and the Button's reach a page that mounts nothing else. Nothing
 * here runs on the client: each act is a plain form posting back to this page, so it works with
 * JavaScript off, and it holds no state of its own. It is the first thing many people ever see of
 * Projective, so it says one thing at a time and sells nothing.
 */
export interface RsvpGateProps {
	token: string;
	/** The invitation behind a live link; `null` for any other link. */
	invitation: LiveGuestInvitation | null;
	/** The read failed, which is not the same as a dead link. */
	failed: boolean;
	signedIn: boolean;
	/** The reader holds the invited address, verified, so the seat can move to their account. */
	canClaim: boolean;
	refusal?: string | null;
	notice?: string | null;
	/** A good code came back: the way into the call. */
	joinUrl?: string | null;
}

/** A plain form back to this page, naming what it does. */
function Press(
	props: { action: string; class?: string; children: JSX.Element | JSX.Element[] },
): JSX.Element {
	return (
		<form method="post" class={props.class}>
			<input type="hidden" name="action" value={props.action} />
			{props.children}
		</form>
	);
}

/** When a room opens, in the same zone the invitation is stated in. */
function openingTime(invitation: LiveGuestInvitation): string {
	return new Intl.DateTimeFormat("en-GB", {
		hour: "2-digit",
		minute: "2-digit",
		timeZone: invitation.timezone ?? "UTC",
	}).format(invitation.opensAt);
}

/** Where a link goes. A host chose it, so the guest is told before following it from our page. */
function hostOf(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
}

/** The call: a state to explain, or the way to prove the address and go in. */
function Room(
	props: { invitation: LiveGuestInvitation; joinUrl?: string | null },
): JSX.Element | null {
	const { invitation, joinUrl } = props;
	if (!invitation.roomState || invitation.roomState === "not_party") return null;

	if (joinUrl) {
		return (
			<section class="rsvp__room" aria-label="Join the call">
				<p class="rsvp__said">You're confirmed.</p>
				<p class="rsvp__meta">This opens {hostOf(joinUrl)}, which your host chose.</p>
				<a
					class="ui-button ui-button--primary ui-button--filled ui-button--size-md"
					href={joinUrl}
					rel="noreferrer"
				>
					<span class="ui-button__label">Open the meeting</span>
				</a>
			</section>
		);
	}
	if (invitation.roomState !== "open") {
		const why = invitation.roomState === "upcoming"
			? `The call opens at ${openingTime(invitation)}. Come back to this page then.`
			: invitation.roomState === "needs_rsvp"
			? "Answer above, and you can join the call from here."
			: "The meeting room isn't ready yet. Check back shortly.";
		return <p class="rsvp__meta">{why}</p>;
	}
	return (
		<section class="rsvp__room" aria-label="Join the call">
			<h2 class="rsvp__heading">Join the call</h2>
			{invitation.codeSent
				? (
					<>
						<p class="rsvp__meta">
							Enter the code we sent to {invitation.addressHint}.
						</p>
						<Press action="join" class="rsvp__code">
							<input
								class="rsvp__input"
								name="code"
								type="text"
								inputMode="numeric"
								autoComplete="one-time-code"
								pattern="[0-9]{6}"
								maxLength={6}
								required
								aria-label="6-digit code"
							/>
							<Button type="submit">Join</Button>
						</Press>
						<Press action="code">
							<Button type="submit" variant="text" severity="secondary" size="sm">
								Send a new code
							</Button>
						</Press>
					</>
				)
				: (
					<>
						<p class="rsvp__meta">
							We'll send a code to {invitation.addressHint} to confirm it's you.
						</p>
						<Press action="code">
							<Button type="submit">Email me a code</Button>
						</Press>
					</>
				)}
		</section>
	);
}

export default function RsvpGate(props: RsvpGateProps): JSX.Element {
	const { invitation, refusal, notice, joinUrl, canClaim, signedIn } = props;

	if (!invitation) {
		return (
			<main class="rsvp">
				<Logo class="rsvp__logo" alt="Projective" />
				<EmptyState
					title={props.failed
						? "We couldn't open this invitation"
						: "This invitation is no longer active"}
					heading={1}
					description={props.failed
						? "Try again in a moment."
						: "It may have been changed or withdrawn, or the event may have ended."}
				/>
				{notice ? <p class="rsvp__said" role="status">{notice}</p> : null}
				{props.failed ? null : (
					<Press action="stop" class="rsvp__stop">
						<Button type="submit" variant="text" severity="secondary" size="sm">
							Stop these emails
						</Button>
					</Press>
				)}
			</main>
		);
	}

	const answered = invitation.response === "pending" ? null : invitation.response as GuestAnswer;

	return (
		<main class="rsvp">
			<Logo class="rsvp__logo" alt="Projective" />
			<div class="rsvp__body">
				<p class="rsvp__meta">
					{invitation.host ? `${invitation.host} invited you to` : "You're invited to"}
				</p>
				<h1 class="rsvp__title">{invitation.title}</h1>
				<p class="rsvp__when">{guestWhen(invitation)}</p>
				{invitation.location ? <p class="rsvp__meta">{invitation.location}</p> : null}

				{refusal ? <p class="rsvp__refusal" role="alert">{refusal}</p> : null}
				{notice ? <p class="rsvp__said" role="status">{notice}</p> : null}

				<section class="rsvp__answer" aria-label="Your answer">
					{answered ? <p class="rsvp__said">{GUEST_ANSWER_SAID[answered]}.</p> : null}
					<Press action="answer" class="rsvp__answers">
						{RSVP_ACTIONS.map((a) => (
							<Button
								key={a.value}
								type="submit"
								name="response"
								value={a.value}
								variant={invitation.response === a.value ? "filled" : "outlined"}
								severity={a.severity}
								aria-pressed={invitation.response === a.value ? "true" : "false"}
							>
								{a.label}
							</Button>
						))}
					</Press>
				</section>

				<Room invitation={invitation} joinUrl={joinUrl} />

				{canClaim
					? (
						<section class="rsvp__room" aria-label="Your Projective account">
							<p class="rsvp__meta">
								This address is on your account. Your host and the other guests will see your name.
							</p>
							<Press action="claim">
								<Button type="submit" variant="outlined" severity="secondary">
									Add to my calendar
								</Button>
							</Press>
						</section>
					)
					: null}

				<footer class="rsvp__foot">
					{signedIn ? null : (
						<a class="rsvp__link" href="/login">
							Have a Projective account? Sign in, then open this link again
						</a>
					)}
					<Press action="stop">
						<Button type="submit" variant="text" severity="secondary" size="sm">
							Stop these emails
						</Button>
					</Press>
				</footer>
			</div>
		</main>
	);
}
