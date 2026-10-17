/**
 * editorial-generate — emit each editorial surface's seed migration from its content source
 * (Decision #274).
 *
 *   deno task db:editorial:generate            # rewrite supabase/migrations/0000507x_seed_editorial_*.sql
 *   deno task db:editorial:generate --check    # exit 1 if any committed file is stale; write nothing
 *
 * ## Why migrations, not the development seed
 *
 * The help centre, the changelog and Projective's articles are platform reference data: they must
 * exist in every environment, and `supabase/seeds/*.sql` runs only on a local reset. So each surface's
 * content source (`packages/backend/services/editorial/content/<surface>.ts`, Zod-validated through
 * its table's row schema) is emitted into ONE category-5 migration per surface — one file each, so
 * the three surfaces' work orders never edit the same generated file. The output is committed, like
 * the seed's, so a reset needs no toolchain; regenerate after editing a source, then commit both.
 *
 * Applying the new rows locally is a database reset (root CLAUDE.md); `content-sql.test.ts` in
 * `deno task test:unit` fails while a committed file and its source disagree.
 *
 * ## Tooling, not workspace code
 *
 * A root script, like `gen-mock-placeholders.ts`: nothing imports it. The emission itself is the pure
 * `emitEditorialSeed` (`services/editorial/content-sql.ts`), so the test and this script cannot
 * disagree about what a file should contain.
 */
import { EDITORIAL_SEEDS } from "@server/services/editorial/content/mod.ts";
import { emitEditorialSeed } from "@server/services/editorial/content-sql.ts";

// #region Run
const MIGRATIONS = new URL("../supabase/migrations/", import.meta.url);
const check = Deno.args.includes("--check");

/** The committed file's text with line endings normalised (a Windows checkout has CRLF). */
function readCommitted(url: URL): string | null {
	try {
		return Deno.readTextFileSync(url).replace(/\r\n/g, "\n");
	} catch (err) {
		if (err instanceof Deno.errors.NotFound) return null;
		throw err;
	}
}

let stale = 0;
for (const target of EDITORIAL_SEEDS) {
	const url = new URL(target.file, MIGRATIONS);
	const sql = emitEditorialSeed(target);
	const committed = readCommitted(url);
	if (committed === sql) {
		console.log(`  unchanged  ${target.file}`);
		continue;
	}
	if (check) {
		stale++;
		console.error(`  STALE      ${target.file} (regenerate from ${target.sourcePath})`);
		continue;
	}
	Deno.writeTextFileSync(url, sql);
	console.log(`  written    ${target.file}`);
}

if (stale > 0) {
	console.error(`${stale} editorial seed file(s) are stale: run deno task db:editorial:generate.`);
	Deno.exit(1);
}
// #endregion
