/**
 * `deno task embeddings:backfill [--dry-run] [--force]` — store a voyage-4 vector for every PUBLIC
 * discovery item: listings (services · products), articles, public projects and listed profiles
 * (Decision #179).
 *
 * Reads the public catalogue exactly as discovery does (`anon`, `loadCatalog`), builds each item's
 * text and hash (`core/embedding-text.ts`), skips every item whose stored hash and model still match,
 * embeds the rest in batches and writes them through `search.fn_set_embedding` with the service-role
 * key. Idempotent: a second run embeds nothing unless a text changed.
 *
 *   --dry-run  prints the entity count, a token estimate and the estimated cost; calls Voyage never
 *              and writes nothing (it still reads the catalogue, and the stored hashes when the
 *              service-role key is set, to say what a real run would skip).
 *   --force    re-embeds every public item, changed or not.
 *
 * `deno task db:reset` leaves every vector empty; run this after it. The run is the same whatever
 * EMBEDDINGS_ENABLED says — that flag decides whether discovery READS the vectors.
 */
import { load } from "@std/dotenv";
import { serverEnv } from "@projective/backend/core/env.ts";
import { embeddingsStatus, isSupabaseConfigured } from "@projective/backend/core/supabase.ts";
import { loadCatalog } from "@server/services/explore/live-catalog.ts";
import { readEmbeddingStates } from "@server/services/search/embedding-index.ts";
import {
	type EmbeddingSyncReport,
	embeddingTargets,
	staleTargets,
	syncEmbeddings,
} from "@server/services/search/embedding-sync.ts";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "@projective/types/explore";

await load({ envPath: ".env.local", export: true });
await load({ export: true });

const USD_PER_MILLION_TOKENS = 0.06;
const CHUNK = 64;
const MAX_ROUNDS = 3;
const ROUND_WAIT_MS = 60_000;

const KNOWN_FLAGS = new Set(["--dry-run", "--force"]);
const unknown = Deno.args.filter((a) => !KNOWN_FLAGS.has(a));
if (unknown.length > 0) {
	console.error(`Unknown flag(s): ${unknown.join(" ")}. Use --dry-run and/or --force.`);
	Deno.exit(2);
}
const dryRun = Deno.args.includes("--dry-run");
const force = Deno.args.includes("--force");

function usd(tokens: number): string {
	return `$${(tokens / 1_000_000 * USD_PER_MILLION_TOKENS).toFixed(6)}`;
}

function summary(report: EmbeddingSyncReport): string {
	return `embedded ${report.embedded} · skipped ${report.skipped} · no index row ${report.missing} · ` +
		`failed ${report.failed}`;
}

if (!isSupabaseConfigured()) {
	console.error("SUPABASE_URL / SUPABASE_ANON_KEY are not set — nothing to read.");
	Deno.exit(1);
}
const env = serverEnv();
const canReadState = !!env.supabaseServiceRoleKey;

console.log(
	`${EMBEDDING_MODEL} · ${EMBEDDING_DIMENSIONS} dimensions · ${dryRun ? "DRY RUN" : "live"}${
		force ? " · --force" : ""
	}`,
);
const catalog = await loadCatalog();
const targets = await embeddingTargets(catalog);
const byKind = new Map<string, number>();
for (const t of targets) byKind.set(t.entity.kind, (byKind.get(t.entity.kind) ?? 0) + 1);
console.log(
	`${targets.length} public entities: ${
		[...byKind].map(([kind, n]) => `${kind} ${n}`).join(" · ")
	}`,
);

const stale = canReadState ? staleTargets(targets, await readEmbeddingStates(), force) : targets;
const estimate = stale.reduce((sum, t) => sum + t.tokens, 0);
console.log(
	`${stale.length} to embed${
		canReadState
			? `, ${targets.length - stale.length} already current`
			: " (no service-role key: stored hashes not read)"
	}`,
);
console.log(`≈ ${estimate} tokens · ≈ ${usd(estimate)} at $${USD_PER_MILLION_TOKENS} per 1M`);

if (dryRun) Deno.exit(0);

if (!canReadState) {
	console.error(
		"SUPABASE_SERVICE_ROLE_KEY is not set — search.fn_set_embedding is service-role only.",
	);
	Deno.exit(1);
}
if (!embeddingsStatus().keyPresent) {
	console.error("VOYAGE_API_KEY is not set — put it in .env.local.");
	Deno.exit(1);
}

let total: EmbeddingSyncReport | null = null;
for (let round = 1; round <= MAX_ROUNDS; round++) {
	const report = await syncEmbeddings(targets, {
		force: force && round === 1,
		chunkSize: CHUNK,
		onChunk: (r) => console.log(`  … ${summary(r)} · ${r.tokens} tokens`),
	});
	total = total
		? {
			...report,
			embedded: total.embedded + report.embedded,
			missing: total.missing + report.missing,
			tokens: total.tokens + report.tokens,
			skipped: report.skipped - total.embedded,
		}
		: report;
	if (!report.error) break;
	console.warn(`Round ${round} stopped: ${report.error}`);
	if (!report.retryable) {
		console.warn("Not a rate limit or an outage — waiting will not help, so stopping here.");
		break;
	}
	if (round < MAX_ROUNDS) {
		console.warn(`Waiting ${ROUND_WAIT_MS / 1000}s, then resuming with what is still stale.`);
		await new Promise((resolve) => setTimeout(resolve, ROUND_WAIT_MS));
	}
}

if (!total) Deno.exit(1);
console.log(`Done: ${summary(total)}`);
console.log(`Voyage billed ${total.tokens} tokens · ${usd(total.tokens)}`);
Deno.exit(total.failed > 0 ? 1 : 0);
