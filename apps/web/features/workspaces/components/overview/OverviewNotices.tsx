import type { JSX, RefObject } from "preact";
import { InlineNotice } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";

/** Props for {@link ProposeNoticeBand}. */
export interface ProposeNoticeBandProps {
	i: number;
	/** Standing in for the dismissed hero: hidden until the stack carries the dismissal mark. */
	standIn: boolean;
	/** The viewer may invite, so the notice offers Invite member. */
	canInvite: boolean;
	onInvite: () => void;
}

/** The two-member rule, off the hero: a team needs two members to send proposals. */
export function ProposeNoticeBand(props: ProposeNoticeBandProps): JSX.Element {
	return (
		<section
			class="wsp-band wsp-band--plain wsp-band--notice"
			data-i={props.i}
			data-hero-standin={props.standIn ? "" : undefined}
			aria-label="Proposals"
		>
			<div class="wsp-band__inner">
				<InlineNotice
					align="start"
					text="Teams need two members to send proposals."
					actionLabel={props.canInvite ? "Invite member" : undefined}
					onAction={props.canInvite ? props.onInvite : undefined}
				/>
			</div>
		</section>
	);
}

/** Props for {@link DraftNoticeBand}. */
export interface DraftNoticeBandProps {
	i: number;
	standIn: boolean;
	/** The band, so a Publish that removes it can move focus past it. */
	bandRef: RefObject<HTMLElement>;
	name: string;
	/** The fact, then its one-way consequence or whom to ask. */
	text: string;
	canPublish: boolean;
	publishing: boolean;
	publishError: string | null;
	onPublish: () => void;
}

/**
 * A draft business's not-active fact, off the hero. Beside a Publish for the viewer who may publish —
 * a tier-3 primary, the view's one fill while no hero shows Publish — and the one-way consequence
 * stated in the sentence; for anyone else, whom to ask (Decision #248).
 */
export function DraftNoticeBand(props: DraftNoticeBandProps): JSX.Element {
	return (
		<section
			ref={props.bandRef}
			class="wsp-band wsp-band--plain wsp-band--notice"
			data-i={props.i}
			data-hero-standin={props.standIn ? "" : undefined}
			aria-label={`${props.name} status`}
		>
			<div class="wsp-band__inner">
				<div class="wsp-draft">
					<InlineNotice class="wsp-draft__notice" align="start" text={props.text} />
					{props.canPublish && (
						<Button
							class="wsp-draft__publish"
							size="sm"
							label={props.publishing ? "Publishing…" : "Publish"}
							loading={props.publishing}
							onClick={props.onPublish}
						/>
					)}
				</div>
				{props.publishError && <InlineNotice align="start" assertive text={props.publishError} />}
			</div>
		</section>
	);
}
