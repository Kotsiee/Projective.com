/**
 * generate.ts — emit `supabase/seeds/*.sql` AND `supabase/seed-assets/**` from the mock corpus plus
 * the hand-authored development world (`gen/world.ts`).
 *
 * ## Why the seed is generated rather than hand-written
 *
 * The seed and the fixtures describe the same world. Written separately they drift, and the drift is
 * invisible: a developer running `supabase db reset` sees a plausible database that simply disagrees
 * with what the app renders when its gates are off. Deriving the SQL from
 * `@projective/backend/mocks` makes that impossible by construction — the same `SERVICES` array
 * produces both the card on `/explore` and the row in `marketplace.service_blueprints`.
 *
 * What the corpus does NOT describe — memberships, hiring, tickets, money, messages, notifications —
 * is declared once in `gen/world.ts` by key, and resolved to ids here, so a relationship that names
 * an unknown key fails at generate time rather than as a foreign-key violation at reset time.
 *
 * The generated `.sql` files and the asset tree ARE committed. A generator alone would make
 * `supabase db reset` depend on a Deno run; committed output keeps the standard Supabase workflow
 * working with no toolchain, while this script stays the way to regenerate after the corpus or the
 * world changes:
 *
 *     deno run --allow-read --allow-write --allow-env supabase/seeds/generate.ts
 *
 * ## Identity: deterministic UUIDs, not random ones
 *
 * Every row's primary key is derived from a stable natural key (`@handle`, a listing id, a
 * `project:stage` pair) through `uuidFor`. A re-run produces byte-identical SQL, so regenerating shows
 * an empty diff unless something actually changed. And every insert can be `ON CONFLICT DO NOTHING`,
 * which makes the seed idempotent.
 *
 * ## Images
 *
 * `test_images/` is the SOURCE. Each file is copied into `supabase/seed-assets/<bucket>/<anchor>/…`
 * — the object-name layout the storage RLS policies key on (`(storage.foldername(name))[1]` is a
 * user, team, business or project id) — and `supabase db reset` uploads that tree through the
 * storage API from `[storage.buckets.*].objects_path` in `config.toml`. `02_assets.sql` writes the
 * matching `files.items` rows (there is no FK onto `storage.objects`, so the order does not matter).
 *
 * ## Ordering
 *
 * File numbers ARE the dependency order; `config.toml`'s `[db.seed] sql_paths` glob sorts them.
 * Emit PURE SQL only: the Supabase CLI executes seed files through a Go SQL driver rather than psql,
 * so a psql meta-command such as `\ir` is a plain syntax error there.
 */

import { emitAssets } from "./gen/emit-assets.ts";
import { emitCatalogue, emitMarketplace } from "./gen/emit-catalogue.ts";
import { emitComms } from "./gen/emit-comms.ts";
import { emitEntities } from "./gen/emit-entities.ts";
import { emitFinance } from "./gen/emit-finance.ts";
import { emitIdentities } from "./gen/emit-identities.ts";
import { emitProjects } from "./gen/emit-projects.ts";
import { buildWorld } from "./gen/resolve.ts";

const world = await buildWorld();

// #region SQL
const files: Array<[string, string]> = [
	["01_identities.sql", emitIdentities(world)],
	["02_assets.sql", emitAssets(world)],
	["03_entities.sql", emitEntities(world)],
	["04_marketplace.sql", emitMarketplace(world)],
	["05_catalogue.sql", emitCatalogue(world)],
	["06_projects.sql", emitProjects(world)],
	["07_finance.sql", emitFinance(world)],
	["08_comms.sql", emitComms(world)],
];

const dir = new URL(".", import.meta.url);
for (const [name, body] of files) {
	await Deno.writeTextFile(new URL(name, dir), body.replace(/\r\n/g, "\n"));
	console.log(`wrote supabase/seeds/${name} (${body.split("\n").length} lines)`);
}
// #endregion

// #region Asset tree
const assetsRoot = new URL("../seed-assets/", dir);
const imagesRoot = new URL("../../test_images/", dir);

// Rebuild the tree from scratch so a renamed or removed asset does not linger as an orphan upload.
try {
	await Deno.remove(assetsRoot, { recursive: true });
} catch (error) {
	if (!(error instanceof Deno.errors.NotFound)) throw error;
}
let copied = 0;
for (const asset of world.assets) {
	const target = new URL(`${asset.bucket}/${asset.path}`, assetsRoot);
	await Deno.mkdir(new URL(".", target), { recursive: true });
	await Deno.copyFile(new URL(asset.source, imagesRoot), target);
	copied++;
}
console.log(`copied ${copied} images into supabase/seed-assets/`);
// #endregion

console.log(
	`\npersonas=${world.personas.size} entities=${world.entities.size} projects=${world.projects.size} assets=${world.assets.length}`,
);
