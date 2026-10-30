/**
 * The planned write list `projects.apply_write_batch` runs in ONE transaction (DL S7).
 *
 * A setup save and a ticket commit used to issue their statements one PostgREST request at a time,
 * so a refusal part-way left the earlier ones committed under a form that said nothing was saved. The
 * services still decide WHAT to write exactly as before; they now record it here instead of sending
 * it, and the whole list is sent once. Everything in the batch runs as the caller (the function is
 * SECURITY INVOKER), so RLS and every RPC's own authority check apply exactly as they did.
 *
 * Pure: building a batch touches no database, which is what lets its shape be unit-tested.
 */

// #region Types
/** A placeholder for a value an earlier op stores (`ref`), resolved inside the transaction. */
export interface BatchRef {
	$ref: string;
}

/** An id that is already stored, or one a previous op in the same batch will mint. */
export type BatchId = string | BatchRef;

/** The tables the batch may write, mirroring the allowlist in `projects.apply_write_batch`. */
export type BatchTable =
	| "projects"
	| "project_stages"
	| "stage_staffing_roles"
	| "project_attachments"
	| "tickets";

/** The project RPCs the batch may call, mirroring the same allowlist. */
export type BatchFunction =
	| "set_project_status"
	| "create_stage"
	| "delete_stage"
	| "reorder_stages"
	| "sanitize_single_room_topology"
	| "move_ticket";

/** One planned statement. `field` names the form section a failure is reported against. */
export type BatchOp =
	| {
		kind: "update";
		table: BatchTable;
		id: BatchId;
		patch: Record<string, unknown>;
		field?: string;
		ref?: string;
	}
	| {
		kind: "insert";
		table: BatchTable;
		row: Record<string, unknown>;
		field?: string;
		ref?: string;
	}
	| {
		kind: "delete";
		table: BatchTable;
		match: Record<string, unknown>;
		expect?: boolean;
		field?: string;
	}
	| { kind: "rpc"; fn: BatchFunction; args: Record<string, unknown>; field?: string; ref?: string };
// #endregion

// #region Builder
/** Whether a value is a {@link BatchRef} rather than a stored id. */
export function isBatchRef(value: unknown): value is BatchRef {
	return typeof value === "object" && value !== null &&
		typeof (value as BatchRef).$ref === "string";
}

/**
 * An ordered list of planned writes.
 *
 * Each `insert` and `rpc` that is given `keep: true` stores its result under a fresh name and returns
 * a {@link BatchRef} to it, so a later op can name a row that does not exist yet (a stage created in
 * this save, then patched, given roles and ordered in the same save).
 */
export class WriteBatch {
	readonly ops: BatchOp[] = [];
	private seq = 0;

	private nextRef(prefix: string): string {
		this.seq += 1;
		return `${prefix}${this.seq}`;
	}

	/** Patch one row by id. An update that reaches no row fails the whole batch (`not_written`). */
	update(table: BatchTable, id: BatchId, patch: Record<string, unknown>, field?: string): void {
		this.ops.push({ kind: "update", table, id, patch, field });
	}

	/** Insert one row; with `keep`, returns a reference to its `id`. */
	insert(
		table: BatchTable,
		row: Record<string, unknown>,
		field?: string,
		keep = false,
	): BatchRef | null {
		const ref = keep ? this.nextRef(table) : undefined;
		this.ops.push({ kind: "insert", table, row, field, ref });
		return ref ? { $ref: ref } : null;
	}

	/** Delete the rows matching every column given. With `expect`, deleting none fails the batch. */
	delete(table: BatchTable, match: Record<string, unknown>, field?: string, expect = false): void {
		this.ops.push({ kind: "delete", table, match, expect, field });
	}

	/** Call one allowlisted RPC; with `keep`, returns a reference to its result. */
	rpc(
		fn: BatchFunction,
		args: Record<string, unknown>,
		field?: string,
		keep = false,
	): BatchRef | null {
		const ref = keep ? this.nextRef(fn) : undefined;
		this.ops.push({ kind: "rpc", fn, args, field, ref });
		return ref ? { $ref: ref } : null;
	}

	/** Whether anything was planned. An empty batch is never sent. */
	get empty(): boolean {
		return this.ops.length === 0;
	}
}

/** The form section a batch failure names, read from the `field:<name>` hint the function raises. */
export function batchFieldOf(hint: string | null | undefined): string | undefined {
	if (!hint || !hint.startsWith("field:")) return undefined;
	const field = hint.slice("field:".length);
	return field.length > 0 ? field : undefined;
}
// #endregion
