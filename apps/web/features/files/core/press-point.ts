/**
 * press-point — where the pointer last pressed, so a form a menu row opens appears where the reader
 * clicked rather than at the footer rig (Decision #407). A menu row's `command` receives no event, so
 * the press is recorded once, on `document`, and read back by the command that runs straight after it.
 * A keyboard activation finds no fresh press and the form keeps its rig anchor.
 */

/** A viewport point, CSS px. */
export interface PressPoint {
	x: number;
	y: number;
}

/** A recorded press: where, and when on the event clock. */
export interface Press extends PressPoint {
	at: number;
}

/** How long after a press a command still counts as the press's. */
export const PRESS_WINDOW_MS = 1500;

let last: Press | null = null;

/** The press, when it is recent enough to be the one that ran the command. */
export function freshPress(
	press: Press | null,
	now: number,
	maxAge: number = PRESS_WINDOW_MS,
): PressPoint | null {
	if (!press || now - press.at > maxAge || now < press.at) return null;
	return { x: press.x, y: press.y };
}

/** Remember a press (`usePressTracking` records every one on the page). */
export function recordPress(press: Press): void {
	last = press;
}

/** Where the pointer just pressed, or `null` for a keyboard activation. */
export function recentPress(): PressPoint | null {
	return freshPress(last, performance.now());
}
