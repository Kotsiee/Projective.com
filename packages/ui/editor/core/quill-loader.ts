/**
 * `quill-loader` — the one place Quill is fetched, and the earliest moment it can be.
 *
 * Quill cannot be imported statically: it touches `document` during module evaluation, so it has to
 * stay behind a dynamic import that only ever runs in a browser (see
 * {@link ./quill-runtime.ts | `quill-runtime`}). That constraint is not negotiable, but WHEN the
 * dynamic import fires is, and it used to fire in the editor's mount effect — the latest possible
 * instant. Fresh boots a page by having one inline module script statically import every island on
 * it, so the browser resolves that whole graph before `boot()` runs; a fetch started inside an effect
 * therefore begins only after every island chunk has downloaded AND executed, and the editor is a
 * dead box for a whole round trip that nothing was overlapping.
 *
 * {@link warmQuill} moves it to the editor's first RENDER instead. That is early enough to overlap
 * the rest of hydration and late enough to cost nothing on a page that never draws an editor — which
 * matters more than it looks, because eleven island entries statically import this component
 * (`ProjectBoard` and `CheckoutBasketScreen` among them) and most of them render no editor at all.
 * Warming from module scope would have made all eleven pay for it. Warming from render means the
 * pages that need Quill start fetching it before hydration reaches the effect, and the pages that do
 * not never ask.
 *
 * The promise is memoised, so several editors on one surface — the project setup form has two, the
 * ticket modal more — share a single import and a single registration pass rather than racing to do
 * the same work N times.
 */

/** The module namespace of the hand-assembled runtime; the source of every type below. */
type QuillModule = typeof import("./quill-runtime.ts");

/** The `Quill` class itself, with this editor's formats and toolbar module already registered. */
export type QuillConstructor = QuillModule["default"];

/** A live editor instance. */
export type QuillInstance = InstanceType<QuillConstructor>;

let pending: Promise<QuillConstructor> | null = null;
let resolved: QuillConstructor | null = null;

/**
 * Fetch (or re-use) the configured Quill class.
 *
 * A failed import clears the memo, so a transient network failure can be retried by the next editor
 * to mount instead of poisoning the page for the rest of the session.
 */
export function loadQuill(): Promise<QuillConstructor> {
	pending ??= import("./quill-runtime.ts")
		.then((mod) => {
			resolved = mod.default;
			return resolved;
		})
		.catch((error: unknown) => {
			pending = null;
			throw error;
		});
	return pending;
}

/**
 * The class if it is ALREADY here, otherwise `null` — never a fetch.
 *
 * Lets an editor that mounts after the first one construct itself synchronously, with no `await` and
 * so no window in which its container is on screen and empty.
 */
export function loadedQuill(): QuillConstructor | null {
	return resolved;
}

/**
 * Start the fetch without waiting for it. A no-op on the server, and idempotent.
 *
 * Deliberately swallows the rejection: this is a head start, not the load-bearing call. The mount
 * effect awaits {@link loadQuill} for real and is where a failure has to surface — an unhandled
 * rejection from a speculative warm-up would report the same error twice, once with no context.
 */
export function warmQuill(): void {
	if (typeof document === "undefined" || resolved) return;
	loadQuill().catch(() => {});
}
