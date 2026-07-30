import type { JSX } from "preact";
import { Button } from "@projective/ui/fields";
import { kindCopy, type WorkspaceKind } from "@projective/types/workspace";
import { CheckGlyph, cloneGlyph, MembersGlyph, PlusGlyph } from "../core/workspace-glyphs.tsx";

/**
 * RosterEmpty — the first-run state of `/teams` and `/businesses`.
 *
 * Every other block on this surface reports. This one has to **sell**, because a person with no team has
 * no idea what one would do for them, and "No teams yet." answers a question they never asked. So the
 * pitch comes from the SSOT's own per-kind copy ({@link kindCopy}) — the same words the marketing surface
 * uses, never a second paraphrase that can drift — followed by three concrete consequences and exactly
 * ONE primary action.
 *
 * It is left-aligned, in the band's rhythm, with no centred illustration: the layout the reader is about
 * to live in is what teaches them the shape of the surface, and a cartoon in the middle of the screen
 * teaches them nothing.
 *
 * When creation is metered off, the button is still rendered — disabled, with the server's own reason
 * beneath it. Hiding the only action on an otherwise empty screen strands the reader with no explanation
 * and nothing to do.
 */

// #region Selling points
/**
 * The three consequences per kind.
 *
 * Deliberately phrased as what the entity DOES for the reader, and deliberately jargon-free: "money is
 * held safely until work is approved", never "escrow" (the ELI5 rule the public surfaces already follow).
 */
const POINTS: Record<WorkspaceKind, readonly string[]> = {
	team: [
		"One shared profile, one reputation — your work counts for all of you.",
		"Listings and projects belong to the team, not to whoever happened to post them.",
		"When a payout lands it splits automatically, by shares you agree up front.",
	],
	business: [
		"One company identity your whole staff hires under.",
		"Several people can add money to a shared pot and spend from it.",
		"You set who may spend, how much, and what needs a second pair of eyes.",
	],
};
// #endregion

// #region Props
export interface RosterEmptyProps {
	kind: WorkspaceKind;
	/** Whether the viewer may create another entity of this kind (plan metering, resolved server-side). */
	canCreate: boolean;
	/** The server's reason when they may not — rendered verbatim. */
	blockedReason: string | null;
	/** Open the Draft-First create modal. */
	onCreate: () => void;
}
// #endregion

export function RosterEmpty(props: RosterEmptyProps): JSX.Element {
	const { kind, canCreate, blockedReason, onCreate } = props;
	const copy = kindCopy(kind);

	return (
		<div class="wsp-empty" data-kind={kind}>
			<span class="wsp-empty__glyph" aria-hidden="true">
				{cloneGlyph(MembersGlyph)}
			</span>

			<div>
				<h2 class="wsp-empty__title">
					{kind === "team" ? "Work as a team" : "Hire as a company"}
				</h2>
				<p class="wsp-empty__pitch">{copy.pitch}</p>
			</div>

			<ul class="wsp-empty__points">
				{POINTS[kind].map((point) => (
					<li class="wsp-empty__point" key={point}>
						<span class="wsp-empty__point-glyph" aria-hidden="true">
							{cloneGlyph(CheckGlyph)}
						</span>
						{point}
					</li>
				))}
			</ul>

			<div class="wsp-empty__actions">
				<Button
					variant="filled"
					severity="primary"
					label={`Create a ${copy.noun}`}
					icon={cloneGlyph(PlusGlyph)}
					disabled={!canCreate}
					onClick={onCreate}
				/>
			</div>

			<p class="wsp-empty__hint">
				{!canCreate && blockedReason
					? blockedReason
					: `A name is all it takes to start. Nothing is public until you publish it, and a ${copy.noun} you are done with is archived rather than deleted.`}
			</p>
		</div>
	);
}

// #region In-band blank
/**
 * RosterBlank — the *filtered-to-nothing* state, which is a completely different thing from the first-run
 * state above and must not borrow its pitch.
 *
 * Somebody who has just typed a search term does not need to be told what a team is; they need to know
 * their filter matched nothing and how to get back. Selling to them would read as the interface failing to
 * understand what it was asked.
 */
export interface RosterBlankProps {
	text: string;
	hint?: string;
}

export function RosterBlank({ text, hint }: RosterBlankProps): JSX.Element {
	return (
		<div class="wsp-blank" role="status">
			<p class="wsp-blank__text">{text}</p>
			{hint && <p class="wsp-blank__hint">{hint}</p>}
		</div>
	);
}
// #endregion
