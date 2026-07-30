import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import {
	kindCopy,
	workspaceHref,
	type WorkspaceKind,
	type WorkspaceRoster,
} from "@projective/types/workspace";
import { useContextSwitch } from "../core/useContextSwitch.ts";
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
 * The multi-step sequence (switch → re-mint the token → hard navigation) belongs to
 * {@link useContextSwitch}; this component's whole job is to state the current truth and to stay
 * honest while that sequence is in flight.
 *
 * ## Why the transition state replaces the control instead of covering it
 * A switch is a full document load and takes real time. A spinner *over* a control that still reads
 * "Switch to this team" would be a UI insisting on the old context while the session has already
 * moved — and on a surface where the acting identity decides who gets paid, that is the most
 * expensive kind of lie available. So while `switching` is true the control renders **the destination
 * instead of the origin** ("Switching to Northwind…"), disabled and `aria-busy`, inside an
 * `aria-live` region. There is no interactive affordance during the switch, so a second click cannot
 * race the navigation (the hook refuses re-entry too — belt and braces).
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
	/** The entity's id. */
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
	 * `block` — the expanded lane's prominent control. `icon` — the collapsed rail's square, which
	 * carries the same two states as a portal-tooltipped glyph.
	 */
	variant?: "block" | "icon";
}
// #endregion

// #region Component
/** The acting-context switch. See the module header for the transition and failure contracts. */
export function ContextSwitchControl(props: ContextSwitchControlProps): JSX.Element {
	const { switching, error, switchTo, exitToPersonal } = useContextSwitch();
	const copy = kindCopy(props.kind);
	const busy = switching.value;
	const icon = props.variant === "icon";

	const enter = () =>
		switchTo(props.kind, props.id, {
			destination: props.destination ?? workspaceHref(props.kind, props.id),
			handle: props.handle,
		});

	// No destination: exiting leaves the viewer exactly where they are — they are still a member, only
	// their attribution changed, so relocating them would be a non-sequitur.
	const exit = () => exitToPersonal();

	const busyLabel = `Switching to ${props.name}…`;
	const enterLabel = `Switch to this ${copy.noun}`;
	const actingLabel = `You're acting as this ${copy.noun}`;

	if (icon) {
		const label = busy ? busyLabel : props.acting ? `${actingLabel} · Exit` : enterLabel;
		return (
			<span class="wsp-ctxswitch wsp-ctxswitch--icon" data-kind={props.kind} aria-live="polite">
				<Tooltip content={label} placement="right">
					<button
						type="button"
						class="wsp-ctxswitch__btn"
						data-acting={props.acting ? "true" : undefined}
						aria-label={label}
						aria-busy={busy ? "true" : undefined}
						disabled={busy}
						onClick={props.acting ? exit : enter}
					>
						<span class="wsp-ctxswitch__glyph" aria-hidden="true">
							{cloneGlyph(props.acting ? ExitGlyph : SwitchGlyph)}
						</span>
					</button>
				</Tooltip>
				{error.value && <span class="wsp-sr" role="alert">{error.value}</span>}
			</span>
		);
	}

	return (
		<div class="wsp-ctxswitch" data-kind={props.kind} aria-live="polite">
			{busy
				? (
					// The destination, not the origin: the label must never still claim the old context.
					<button type="button" class="wsp-ctxswitch__btn" aria-busy="true" disabled>
						<span class="wsp-ctxswitch__glyph" aria-hidden="true">{cloneGlyph(SwitchGlyph)}</span>
						<span class="wsp-ctxswitch__label">{busyLabel}</span>
					</button>
				)
				: props.acting
				? (
					<div class="wsp-ctxswitch__state">
						<span class="wsp-actingchip">
							<span class="wsp-actingchip__dot" aria-hidden="true" />
							Acting
						</span>
						<span class="wsp-ctxswitch__state-text wsp-trunc">{actingLabel}</span>
						<button
							type="button"
							class="wsp-ctxswitch__exit"
							aria-label={`Stop acting as ${props.name}`}
							onClick={exit}
						>
							<span class="wsp-ctxswitch__glyph" aria-hidden="true">{cloneGlyph(ExitGlyph)}</span>
							Exit
						</button>
					</div>
				)
				: (
					<button type="button" class="wsp-ctxswitch__btn" onClick={enter}>
						<span class="wsp-ctxswitch__glyph" aria-hidden="true">{cloneGlyph(SwitchGlyph)}</span>
						<span class="wsp-ctxswitch__label">{enterLabel}</span>
					</button>
				)}
			{error.value && <p class="wsp-ctxswitch__error" role="alert">{error.value}</p>}
		</div>
	);
}
// #endregion
