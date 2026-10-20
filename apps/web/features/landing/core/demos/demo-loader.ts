/**
 * demo-loader — how a landing surface imports a demo's chunk (`flows/LANDING.md` §4.4, §7; work
 * orders L3 and L5). Each demo module is imported at most once at a time and kept once it arrives;
 * every caller of an id waits on the same import, so each can attach its own failure handling; an
 * import that fails is forgotten, so the next request tries again.
 *
 * Shared by the demo stage (`DemoHost`) and `/features`' "Try it" dialog (`FeatureDemoDialog`) over
 * the one loader map (`components/demos/demo-modules.ts`). Pure (no DOM, no import of its own), so
 * the contract is unit-tested.
 */

// #region Loader
/** Imports one module, as a dynamic `import()` does. */
export type ModuleImport<T> = () => Promise<T>;

/** A loader over a fixed set of module imports, keyed by id. */
export interface ModuleLoader<Id extends string, T> {
	/**
	 * The module for `id`: the one already imported, else the import in flight, else a new import.
	 * Every caller gets the same promise until it settles, so a press made while a warm-up import is
	 * still in flight is told when that import fails. A failed import is forgotten.
	 */
	load(id: Id): Promise<T>;
	/** The module for `id` once its import has resolved, else `undefined`. */
	loaded(id: Id): T | undefined;
}

/**
 * A {@link ModuleLoader} over `imports`.
 *
 * @param imports Each id's dynamic import, called only when that id is first requested.
 */
export function createModuleLoader<Id extends string, T>(
	imports: Readonly<Record<Id, ModuleImport<T>>>,
): ModuleLoader<Id, T> {
	const done = new Map<Id, T>();
	const pending = new Map<Id, Promise<T>>();
	return {
		load(id) {
			if (done.has(id)) return Promise.resolve(done.get(id)!);
			const inFlight = pending.get(id);
			if (inFlight) return inFlight;
			const next = imports[id]().then(
				(module) => {
					done.set(id, module);
					pending.delete(id);
					return module;
				},
				(error: unknown) => {
					pending.delete(id);
					throw error;
				},
			);
			pending.set(id, next);
			return next;
		},
		loaded: (id) => done.get(id),
	};
}
// #endregion
