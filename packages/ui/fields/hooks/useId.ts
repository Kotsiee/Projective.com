/**
 * `useId` — a render-stable id for a control instance, SSR-safe. Wraps {@link resolveId} in a memo so
 * the id is minted once per mount and a caller-supplied `id` always wins.
 */
import { useMemo } from "preact/hooks";
import { resolveId } from "../core/ids.ts";

export function useId(id: string | undefined, prefix: string): string {
	return useMemo(() => resolveId(id, prefix), [id]);
}
