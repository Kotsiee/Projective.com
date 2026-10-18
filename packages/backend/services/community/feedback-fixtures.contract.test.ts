/**
 * The fixture board IS the seeded board. `COMMUNITY_BACKEND_LIVE` off serves `feedback-fixtures.ts`;
 * on, the database serves what `supabase/seeds/gen/world.ts` seeded. This reads the seed world and
 * its id derivations and fails on any difference — an idea, a vote, a move, a response, a person —
 * so flipping the gate never changes what the board says (Decision #272).
 */
import { assertEquals } from "@std/assert";
import { FEEDBACK_DEMO_IDEAS, FEEDBACK_DEMO_PEOPLE } from "./feedback-fixtures.ts";

const SEEDS = new URL("../../../../supabase/seeds/gen/", import.meta.url);

interface SeedPersona {
	key: string;
	handle: string;
	name: string;
	avatar?: string;
}

const world = await import(new URL("world.ts", SEEDS).href) as {
	FEEDBACK_IDEAS: Array<Record<string, unknown> & { key: string }>;
	PERSONAS: SeedPersona[];
};
const sql = await import(new URL("sql.ts", SEEDS).href) as {
	uuidFor(namespace: string, key: string): string;
	slugFor(prefix: string, key: string): string;
};

Deno.test("the fixture board holds the seed world's ideas, field for field and in order", () => {
	const fixture = FEEDBACK_DEMO_IDEAS.map(({ id: _id, slug: _slug, ...spec }) => spec);
	assertEquals(
		JSON.parse(JSON.stringify(fixture)),
		JSON.parse(JSON.stringify(world.FEEDBACK_IDEAS)),
	);
});

Deno.test("each fixture idea carries the id and fbk- slug the seed derives from its key", () => {
	for (const idea of FEEDBACK_DEMO_IDEAS) {
		assertEquals(idea.id, sql.uuidFor("feedback-idea", idea.key), idea.key);
		assertEquals(idea.slug, sql.slugFor("fbk", idea.key), idea.key);
	}
});

Deno.test("each demo person is the seeded persona — the same account, name and picture", () => {
	for (const [key, person] of Object.entries(FEEDBACK_DEMO_PEOPLE)) {
		const seeded = world.PERSONAS.find((p) => p.key === key);
		assertEquals(seeded?.handle, person.handle, key);
		assertEquals(person.userId, sql.uuidFor("user", person.handle), key);
		assertEquals(person.name, seeded?.name, key);
		assertEquals(person.avatar, seeded?.avatar ? `/test_images/${seeded.avatar}` : null, key);
	}
});

Deno.test("everyone who wrote or voted for a demo idea is a demo person", () => {
	const named = new Set(FEEDBACK_DEMO_IDEAS.flatMap((i) => [i.author, ...i.voters]));
	assertEquals([...named].filter((k) => !(k in FEEDBACK_DEMO_PEOPLE)), []);
});
