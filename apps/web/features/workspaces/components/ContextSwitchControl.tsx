import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import {
	workspaceHref,
	type WorkspaceKind,
	type WorkspaceRoster,
} from "@projective/types/workspace";
import { useContextSwitch } from "../core/useContextSwitch.ts";
import { contextSwitchCopy } from "../core/lane-model.ts";
import { cloneGlyph, ExitGlyph, SwitchGlyph } from "../core/workspace-glyphs.tsx";

/**
 * ContextSwitchControl — the one control that changes **who the session is acting as**, and the one
 * place the acting marker is decided.
 *
 * Entering an entity's console is not the same as *acting as* it: a member can read their team's
 * console while every action they take is still attributed to them personally. Conflating the two is
 * how a shared account ends up publishing a listing under the wrong identity, so the switch is an
 * explicit, deliberate control rather than a side-effect of navigation.
 *
 * It is a **tier-4 utility** of the Button matrix (§B.8.1): `<Button severity="neutral"
 * variant="outlined">` reading "Act as team" or "Stop acting" — never a fill, because the lane's one
 * filled control is its create action, and acting is a mode rather than a commitment. Its words come
 * from {@link contextSwitchCopy}, so the lane model, the rail and this control say the same thing.
 *
 * The multi-step sequence (switch → re-mint the token → hard navigation) belongs to
 * {@link useContextSwitch}; this component's whole job is to state the current truth and to stay
 * honest while that sequence is in flight.
 *
 * ## Why the transition state replaces the label instead of covering it
 * A switch is a full document load and takes real time. A spinner beside a label that still reads
 * "Act as team" would be a UI insisting on the old context while the session has already moved — and
 * on a surface where the acting identity decides who gets paid, that is the most expensive kind of lie
 * available. So while `switching` is true the button carries **the destination instead of the origin**
 * ("Switching to Northwind…") in its `loading` state (disabled, `aria-busy`), inside an `aria-live`
 * region. A second press cannot race the navigation (the hook refuses re-entry too — belt and braces).
 *
 * ## Failure is shown, never navigated past
 * If the token could not be re-minted the hook deliberately does not navigate, and the message it
 * sets is rendered here as a live `role="alert"`. A half-switched session that silently loads the
 * next page would be wrong in a way the reader cannot see.
 */

// #region The single-acting invariant
/**
 * Resolve the ONE entity id the session is acting as, from a roster projection.
 *
 * This function exists so that "two entities cannot both show the acting marker" is a property of the
 * **model** rather than a hope about the data. Callers must never read `WorkspaceSummary.isActing`
 * directly; they compare an id against this single resolved answer via {@link isActingEntity}. Two
 * markers then cannot appear on one screen no matter what the projection says, because there is only
 * one value to match against.
 *
 * Resolution order, and why:
 *
 *   1. `roster.actingId`, when it names a listed entity — the scalar is the server's own authoritative
 *      answer and is structurally single-valued.
 *   2. Otherwise, the sole row flagged `isActing` — covers a projection whose scalar is stale but
 *      whose rows agree, which is still an unambiguous reading.
 *   3. Otherwise `null` — including the contradictory case where **several** rows claim it. Rendering
 *      nothing says "acting personally", which is coherent and safe; rendering several would assert
 *      something structurally impossible and would undermine every other marker on the surface. When
 *      the data cannot be trusted, the honest move is to withhold the claim, not to multiply it.
 */
export function resolveActingId(
	roster: Pick<WorkspaceRoster, "items" | "actingId">,
): string | null {
	const listed = roster.actingId && roster.items.some((i) => i.id === roster.actingId)
		? roster.actingId
		: null;
	if (listed) return listed;

	const flagged = roster.items.filter((i) => i.isActing);
	return flagged.length === 1 ? flagged[0].id : null;
}

/**
 * Whether an entity is THE acting one. The only sanctioned way to decide an acting marker on a list
 * — pass the id and the single value {@link resolveActingId} returned.
 */
export function isActingEntity(id: string, actingId: string | null): boolean {
	return actingId !== null && actingId === id;
}
// #endregion

// #region Props
export interface ContextSwitchControlProps {
	kind: WorkspaceKind;
	/** The entity's row id — what the session switch binds to. */
	id: string;
	/** Display name — the transition state names the DESTINATION, so this is load-bearing copy. */
	name: string;
	/** `@handle` without the `@`, cached as a chrome hint for the account popover's pre-paint. */
	handle: string;
	/**
	 * Whether the session is acting as this entity. Derive it from {@link isActingEntity} on a list, or
	 * from the single-entity `WorkspaceDetail.isActing` in a console — never from a raw per-row flag.
	 */
	acting: boolean;
	/** Where to land after switching in. Defaults to this entity's console. */
	destination?: string;
	/**
	 * `block` — a labelled Button with its error line beneath. `pill` — the console lane footer's compact
	 * rounded Button (Decision #306), its error spoken as an alert. `icon` — the collapsed rail's
	 * icon-only Button, named by its `aria-label` and a portal Tooltip (§B.6).
	 */
	variant?: "block" | "pill" | "icon";
}
// #endregion

// #region Component
/** The acting-context switch. See the module header for the transition and failure contracts. */
export function ContextSwitchControl(props: ContextSwitchControlProps): JSX.Element {
	const { switching, error, switchTo, exitToPersonal } = useContextSwitch();
	const copy = contextSwitchCopy(props.kind, props.name, props.acting);
	const busy = switching.value;

	const enter = () =>
		switchTo(props.kind, props.id, {
			destination: props.destination ?? workspaceHref(props.kind, props.handle),
			handle: props.handle,
		});

	// No destination: exiting leaves the viewer exactly where they are — they are still a member, only
	// their attribution changed, so relocating them would be a non-sequitur.
	const exit = () => exitToPersonal();
	const onClick = copy.action === "exit" ? exit : enter;
	const glyph = cloneGlyph(copy.action === "exit" ? ExitGlyph : SwitchGlyph);
	const name = busy ? copy.busyLabel : copy.ariaLabel;

	if (props.variant === "icon") {
		return (
			<span class="wsp-ctxswitch wsp-ctxswitch--icon" data-kind={props.kind} aria-live="polite">
				<Tooltip content={name} placement="right">
					<Button
						severity="neutral"
						variant="outlined"
						size="sm"
						iconOnly
						icon={glyph}
						loading={busy}
						aria-label={name}
						onClick={onClick}
					/>
				</Tooltip>
				{error.value && <span class="ui-visually-hidden" role="alert">{error.value}</span>}
			</span>
		);
	}

	if (props.variant === "pill") {
		return (
			<span class="wsp-ctxswitch wsp-ctxswitch--pill" data-kind={props.kind} aria-live="polite">
				<Button
					class="ui-hit wsp-ctxswitch__pill"
					severity="neutral"
					variant="outlined"
					size="sm"
					rounded
					icon={glyph}
					loading={busy}
					label={busy ? copy.busyLabel : copy.label}
					aria-label={name}
					onClick={onClick}
				/>
				{error.value && <span class="ui-visually-hidden" role="alert">{error.value}</span>}
			</span>
		);
	}

	return (
		<div class="wsp-ctxswitch" data-kind={props.kind} aria-live="polite">
			<Button
				severity="neutral"
				variant="outlined"
				size="sm"
				icon={glyph}
				loading={busy}
				label={busy ? copy.busyLabel : copy.label}
				aria-label={name}
				onClick={onClick}
			/>
			{error.value && <p class="wsp-ctxswitch__error" role="alert">{error.value}</p>}
		</div>
	);
}
// #endregion
