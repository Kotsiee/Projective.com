import { type ReadonlySignal, signal } from "@preact/signals";
import type { ComponentType } from "preact";
import { logger } from "./logger.ts";

/** A component fetched in its own chunk the first time it is asked for. */
export interface LazyComponent<P> {
	/** The component once it has arrived; `null` before, and after a failed fetch. */
	readonly component: ReadonlySignal<ComponentType<P> | null>;
	/**
	 * Fetch it (once — the promise is shared) and resolve to it, or to `null` when the chunk could not
	 * be fetched. A failure is logged and forgets the promise, so the next call retries.
	 */
	load(): Promise<ComponentType<P> | null>;
}

/**
 * Wrap a dynamic `import()` of a heavy component so a host island ships only this handle: call
 * `load()` on intent (hover, focus) or on open, and render `component.value` once it is set. A host
 * must decide what a `null` from `load()` means for its reader — a surface that cannot open has to
 * say so or go somewhere that can.
 */
export function lazyComponent<P>(
	name: string,
	importer: () => Promise<ComponentType<P>>,
): LazyComponent<P> {
	const component = signal<ComponentType<P> | null>(null);
	let pending: Promise<ComponentType<P> | null> | null = null;
	return {
		component,
		load() {
			pending ??= importer().then(
				(loaded) => {
					component.value = loaded;
					return loaded;
				},
				(error: unknown) => {
					pending = null;
					logger.error(`Could not load ${name}`, error);
					return null;
				},
			);
			return pending;
		},
	};
}
