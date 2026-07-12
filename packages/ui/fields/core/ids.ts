/**
 * SSR-safe id generation. Preact has no `useId` in older cores and Fresh renders on the server then
 * hydrates — ids must be stable across both. We derive a deterministic-per-render counter that is
 * reset per module load; components combine it with a semantic prefix. A caller-supplied `id` always
 * wins so consumers can wire their own label/aria relationships.
 */

let seq = 0;

/** Next monotonic suffix. Not cryptographic — only needs to be unique within a document. */
export function nextId(prefix = "ui"): string {
	seq += 1;
	return `${prefix}-${seq}`;
}

/** Resolve a caller id or mint a new one under `prefix`. */
export function resolveId(id: string | undefined, prefix: string): string {
	return id ?? nextId(prefix);
}

/** Build the conventional sub-ids (label/hint/error) for a field root id. */
export function fieldIds(rootId: string): { label: string; hint: string; error: string } {
	return { label: `${rootId}-label`, hint: `${rootId}-hint`, error: `${rootId}-error` };
}

/** Join describedby ids, dropping falsy ones; returns undefined when empty. */
export function describedBy(...ids: Array<string | false | null | undefined>): string | undefined {
	const joined = ids.filter(Boolean).join(" ");
	return joined || undefined;
}
