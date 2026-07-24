import { z } from "zod";

/**
 * finance — shared primitives for the `finance` schema Zod SSOT.
 *
 * These mirror the Postgres money columns exactly: amounts are **integer minor units**
 * (`amount_minor BIGINT`, e.g. cents/pence) and currencies are ISO-4217 codes — every finance shape
 * carries the `(amount, currency)` pair, and balances are a projection over the ledger, never an
 * app-computed float. Only regex/min/max/enum/int primitives are used so the schemas stay stable
 * across Zod majors (matching `packages/types/org/organisations.ts`).
 *
 * The row schemas across this domain back both the EXISTING finance tables (migrations 0009 / 0305 /
 * 0310) and the ADDITIVE tables from `supabase/migrations/20260723090000..20260723094000_*` — the
 * migration, this SSOT, and `documentation/database/finance/*` land together (root CLAUDE.md §1).
 */

// #region Scalar primitives
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An opaque UUID id. */
export const uuid = z.string().regex(UUID_RE, "Expected a UUID.");
/** An ISO timestamp string as returned by PostgREST. */
export const timestamp = z.string();
/**
 * An ISO-4217 currency code. New columns are `char(3)`; the pre-existing ledger columns are `text`
 * (and a legacy worked-example uses lowercase), so the shape is length-tolerant and case-agnostic.
 */
export const currency = z.string().min(3).max(8);
/** An amount in **integer minor units** (cents/pence). May be signed on audit/transfer lines. */
export const minorUnits = z.number().int();
/** A non-negative amount in minor units. */
export const minorUnitsNonNeg = z.number().int().min(0);
/** A strictly positive amount in minor units. */
export const minorUnitsPositive = z.number().int().positive();
/** Basis points, 0–10000 (0–100%). */
export const basisPoints = z.number().int().min(0).max(10000);
// #endregion

// #region Fund states (the three-state balance projection + Dispute Lockbox)
/**
 * `finance.fund_state` — the canonical vocabulary for the balance projection over the ledger:
 * `locked` (Escrowed) · `pending` (7-day safety window) · `available` (withdrawable) · `on_hold`
 * (contested funds in the Dispute Lockbox). Derived, never stored on the wallet itself
 * (finance-model.md §7).
 */
export const FundState = z.enum(["locked", "pending", "available", "on_hold"]);
export type FundState = z.infer<typeof FundState>;
// #endregion
