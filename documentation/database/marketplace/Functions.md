# marketplace: Functions

## Service instantiation — [`00001175_functions_marketplace_instantiate.sql`](../../../supabase/migrations/00001175_functions_marketplace_instantiate.sql)

"Add to Projects" on a Pipeline listing (Decision #209). A pipeline is not bought; it is staffed and
then bought against, one ticket at a time (`PRODUCT_SPEC.md` §Creation & Purchasing Gate). So pressing
it copies the seller's blueprint into the buyer's own workspace as a **draft** they can open, read
and fund ticket by ticket. **No money moves, nothing is reserved, and no seat is minted.** A seat
only ever comes from an accepted invitation or application (`PRODUCT_MANAGEMENT.md` §Stage
assignment), so the seller is hired into the draft through the ordinary hire path.

Three doors, all `SECURITY DEFINER`, all signed-in only, and all answering with one projection
(`fn_service_draft_json`). The write, the listing CTA's read and the archive therefore cannot
describe a draft three different ways.

| Function | Security | Does |
| :-- | :-- | :-- |
| `instantiate_service_blueprint(p_blueprint_id uuid, p_intake jsonb, p_currency text, p_idempotency_key text, p_title text)` | DEFINER | In **one transaction** it writes: the project (owner `auth.uid()`, personal workspace, `format = 'pipeline'`, `status = 'draft'`, `visibility = 'unlisted'`, `source_blueprint_id`, the listing's brief and currency); one stage per `stage_template` entry, in order, each with its **start trigger** (below); one ticket per stage; each stage's room and the project-wide Discussion room; and the `projects.service_instantiations` request row. A stage carries its name, its brief as HTML (`fn_plain_text_html`), its deliverables as a default checklist and milestone line, and its skills as `org.skills` slugs where a label matches. Its `unit_price_cents` is the stage's **standard** price, else the listing's `ticket_price_cents`, else NULL ("priced on scope", never a guessed zero). Each ticket is titled after its stage, seeded with that checklist, routed to that stage only (`required_stages`), priced at the stage's price, and left in `backlog` with no assignee. Revision terms arrive through `trg_stage_revision_terms`. **Start triggers** (Decision #217), mapped as `stageTriggerToDb` maps them: the first stage, and any stage whose `startTrigger` is `on_project_start`, gets `start_trigger_type = on_project_start` with no dependency; `after_previous` (the default, also for a missing or unknown value) and `fixed_offset` get `dependent_on_stage` with `start_dependency_stage_id` = the previous stage and `start_dependency_lag_days` = `lagDays` (clamped 0–90) for `fixed_offset`, else 0; `chain_reaction` = `chainReaction` (default true). Returns the projection plus `created`. |
| `get_service_draft(p_blueprint_id uuid)` | DEFINER | The caller's own **live** draft of a listing: personal, `draft` or `active`, newest first. It returns NULL when there is none. This is what flips the listing's primary control to "Open project →". It uses the same predicate the write dedupes on. |
| `archive_service_draft(p_project_slug text, p_reason text)` | DEFINER | "Remove draft". The caller's own instantiated project is soft-archived through `projects.set_project_status` (status history and activity written). It is **refused once any stage holds an escrow row**, the sweep's own evidence that money moved. The check and the archive happen in one transaction, after locking the project and its stage rows. Archiving an archived draft returns it unchanged. |
| `fn_service_draft_json(p_project_id uuid)` | DEFINER (internal) | The shared projection: `project_id, slug, title, status, source_blueprint_slug, stage_count, ticket_count, funded_stage_count, currency, created_at, last_activity_at`. `funded_stage_count` counts stages with any escrow row, as `projects.fn_archive_stale_service_drafts` does. No client role may execute it. |
| `fn_plain_text_html(p_text text)` | IMMUTABLE (internal) | The SQL twin of `plainTextToHtml`: it escapes `& < > "`, turns blank lines into paragraphs and keeps single newlines as `<br>`. |

### Idempotency

All of it runs under one advisory lock per buyer (`pg_advisory_xact_lock`), so two concurrent presses
run one after the other instead of racing.

1. **The request's key.** If `(auth.uid(), p_idempotency_key)` already made a project, that project
   comes back with `created: false`, whatever its status since. A replay returns what the request
   did. The same key naming a different listing is a client bug and is refused (`22023`).
2. **The buyer's live draft of this listing** (`get_service_draft`'s predicate) comes back with
   `created: false`. While one exists, the listing offers "Open project", so a second
   instantiation could only come from a stale tab.
3. Otherwise it creates. After an archive, a fresh key creates a new draft.

### Caller checks

These are the security of this path, because the functions bypass RLS:

| Refusal | SQLSTATE | HTTP (`instantiateRefusal`) |
| :-- | :-- | :-- |
| Not signed in | `28000` | 401 |
| Under 18 (`org.fn_assert_adult`) | `PM403` | 403 |
| Unknown or unpublished listing | `P0002` | 404 |
| Not a Pipeline, no stages, malformed or oversized intake, bad or reused key | `22023` | 422 |
| The caller's own listing, or their team's | `PU422` | 422 |
| `p_currency` is not the listing's currency | `PC409` | 409 |
| Archive of a funded draft | `23514` | 409 |

`p_currency` NULL means the listing's own currency. A different code is **refused, not
converted**. The seller's prices are a commitment in their currency, and converting them here would
put an FX decision nobody took into an escrow figure (Decision #209 flag). `p_intake` must be a JSON
object of at most 32 KB. It is reduced to the ids the listing's `intake_fields` declares. Required
answers are not enforced here (Decision #209 flag).

`EXECUTE` (`00002510`): the three doors go to `authenticated` and `service_role`. The two internals
are `service_role` only. `search_path` is `public, projects, marketplace, org, comms, auth`, the same
path `projects.create_project` uses, because the INSERT triggers it fires inherit it.

**Verified by execution:** `supabase/probes/service_instantiation.sql`. It runs 32 checks in one
rolled-back transaction: every refusal by SQLSTATE, three presses making one project, stage prices,
briefs, checklists and revision terms, one priced ticket and one room per stage, no seat or escrow,
the stranger and direct-write cases, the funded-archive refusal, and replay after an archive.
