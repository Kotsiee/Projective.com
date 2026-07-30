import type { JSX } from "preact";
import { styleVars } from "@ui/core/style.ts";
import { Button } from "@projective/ui/fields";
import {
	kindCopy,
	setupProgress,
	type SetupStep,
	type WorkspaceKind,
} from "@projective/types/workspace";
import { CheckGlyph, ChevronGlyph, cloneGlyph } from "../core/workspace-glyphs.tsx";
import { useContextSwitch } from "../core/useContextSwitch.ts";

/**
 * SetupChecklist — the Draft-First "finish setting up" block.
 *
 * ## Why the entity already works
 *
 * A team or a business is created from a name and a handle alone. It is immediately real: it has a
 * console, a roster, a wallet and a public page. So this list is not a gate and must never read like one
 * — every row states **what doing it gets you**, which is why the note beside each step comes from the
 * server (`SetupStep.note`) rather than being composed here: the backend knows which check is genuinely
 * outstanding and what unblocking it unlocks.
 *
 * ## It removes itself
 *
 * At 100% the block returns `null`. Not a congratulatory state, not a collapsed summary — gone. A
 * completed checklist that lingers is a permanent reminder of work already done, and it steals the top of
 * the console from the entity's actual activity. It is also dismissible before completion, because a
 * person who has decided to skip the logo for now should not be asked about it on every visit.
 *
 * ## Why the acting switch lives here
 *
 * The final row of a setup list is not another setting — it is the moment the session starts *speaking
 * as* the entity. Everything above configures the thing; this starts using it. It runs through the shared
 * {@link useContextSwitch}, so it behaves identically to the header account popover's switcher: switch →
 * re-mint the token → hard navigation. The trigger renders `switching` honestly (disabled + `aria-busy`)
 * and a failure is reported in place rather than navigated past, because a switch that half-completed
 * would leave the chrome insisting on one identity while permissions enforce another.
 */

// #region Props
export interface SetupChecklistProps {
	/** The entity kind — decides the nouns and the acting-switch context type. */
	kind: WorkspaceKind;
	/** The entity's id, for the context switch. */
	workspaceId: string;
	/** The entity's display name, so the acting button names what the session is about to become. */
	name: string;
	/** The entity's `@handle`, cached as a chrome hint by the switch. */
	handle: string;
	/** The server's step list. Order is the server's; nothing is re-sorted here. */
	steps: readonly SetupStep[];
	/** Whether the session is already acting as this entity — hides the acting switch when it is. */
	isActing: boolean;
	/** Where to land after a switch. Defaults to staying put, which re-renders this console as the entity. */
	destination?: string;
	/** Dismissal is owned by the caller so the surrounding console can react to it (see the island). */
	onDismiss: () => void;
	/** Stack index, driving the band's staggered entrance. */
	index?: number;
}
// #endregion

// #region Component
/**
 * The checklist. Returns `null` once every step is done, so the caller can render it unconditionally and
 * let completion remove the band.
 */
export function SetupChecklist(props: SetupChecklistProps): JSX.Element | null {
	const { kind, steps, isActing, name, handle, workspaceId } = props;
	const copy = kindCopy(kind);
	const { switching, error, switchTo } = useContextSwitch();

	const done = steps.filter((s) => s.done).length;
	const total = steps.length;
	const progress = setupProgress(steps);
	if (total === 0 || progress >= 1) return null;

	const act = () => {
		void switchTo(kind, workspaceId, { destination: props.destination, handle });
	};

	return (
		<div class="wsp-checklist">
			<div class="wsp-checklist__head">
				{
					/*
					 * The ring's sweep encodes how much is done, so it is neither transitioned nor keyframed
					 * (root CLAUDE.md §11). The count in its hole states the same fact in text, so the sweep is
					 * never the only channel carrying it.
					 */
				}
				<div class="wsp-checklist__ringwrap">
					<span
						class="wsp-checklist__ring"
						style={styleVars({ "--wsp-progress": progress })}
						aria-hidden="true"
					/>
					<span class="wsp-checklist__ring-text wsp-num">{done}/{total}</span>
				</div>
				<div class="wsp-checklist__heading">
					<h2 class="wsp-checklist__title">Finish setting up</h2>
					<p class="wsp-checklist__note">
						{copy.Noun} is live and usable already — these are the things that make it work harder.
					</p>
				</div>
				<button
					type="button"
					class="wsp-checklist__dismiss"
					onClick={props.onDismiss}
					aria-label="Hide the setup checklist"
				>
					<DismissGlyph />
				</button>
			</div>

			<ul class="wsp-checklist__items">
				{steps.map((step) => <StepRow key={step.id} step={step} />)}
			</ul>

			{!isActing && (
				<div class="wsp-checklist__act">
					<Button
						variant="filled"
						size="sm"
						onClick={act}
						disabled={switching.value}
						loading={switching.value}
						aria-busy={switching.value ? "true" : undefined}
					>
						{switching.value ? "Switching…" : `Start acting as ${name}`}
					</Button>
					<p
						class="wsp-checklist__acthint"
						data-tone={error.value ? "alert" : undefined}
						role={error.value ? "alert" : undefined}
					>
						{error.value ??
							`Everything you do next — listings, hires, messages — is attributed to the ${copy.noun} ` +
								"rather than to you personally."}
					</p>
				</div>
			)}
		</div>
	);
}
// #endregion

// #region Step row
/**
 * One step.
 *
 * `SetupStep.href` may be `""` for a step with no destination yet. That row renders as plain content
 * rather than a broken link — an anchor to nowhere is worse than a line of text, because it invites a
 * click that does nothing and teaches the reader that the surface is unreliable.
 */
function StepRow({ step }: { step: SetupStep }): JSX.Element {
	const body = (
		<>
			<span class="wsp-checklist__check" aria-hidden="true">
				{step.done ? cloneGlyph(CheckGlyph) : null}
			</span>
			<span class="wsp-checklist__body">
				<span class="wsp-checklist__label">{step.label}</span>
				<span class="wsp-checklist__itemnote">{step.note}</span>
			</span>
			{step.href && <span class="wsp-checklist__go wsp-icon--dir">{cloneGlyph(ChevronGlyph)}</span>}
		</>
	);

	return (
		<li class="wsp-checklist__item" data-done={step.done ? "true" : "false"}>
			{step.href
				? (
					<a class="wsp-checklist__link" href={step.href}>
						{body}
						<span class="wsp-sr">{step.done ? "Done." : "Not done yet."}</span>
					</a>
				)
				: (
					<div class="wsp-checklist__link">
						{body}
						<span class="wsp-sr">{step.done ? "Done." : "Not done yet."}</span>
					</div>
				)}
		</li>
	);
}
// #endregion

// #region Dismiss glyph
/**
 * The dismiss cross.
 *
 * Local rather than in the shared register for the same reason the padlock is: the register is a
 * navigation vocabulary, and a cross is a control's affordance, not a destination.
 */
function DismissGlyph(): JSX.Element {
	return (
		<svg
			viewBox="0 0 24 24"
			width="1em"
			height="1em"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			aria-hidden="true"
			focusable="false"
		>
			<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
		</svg>
	);
}
// #endregion
