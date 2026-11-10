import type { SupabaseClient } from "supabaseClient";
import { mintSlug } from "@projective/types/slugs";

/**
 * scheduling-stub-client — a STATEFUL Supabase client for the preset tests that run without a
 * database. Tables are plain row arrays keyed by bare table name; `eq` / `in` / `is` / `lt` / `gt`
 * filter them, `update()` patches the filtered rows, and each RPC is answered by a handler that may
 * read and write the same store — so a second call sees what the first one wrote.
 */

// #region Types
/** A PostgREST error as a door raises it. */
export interface StubError {
	code: string;
	message: string;
}

/** The rows of every table the test reads or writes. */
export type StubStore = Record<string, Record<string, unknown>[]>;

/** One RPC's answer. */
export type StubRpc = (
	args: Record<string, unknown>,
	store: StubStore,
) => { data?: unknown; error?: StubError };

/** One recorded RPC call. */
export interface StubCall {
	name: string;
	args: Record<string, unknown>;
}

/** One recorded update. */
export interface StubUpdate {
	table: string;
	patch: Record<string, unknown>;
	rows: number;
}
// #endregion

// #region Client
type Row = Record<string, unknown>;

const value = (row: Row, column: string) => row[column] ?? null;

/**
 * A stub client over `store`, answering RPCs with `rpc`. `writePolicy` stands in for a table's RLS
 * write policy: an update leaves a row it refuses untouched (no error, no row — as PostgREST does),
 * and an insert of one is refused `42501`.
 */
export function stubSchedulingClient(
	store: StubStore,
	rpc: Record<string, StubRpc> = {},
	writePolicy: Record<string, (row: Row) => boolean> = {},
): { client: SupabaseClient; calls: StubCall[]; updates: StubUpdate[] } {
	const calls: StubCall[] = [];
	const updates: StubUpdate[] = [];

	const query = (table: string) => {
		const filters: Array<(row: Row) => boolean> = [];
		let patch: Row | null = null;
		let inserted: Row[] | null = null;
		let upserted: { rows: Row[]; on: string[] } | null = null;
		let removing = false;
		const allowed = (r: Row) => writePolicy[table]?.(r) ?? true;
		const run = (): { data: Row[] | null; error: StubError | null } => {
			if (upserted) {
				const { rows, on } = upserted;
				if (!rows.every(allowed)) {
					return { data: null, error: { code: "42501", message: "row-level security" } };
				}
				const clash = (a: Row) => rows.some((b) => on.every((k) => a[k] === b[k]));
				store[table] = [...(store[table] ?? []).filter((r) => !clash(r)), ...rows];
				return { data: rows, error: null };
			}
			if (removing) {
				const gone = (store[table] ?? []).filter((r) => filters.every((f) => f(r)) && allowed(r));
				store[table] = (store[table] ?? []).filter((r) => !gone.includes(r));
				return { data: gone, error: null };
			}
			if (inserted) {
				if (!inserted.every(allowed)) {
					return { data: null, error: { code: "42501", message: "row-level security" } };
				}
				(store[table] ??= []).push(...inserted);
				return { data: inserted, error: null };
			}
			const rows = (store[table] ?? []).filter((r) =>
				filters.every((f) => f(r)) && (!patch || allowed(r))
			);
			if (patch) {
				for (const r of rows) Object.assign(r, patch);
				updates.push({ table, patch, rows: rows.length });
			}
			return { data: rows, error: null };
		};
		const chain: Record<string, unknown> = {
			select: () => chain,
			order: () => chain,
			limit: () => chain,
			or: () => chain,
			eq: (c: string, v: unknown) => (filters.push((r) => value(r, c) === v), chain),
			neq: (c: string, v: unknown) => (filters.push((r) => value(r, c) !== v), chain),
			in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(value(r, c))), chain),
			is: (c: string, v: unknown) => (filters.push((r) => value(r, c) === v), chain),
			lt: (c: string, v: string) => (filters.push((r) => String(value(r, c)) < v), chain),
			gt: (c: string, v: string) => (filters.push((r) => String(value(r, c)) > v), chain),
			update: (p: Row) => {
				patch = p;
				return chain;
			},
			delete: () => {
				removing = true;
				return chain;
			},
			insert: (rows: Row | Row[]) => {
				inserted = (Array.isArray(rows) ? rows : [rows]).map((r) => ({
					id: crypto.randomUUID(),
					...r,
				}));
				return chain;
			},
			upsert: (rows: Row | Row[], options: { onConflict: string }) => {
				upserted = {
					rows: Array.isArray(rows) ? rows : [rows],
					on: options.onConflict.split(","),
				};
				return chain;
			},
			maybeSingle: () => {
				const { data, error } = run();
				return Promise.resolve(error ? { data: null, error } : { data: data?.[0] ?? null, error });
			},
			then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
				Promise.resolve(run()).then(resolve, reject),
		};
		chain.single = chain.maybeSingle;
		return chain;
	};

	const schema = {
		from: (table: string) => query(table),
		rpc: (name: string, args: Record<string, unknown> = {}) => {
			calls.push({ name, args });
			const answer = rpc[name]?.(args, store) ?? {};
			return Promise.resolve(
				answer.error
					? { data: null, error: answer.error }
					: { data: answer.data ?? null, error: null },
			);
		},
	};
	return { client: { schema: () => schema } as unknown as SupabaseClient, calls, updates };
}
// #endregion

// #region Fake doors
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The preset doors as the SQL behaves, over the stub store: `save_availability_preset` upserts the
 * preset, replaces its rules and bands and keeps the single default; `fn_preset_for_blueprint`
 * resolves the bound preset, else the schedule's default; the occurrence door counts its spans.
 */
export function fakePresetDoors(): Record<string, StubRpc> {
	return {
		save_availability_preset: (args, store) => {
			const input = args.p_preset as Row;
			const presets = store.availability_presets ??= [];
			const id = (input.id as string | undefined) ?? crypto.randomUUID();
			let row = presets.find((p) => p.id === id);
			if (!row) {
				row = {
					id,
					schedule_id: args.p_schedule,
					scope: input.scope,
					blueprint_id: input.blueprint_id ?? null,
					// trg_availability_presets_slug mints one; the door never supplies it.
					slug: mintSlug("preset"),
					is_default: false,
					compiled_from: null,
					compiled_through: null,
					archived_at: null,
				};
				presets.push(row);
			}
			Object.assign(row, { name: input.name, description: input.description ?? "" });
			const live = presets.filter((p) => p.schedule_id === args.p_schedule && !p.archived_at);
			if (input.is_default === true) { for (const p of live) p.is_default = p.id === id; }
			else if (input.scope === "library" && !live.some((p) => p.is_default)) row.is_default = true;

			const rules = store.recurrence_rules ??= [];
			const dropped = new Set(rules.filter((r) => r.preset_id === id).map((r) => r.id));
			store.recurrence_rules = rules.filter((r) => r.preset_id !== id);
			store.recurrence_rule_bands = (store.recurrence_rule_bands ?? []).filter((b) =>
				!dropped.has(b.rule_id)
			);
			((input.rules ?? []) as Row[]).forEach((r, position) => {
				const ruleId = UUID_RE.test(String(r.id ?? "")) ? r.id : crypto.randomUUID();
				store.recurrence_rules.push({
					id: ruleId,
					preset_id: id,
					kind: r.kind ?? "working_hours",
					effect: r.effect,
					rrule: r.rrule,
					starts_on: r.starts_on,
					ends_on: r.ends_on ?? null,
					priority: r.priority ?? 50,
					unless_weekdays: r.unless_weekdays ?? [],
					label: r.label ?? "",
					is_active: r.is_active ?? true,
					position,
					fee_amount_minor: r.fee_amount_minor ?? null,
					fee_currency: r.fee_currency ?? null,
					color_token: r.color_token ?? null,
				});
				((r.bands ?? []) as Row[]).forEach((b, i) =>
					store.recurrence_rule_bands.push({
						rule_id: ruleId,
						position: i,
						start_minute: b.start_minute,
						end_minute: b.end_minute,
					})
				);
			});
			return { data: id };
		},
		fn_preset_for_blueprint: (args, store) => {
			const bp = (store.service_blueprints ?? []).find((b) => b.id === args.p_blueprint);
			const presets = (store.availability_presets ?? []).filter((p) => !p.archived_at);
			const bound = presets.find((p) => p.id === bp?.availability_preset_id);
			return { data: (bound ?? presets.find((p) => p.is_default))?.id ?? null };
		},
		replace_preset_occurrences: (args) => ({ data: (args.p_spans as unknown[]).length }),
		save_owner_availability: () => ({ data: { ok: true } }),
	};
}
// #endregion
