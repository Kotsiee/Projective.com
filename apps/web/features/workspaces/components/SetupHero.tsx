import type { JSX } from "preact";
import { MetaLine } from "@projective/ui/display";
import { InlineNotice, ProgressRing } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import type { HeroAction, HeroStep, SetupHeroModel } from "../core/overview-model.ts";
import { CheckGlyph, cloneGlyph, CloseGlyph } from "../core/workspace-glyphs.tsx";

/**
 * SetupHero — the Overview's "Get <entity> ready" band while setup is unfinished.
 *
 * A full-width band of steps, not a checklist box: the heading, the ring and its "3 of 5 done" on one
 * side, the steps as ONE ordered line joined by hairline connectors on the other. Each step says
 * done or not by its mark AND its words ("Done", or what doing it gets them), so the ring's sweep and
 * the tick are never the only channels.
 *
 * Every rule about which control a step carries — the band's single fill, the tier it takes, the
 * steps a viewer may not act on showing none — is decided in `core/overview-model.ts` and unit-tested
 * there; this component only draws the {@link HeroAction} it is handed. The steps are a plain `<ol>`,
 * not the interactive `Steps` navigation: a step here is a fact, and only its action is a control.
 */

// #region Props
export interface SetupHeroProps {
	hero: SetupHeroModel;
	/** The id the band's `aria-labelledby` points at. */
	titleId: string;
	/** Open the invite modal (Invite member). */
	onInvite: () => void;
	/** Publish the entity (draft → active). */
	onPublish: () => void;
	/** A publish is in flight. */
	publishing: boolean;
	/** Why the last publish was refused, in the server's words. */
	publishError: string | null;
	/** Hide the band for this viewer. */
	onDismiss: () => void;
}
// #endregion

// #region Step control
/** One step's control, at the tier the model chose. */
function StepAction(
	{ action, props }: { action: HeroAction; props: SetupHeroProps },
): JSX.Element {
	if (action.kind === "invite") {
		return action.filled
			? <Button structural size="sm" label={action.label} onClick={props.onInvite} />
			: (
				<Button
					severity="neutral"
					variant="outlined"
					size="sm"
					label={action.label}
					onClick={props.onInvite}
				/>
			);
	}
	if (action.kind === "publish") {
		return (
			<Button
				size="sm"
				label={props.publishing ? "Publishing…" : action.label}
				loading={props.publishing}
				onClick={props.onPublish}
			/>
		);
	}
	// A destination is an anchor, wearing the Button tier it was given (`wsp-hero__link` drops the
	// link underline no Button draws).
	const tone = action.filled
		? "ui-button--primary ui-button--filled"
		: "ui-button--neutral ui-button--outlined";
	return (
		<a class={`ui-button ${tone} ui-button--size-sm wsp-hero__link`} href={action.href}>
			<span class="ui-button__label">{action.label}</span>
		</a>
	);
}
// #endregion

// #region Step
function Step(
	{ step, index, last, props }: {
		step: HeroStep;
		index: number;
		last: boolean;
		props: SetupHeroProps;
	},
): JSX.Element {
	return (
		<li
			class="wsp-hero__step"
			data-done={step.done ? "true" : "false"}
			data-current={step.current ? "true" : undefined}
			aria-current={step.current ? "step" : undefined}
		>
			<span class="wsp-hero__track" aria-hidden="true">
				<span class="wsp-hero__mark">{step.done ? cloneGlyph(CheckGlyph) : index + 1}</span>
				{!last && <span class="wsp-hero__rule" />}
			</span>
			<span class="wsp-hero__label">{step.label}</span>
			<span class="wsp-hero__note">
				{step.note}
				{!step.done && <span class="ui-visually-hidden">Not done yet.</span>}
			</span>
			{step.action && (
				<span class="wsp-hero__action">
					<StepAction action={step.action} props={props} />
				</span>
			)}
		</li>
	);
}
// #endregion

// #region Component
/** The band's content; the island owns the band, its state and the writes. */
export function SetupHero(props: SetupHeroProps): JSX.Element {
	const { hero } = props;
	return (
		<div class="wsp-hero">
			<div class="wsp-hero__head">
				<ProgressRing
					class="wsp-hero__ring"
					value={hero.percent}
					size={48}
					strokeWidth={4}
					aria-label={`Setup: ${hero.progress}`}
				/>
				<div class="wsp-hero__heading">
					<h2 class="wsp-hero__title" id={props.titleId}>{hero.title}</h2>
					<MetaLine items={[{ text: hero.progress, tabular: true }]} />
				</div>
				<Button
					class="wsp-hero__dismiss"
					iconOnly
					variant="text"
					severity="secondary"
					size="sm"
					icon={cloneGlyph(CloseGlyph)}
					aria-label="Hide the setup steps"
					onClick={props.onDismiss}
				/>
			</div>

			<ol class="wsp-hero__steps">
				{hero.steps.map((step, i) => (
					<Step
						key={step.id}
						step={step}
						index={i}
						last={i === hero.steps.length - 1}
						props={props}
					/>
				))}
			</ol>

			{props.publishError && (
				<InlineNotice class="wsp-hero__error" align="start" assertive text={props.publishError} />
			)}
		</div>
	);
}
// #endregion
