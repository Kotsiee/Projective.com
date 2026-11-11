import type { ReadonlySignal } from "@preact/signals";

/**
 * Whether a bound signal accepts writes.
 *
 * A `computed()` passes `instanceof Signal` but defines `value` with a getter only, so assigning it
 * throws. A control bound to one is controlled by derivation: its owner changes the source, and the
 * control only reports the change it wants through its change callback.
 */
export function isWritableSignal(sig: ReadonlySignal<unknown>): boolean {
	for (let proto: object | null = sig; proto; proto = Object.getPrototypeOf(proto)) {
		const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
		if (descriptor) return typeof descriptor.set === "function" || descriptor.writable === true;
	}
	return false;
}
