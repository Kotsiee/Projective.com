import { useSignalEffect } from "@preact/signals";
import type { ModuleCommit } from "../core/header-model.ts";
import { moduleCommit } from "../core/workspace-state.ts";

/**
 * useModuleCommit — how a module's island hands the header band its ONE filled action (Teams L2).
 *
 * The band is a separate hydration root, so the module publishes its commit through `workspace-state`
 * instead of rendering a button of its own: `compute` returns the commit for the module's current
 * state (or `null` for none), is re-run whenever a signal it reads changes, and the slot is cleared
 * when the module unmounts, so a commit never outlives the screen that owns it.
 *
 * The commit's tier is a filled tier (§B.8.1): 1 only for money movement, 2 for structural creation,
 * 3 for a workflow commit. Everything else belongs in the band's kebab or the footer rig.
 */
export function useModuleCommit(compute: () => ModuleCommit | null): void {
	useSignalEffect(() => {
		moduleCommit.value = compute();
		return () => {
			moduleCommit.value = null;
		};
	});
}
