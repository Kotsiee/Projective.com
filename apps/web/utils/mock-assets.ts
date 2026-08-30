/**
 * mock-assets.ts — the app-side mock asset URL builders.
 *
 * ## Why this is a deliberate mirror of `packages/backend/mocks/assets.ts`, not an import of it
 *
 * The backend module is the canonical builder for the 21 server-side fixture call sites. This file
 * cannot import it, and that is an architectural constraint rather than an oversight: root CLAUDE.md
 * §2 says islands are dumb and never reach the backend package, and two of this module's consumers —
 * `features/shell/core/nav-fixtures.ts` (imported by `UserActions.island.tsx` and
 * `BasketDrawer.island.tsx`) and `features/marketing/core/landing-data.ts` — are on island import
 * paths. Routing them through `@server/services/*` would pull the whole server service layer into a
 * client bundle.
 *
 * So the workspace boundary genuinely forbids one shared module here. What it does NOT forbid is
 * collapsing the app's own three private copies into one, which is what this file does. The two
 * modules are kept deliberately identical in behaviour and `mock-assets_test.ts` asserts that against
 * the same literal strings the backend test uses, so a change to one that is not made to the other
 * fails a test rather than drifting silently.
 *
 * This is the same trade-off the codebase already documented in `explore/fixtures.ts`, whose comment
 * read "a self-contained copy — the backend cannot import the app's marketing helper". The direction
 * of that sentence is now reversed and the number of copies is two rather than four.
 */

const UNSPLASH_HOST = "https://images.unsplash.com";

/** Normalise an Unsplash slug to its canonical `photo-…` form. Idempotent. */
export function photoSlug(id: string): string {
	return id.startsWith("photo-") ? id : `photo-${id}`;
}

/**
 * A square face crop — the shared avatar convention (`DESIGN_SYSTEM.md` §C.4).
 * Mirrors `mockAvatar` in `packages/backend/mocks/assets.ts`.
 */
export function mockAvatar(id: string, size = 96, q = 80): string {
	return `${UNSPLASH_HOST}/${
		photoSlug(id)
	}?auto=format&fit=facearea&facepad=3&w=${size}&h=${size}&q=${q}`;
}

/**
 * A landscape crop for a cover, banner or thumbnail.
 * Mirrors `mockCover` in `packages/backend/mocks/assets.ts`.
 */
export function mockCover(id: string, w: number, h?: number, q = 80): string {
	const height = h === undefined ? "" : `&h=${h}`;
	return `${UNSPLASH_HOST}/${photoSlug(id)}?auto=format&fit=crop&w=${w}${height}&q=${q}`;
}

/**
 * The stub Google-OAuth profile picture.
 *
 * Kept as its own constant rather than expressed through {@link mockAvatar} because its query string
 * genuinely differs — no `auto=format`, no `q`, and a `crop=faces` directive — and rewriting it into
 * the common shape would change the bytes fetched for the one asset whose job is to look like it came
 * from Google rather than from this corpus.
 */
export const MOCK_OAUTH_AVATAR =
	`${UNSPLASH_HOST}/photo-1544005313-94ddf0286df2?w=128&h=128&fit=crop&crop=faces`;

/**
 * Sample media offered in the catalogue listing editor's "use a sample image" affordance.
 *
 * These are seed content for a WRITE surface, not decoration: a seller who picks one is choosing the
 * cover their listing ships with, so the set lives here beside the rest of the mock corpus rather
 * than inline in the island, where it read as layout.
 */
export const MOCK_SAMPLE_MEDIA: readonly string[] = [
	mockCover("photo-1618005182384-a83a8bd57fbe", 800, 600, 72),
	mockCover("photo-1545235617-9465d2a55698", 800, 600, 72),
	mockCover("photo-1467232004584-a241de8bcf5d", 800, 600, 72),
];
