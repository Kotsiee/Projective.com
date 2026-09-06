/**
 * Coverage of the insert retry.
 *
 * Two failure modes, and the dangerous one is not the obvious one. Not retrying a real collision costs
 * a user a refused create roughly once in a very long while — annoying, and self-evident when it
 * happens. Retrying the WRONG error is worse and silent: a duplicate primary key, or any other unique
 * index on the table, gets attempted five times against fresh slugs and is then reported as an address
 * problem, so the caller is told to change the one thing that was fine. `projects.create_project`
 * learned that the expensive way; these tests are what stop this helper relearning it.
 */
import { assert, assertEquals } from "@std/assert";
import { isSlug } from "@projective/types/slugs";
import { insertWithSlugRetry, isSlugCollision, SLUG_MAX_ATTEMPTS } from "./slug-retry.ts";

const SLUG_CONSTRAINT = "projects_slug_key";

/** A PostgREST-shaped unique violation naming `constraint`. */
function collision(constraint: string) {
	return {
		code: "23505",
		message: `duplicate key value violates unique constraint "${constraint}"`,
		details: null,
	};
}

// #region Detection
Deno.test("a unique violation naming THIS slug's index is a collision", () => {
	assert(isSlugCollision(collision(SLUG_CONSTRAINT), SLUG_CONSTRAINT));
});

Deno.test("a unique violation naming ANOTHER index is not", () => {
	// The one that matters. `projects.projects` carries a primary key as well, and a caller supplying
	// an id that is already taken trips that — a real conflict about a different column.
	assert(!isSlugCollision(collision("projects_pkey"), SLUG_CONSTRAINT));
	assert(!isSlugCollision(collision("uq_project_owner_title"), SLUG_CONSTRAINT));
});

Deno.test("an error that is not a unique violation is never a collision", () => {
	for (const code of ["23503", "23514", "42501", "22P02", "PGRST301", "", null, undefined]) {
		assert(
			!isSlugCollision(
				{ code, message: `duplicate key ... "${SLUG_CONSTRAINT}"` },
				SLUG_CONSTRAINT,
			),
			`SQLSTATE ${code} was read as a collision on the strength of its message alone`,
		);
	}
});

Deno.test("a transport failure with no code or message falls through as itself", () => {
	assert(!isSlugCollision({}, SLUG_CONSTRAINT));
	assert(!isSlugCollision({ message: null, details: null }, SLUG_CONSTRAINT));
});

Deno.test("the constraint is matched in `details` too, since PostgREST splits the two", () => {
	assert(
		isSlugCollision({
			code: "23505",
			message: "conflict",
			details: `Key (slug)=(x) already exists in ${SLUG_CONSTRAINT}`,
		}, SLUG_CONSTRAINT),
	);
});
// #endregion

// #region Retry
Deno.test("a write that succeeds first time is attempted exactly once", async () => {
	const slugs: string[] = [];
	const out = await insertWithSlugRetry("project", SLUG_CONSTRAINT, (slug) => {
		slugs.push(slug);
		return Promise.resolve({ data: { slug }, error: null });
	});
	assertEquals(slugs.length, 1);
	assertEquals(out.error, null);
	assert(isSlug(slugs[0], "project"));
});

Deno.test("a collision is retried with a FRESH slug, not a suffix on the last one", async () => {
	const slugs: string[] = [];
	const out = await insertWithSlugRetry("project", SLUG_CONSTRAINT, (slug) => {
		slugs.push(slug);
		return Promise.resolve(
			slugs.length < 3
				? { data: null, error: collision(SLUG_CONSTRAINT) }
				: { data: { slug }, error: null },
		);
	});
	assertEquals(slugs.length, 3);
	assertEquals(out.error, null);
	assertEquals(new Set(slugs).size, 3, "the retry reused a slug instead of drawing a new one");
	for (const s of slugs) assert(isSlug(s, "project"));
});

Deno.test("an error that is NOT this slug's collision is returned immediately, unchanged", async () => {
	let attempts = 0;
	const pkey = collision("projects_pkey");
	const out = await insertWithSlugRetry("project", SLUG_CONSTRAINT, () => {
		attempts++;
		return Promise.resolve({ data: null, error: pkey });
	});
	assertEquals(
		attempts,
		1,
		"a foreign constraint violation was retried as though it were an address",
	);
	// Unwrapped and unrelabelled, so the caller reports what actually went wrong.
	assertEquals(out.error, pkey);
});

Deno.test("attempts are bounded, and the last real error is what surfaces", async () => {
	let attempts = 0;
	const out = await insertWithSlugRetry("project", SLUG_CONSTRAINT, () => {
		attempts++;
		return Promise.resolve({ data: null, error: collision(SLUG_CONSTRAINT) });
	});
	assertEquals(attempts, SLUG_MAX_ATTEMPTS);
	// Not a cheerful sentence about addresses: five independent 50-bit draws all landing on taken
	// slugs does not describe a busy table, it describes something else being wrong.
	assertEquals(out.error?.code, "23505");
});

Deno.test("a caller-supplied bound is honoured, and one attempt always runs", async () => {
	for (const [bound, expected] of [[1, 1], [3, 3], [0, 1], [-1, 1]] as const) {
		let attempts = 0;
		await insertWithSlugRetry("project", SLUG_CONSTRAINT, () => {
			attempts++;
			return Promise.resolve({ data: null, error: collision(SLUG_CONSTRAINT) });
		}, bound);
		assertEquals(attempts, expected, `maxAttempts=${bound} ran ${attempts} attempts`);
	}
});

Deno.test("each entity is minted in its own namespace", async () => {
	for (const entity of ["project", "stage", "service", "session"] as const) {
		let seen = "";
		await insertWithSlugRetry(entity, SLUG_CONSTRAINT, (slug) => {
			seen = slug;
			return Promise.resolve({ data: null, error: null });
		});
		assert(isSlug(seen, entity), `${entity} minted "${seen}"`);
	}
});

Deno.test("a thenable is accepted, because a PostgREST builder is not a real Promise", async () => {
	// The builder resolves only when awaited. Typing the parameter as `Promise` would refuse exactly
	// the callers this helper exists for, and push them into an `await` that discards the builder's
	// own result type — which is how `error.message` ends up widened to `string | null | undefined`.
	// A `then` and nothing else — no `catch`, no `finally`, no `Symbol.toStringTag`, which is precisely
	// the shape that fails an `extends Promise` constraint while working perfectly under `await`.
	function builderLike<T>(value: T): PromiseLike<T> {
		return {
			then: (onfulfilled, onrejected) => Promise.resolve(value).then(onfulfilled, onrejected),
		};
	}
	const out = await insertWithSlugRetry(
		"project",
		SLUG_CONSTRAINT,
		(slug) => builderLike({ data: { slug }, error: null }),
	);
	assert(!("catch" in out), "the test's stand-in became a real Promise, so it proves nothing");
	assert(isSlug(out.data.slug, "project"));
});
// #endregion
