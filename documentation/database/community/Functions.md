# community: Functions

**`EXECUTE` is deny by default (Decision #477).** The first region of `00002510` revokes it from
`PUBLIC`, `anon` and `authenticated` on every function here and `00002500` closes the default for
functions created later, so a client role holds only what `00002510` grants by name. `anon` may
execute only `community.feedback_status_counts`, `community.submit_help_feedback`. The full
allowlist, one reason per line, is in `supabase/probes/function_grants.sql`.

Migration
[`00001320_functions_editorial_community.sql`](../../../supabase/migrations/00001320_functions_editorial_community.sql)
(regions `[community.*]`); triggers in `00001898` under the same region names. EXECUTE is deny by
default (`00002510`, its first region) and granted back by name in the surface's region there.
Tables: [Tables.md](Tables.md) · Policies: [Policies.md](Policies.md).

## Newsletter

The double opt-in (Decision #480, PRD-E11) and the provider's copy of the list (CD1 step 5). Every
function below is `search_path = ''` and **service role only**, called from
`packages/backend/services/newsletter/`. The double opt-in's doors are named in `00002510`
(`[community.newsletter]`); the four provider doors hold it through the deny-by-default default
privileges alone (no client role may execute them; the service role keeps EXECUTE), as NT3's comms
doors do. The link's three doors take only the mailed link's token, the address's one credential.
The probes `supabase/probes/newsletter_double_opt_in.sql` and `newsletter_provider_sync.sql` pin
them.

### `community.fn_newsletter_pending_topics(p_row community.newsletter_subscriptions) → text[]`

What a confirmation would apply to the row, or NULL when nothing awaits: on an unsubscribed address
the pending re-subscribe, on an unconfirmed one its whole `topics`, on a confirmed one the pending
topics. `IMMUTABLE`, reads only its argument. The one rule the three doors below share.

### `community.fn_newsletter_suppressed(p_email text) → boolean`

Whether `comms.fn_is_suppressed('email', p_email, 'marketing')` refuses the address: a hard bounce
blocks every category, a complaint or unsubscribe Marketing, and the newsletter is Marketing.
`SECURITY DEFINER`, so the newsletter's doors need nothing of `comms` but this one boolean for one
address, whatever `USAGE` the service role holds there (`00002500`).

### `community.subscribe_newsletter(p_email text, p_source text DEFAULT 'footer', p_topic text DEFAULT 'general') → jsonb`

The public form's writer. `SECURITY INVOKER`, `search_path = ''`, **service role only** — called by
`NewsletterBackendService` (`packages/backend/services/newsletter/`) behind
`NEWSLETTER_BACKEND_LIVE`. It lowercases and trims the address (`22023` when it is not an address or
is longer than 254 characters, `NEWSLETTER_EMAIL_MAX`), locks the address's row, and decides one of
five outcomes:

| Outcome         | When                                         | Writes                                                                                                                                                                                                                                                                                                                                                                                                             |
| :-------------- | :------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `created`       | no row for the address                       | INSERT with `topics = {p_topic}`, unconfirmed.                                                                                                                                                                                                                                                                                                                                                                     |
| `resubscribed`  | the address had unsubscribed                 | Records the request only: `p_topic` joins `resubscribe_topics` (sorted, distinct) and `resubscribe_requested_at` is stamped. `unsubscribed_at` / `unsubscribed_reason` (the only record of the opt-out), `topics` and `confirmed_at` are untouched, so the row stays unsendable until the confirm link applies the request — a public form proves nobody owns the address. A second request joins the pending set. |
| `topic_added`   | active and unconfirmed, and `p_topic` is new | `p_topic` joins `topics` (sorted by code point, distinct); `updated_at` set. `source` keeps the first capture. The first confirmation covers it.                                                                                                                                                                                                                                                                   |
| `topic_pending` | active and confirmed, and `p_topic` is new   | `p_topic` joins `resubscribe_topics` and `resubscribe_requested_at` is stamped, as a re-subscribe is recorded: what the address holds keeps going out, and the new topic waits for its own confirmation (#274 flag (c)).                                                                                                                                                                                           |
| `unchanged`     | active, and `p_topic` is already held        | Nothing — not even `updated_at`.                                                                                                                                                                                                                                                                                                                                                                                   |

Then, under the same lock, **a confirmation mail is due** when `fn_newsletter_pending_topics` is not
NULL, `confirmation_sent_at` is NULL or more than 10 minutes old, and `fn_newsletter_suppressed` is
false; a due mail stamps `confirmation_sent_at` (and only it: `updated_at` stays). Returns
`{ email, topic, outcome, already_subscribed, confirmation_due, token, confirm_topics }`; `token`
and `confirm_topics` are present only when the mail is due, and the service sends it once the
transaction commits. `already_subscribed` is true exactly for `unchanged`; the service answers every
outcome with the same public success, so neither field reaches the form. A concurrent first
subscribe of the same address is folded in, not raised (`INSERT … ON CONFLICT DO NOTHING`, then loop
to lock the winner's row). `p_source` and `p_topic` are checked by the table's CHECKs (`23514`);
NULL falls back to the defaults. Topic sets are sorted `COLLATE "C"` (code point), the order the
TypeScript twin's `normalizeTopics` produces.

Its TypeScript twin is `planNewsletterSubscription` (`subscription-plan.ts`, unit-tested); the
probes `community_editorial_schemas.sql` and `newsletter_double_opt_in.sql` pin the same five
outcomes in SQL.

### `community.read_newsletter_link(p_token uuid) → jsonb`

What the link's two pages show, writing nothing (a mail scanner opens every link; Decisions #445,
#478). `STABLE`, `SECURITY INVOKER`. NULL for an unknown token; otherwise
`{ subscribed, unsubscribed, topics, pending_topics, expired }` — never the address. `expired` is
true when something awaits confirmation but the mail that carried the link is more than 7 days old
(or none was sent).

### `community.confirm_newsletter(p_token uuid) → jsonb`

The confirm page's button (`POST /api/newsletter/confirm`), under a row lock. Returns
`{ outcome, topics }`:

| Outcome             | When                                                            | Writes                                                                                                                                                                                                        |
| :------------------ | :-------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `confirmed`         | something awaits and the link's mail is at most 7 days old      | `topics` = the pending re-subscribe (unsubscribed), `topics ∪ resubscribe_topics` (confirmed) or unchanged (unconfirmed); `confirmed_at = now()`; `unsubscribed_at`, its reason and the pending pair cleared. |
| `already_confirmed` | nothing awaits, and the address is subscribed                   | Nothing: the same success.                                                                                                                                                                                    |
| `expired`           | something awaits, but the mail is older than 7 days (or unsent) | Nothing. Subscribing again mails a fresh link.                                                                                                                                                                |
| `unsubscribed`      | nothing awaits, and the address has unsubscribed                | Nothing.                                                                                                                                                                                                      |
| `not_found`         | no row holds the token                                          | Nothing.                                                                                                                                                                                                      |

An opt-out therefore ends only through a request its owner confirmed.

### `community.unsubscribe_newsletter(p_token uuid, p_reason text) → jsonb`

The unsubscribe page's button (`p_reason = 'link'`) and a mail client's RFC 8058 one-click POST
(`'one_click'`); any other reason is `22023`. Never expires and is idempotent: `unsubscribed` (sets
`unsubscribed_at`, the reason, and clears a pending request), `already_unsubscribed` (the first
opt-out's time and reason stay; a request pending since is cleared), `not_found`. Nothing is
deleted.

### `community.fn_newsletter_provider_sync_enabled() → boolean`

The `newsletter.provider_sync` feature flag (`00005001`, off in every seed), false when the row is
missing. `SECURITY DEFINER` for the reason `comms.fn_dispatch_enabled` is: the service role reads no
flag table, and this answers one boolean of one flag.

### `community.newsletter_sync_batch(p_limit integer DEFAULT 50) → jsonb`

What `newsletter-provider-sync` (`NewsletterProviderSync.run`) must do next, reading only. `STABLE`,
`SECURITY INVOKER`. A row is **send-eligible** when confirmed, not unsubscribed and not suppressed
for marketing email (`fn_newsletter_suppressed`); the provider must hold a contact for exactly those
rows:

| Action   | When                                                                                         |
| :------- | :------------------------------------------------------------------------------------------- |
| `upsert` | eligible, and `provider_synced_at` is NULL or older than `updated_at`                        |
| `remove` | not eligible, and `provider_contact_ref` is set (unsubscribed, or suppressed with a contact) |

Returns `{ enabled, segment_id, topic_ids, rows }`: the flag (no rows while it is off), the raw
values of the params `newsletter_provider_segment_id` and `newsletter_provider_topic_ids`, and at
most `p_limit` (1–500) rows, oldest change first. Each row is
`{ id, email, topics, action, contact_ref, version, reconfirmed }` and nothing else of the
subscription; `version` is the row's `updated_at`, and `reconfirmed` is true when the row was
confirmed after the version the provider last received (the one case in which an existing contact's
provider-side opt-out may be lifted).

### `community.record_newsletter_sync(p_id uuid, p_version timestamptz, p_action text, p_contact_ref text DEFAULT NULL, p_topics text[] DEFAULT NULL) → text`

What one provider call did, stamped against the version the batch read. `SECURITY INVOKER`, under a
row lock, never touching `updated_at`. `upserted` sets `provider_contact_ref`, `provider_topics` and
`provider_synced_at = p_version` (`stale` when a newer version was already recorded); `refused` (the
provider refused the address for good) sets `provider_synced_at = p_version`, so it waits for the
row's next change; `removed` clears all three provider columns, but only for the contact it deleted
(`stale` otherwise). Returns `recorded` · `stale` · `not_found`; an unknown action, an upsert or
removal without its contact id, or an unknown topic is `22023`.

### `community.record_newsletter_provider_event(p_email text, p_event text, p_occurred_at timestamptz DEFAULT NULL, p_contact_ref text DEFAULT NULL, p_opted_out text[] DEFAULT NULL, p_opted_in text[] DEFAULT NULL) → jsonb`

The provider's own news about an address, from NT3's signed Resend webhook
(`applyNewsletterProviderEvent`). `SECURITY INVOKER`, keyed by the address under a row lock. The
provider can take an address off the list, or a topic off an address, but never put either back.

| Event          | From                                         | Effect                                                                                                                                                                                                                              |
| :------------- | :------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unsubscribed` | `contact.updated` with `unsubscribed: true`  | `unsubscribed_at`, reason `provider`; `stale` for a contact other than the one known.                                                                                                                                               |
| `complaint`    | `email.complained` (any mail to the address) | `unsubscribed_at`, reason `complaint`, beside NT3's Marketing-only suppression.                                                                                                                                                     |
| `topics`       | `contact.topics.updated`                     | Each opted-out topic the provider had opted in (`provider_topics`) leaves `topics`; the last one leaving unsubscribes (reason `provider`). An opted-in topic the provider never held is not added: the row is re-synced (`resync`). |
| `present`      | `contact.created` / `contact.updated`        | A contact that is not the known one is recorded and re-synced, so a stray contact of an ineligible row is deleted.                                                                                                                  |
| `deleted`      | `contact.deleted`                            | The known contact's deletion clears the provider columns and unsubscribes (reason `provider`); any other deletion is `unchanged`.                                                                                                   |

A complaint or topic event that happened before the row's last confirmation is `stale`, so a late or
replayed delivery never undoes a newer consent. An unsubscribe clears a pending request. Returns
`{ outcome }`: `unsubscribed` · `already_unsubscribed` · `topics_removed` · `resync` · `unchanged` ·
`stale` · `not_found`; an unknown event or topic, or a contact event without its id, is `22023`.

## Help feedback

| Function                                                                                              | Returns                         | Security                                                                        | Purpose                                                            |
| :---------------------------------------------------------------------------------------------------- | :------------------------------ | :------------------------------------------------------------------------------ | :----------------------------------------------------------------- |
| `community.submit_help_feedback(p_article_slug text, p_helpful boolean, p_comment text DEFAULT NULL)` | `jsonb` `{recorded, duplicate}` | DEFINER, `search_path = ''`; EXECUTE to `anon`, `authenticated`, `service_role` | The one writer of `community.help_feedback` ("Was this helpful?"). |

What it decides, so no caller can:

- **The voter** is `auth.uid()` — only when it names an `org.users_public` row, so a session with no
  profile votes as a guest instead of failing the FK. Never an argument.
- **The article** must be readable now (the `help_articles_select_published` rule), else `PH404`.
- **The comment** goes only with a "No" and is at most 280 characters before masking (`22023`; a
  NULL `p_helpful` is `22023` too), and is stored only after `comms.mask_pii`, with its categories
  (Decision #147).
- **Durable rate limits** (the service's per-process limiters — 10 per signed-in voter per 10
  minutes, 20 per guest address a minute — sit in front): a signed-in voter's second vote on an
  article inside 24 hours writes nothing and answers `{recorded: false, duplicate: true}` —
  serialised by an advisory lock per voter and article, so a double press cannot write twice; past
  30 votes in an hour a voter is refused `PH429`; and an article takes at most 120 guest votes an
  hour (`PH429`).

`HelpFeedbackBackendService` calls it with the caller's own client (the voter's JWT, or anon) and
maps `PH404` → 404, `PH429` → 429, `22023` → 422, anything else → 503. Pinned by
`supabase/probes/help_centre.sql` §5–§6.

## Feedback board

Region `[community.feedback]` of `00001320`; granted by name in `00002510` (the doors to
`authenticated`, the counts to `anon` too — every other function stays revoked). Each door stamps
`auth.uid()` itself and refuses with a typed SQLSTATE `FeedbackBackendService` maps to a status:
`28000` not signed in (401) · `42501` not an operator (403) · `22023` a field out of bounds, message
`field: …` (422) · `P0002` no idea the caller can see (404 — an idea under review is never confirmed
to exist) · `55000` voting closed or an illegal move (409) · `PR429` over a rate limit, DETAIL = the
ISO instant to retry (429).

### `community.submit_feedback_idea(p_title text, p_category text, p_impact text, p_body text DEFAULT NULL) → jsonb`

SECURITY DEFINER. Trims and bounds the fields (title 6–90, impact 10–600, details ≤ 4,000, a known
category), allows five ideas per person per rolling 24 hours, inserts the idea in `backlog`, appends
the submission history row (NULL → backlog) and casts the author's own vote. Answers the idea as
`fn_feedback_idea_json` shapes it. The limit is counted under a per-person transaction advisory lock
(`pg_advisory_xact_lock(hashtext('community.feedback:' || uid))`, the key the vote door shares), so
two concurrent submits cannot both read four and both insert.

### `community.vote_feedback_idea(p_slug text) → jsonb` · `community.unvote_feedback_idea(p_slug text) → jsonb`

SECURITY DEFINER. Idempotent both ways — a repeat answers the same `{ voted, vote_count }`. The idea
must be visible to the caller (else `P0002`) and open for votes — `backlog`, `ready` or
`in_progress` (else `55000`). 120 new votes per person per rolling hour, counted under the same
per-person advisory lock as the submit door (taken before the idea's row lock, so the locks have one
order).

### `community.set_feedback_idea_status(p_slug text, p_status text, p_note text DEFAULT NULL) → jsonb`

SECURITY DEFINER; operators only (`security.is_admin()`). Moves along `fn_feedback_move_legal`
(Backlog → Ready / Archived; Ready → Backlog / In progress / Archived; In progress → Ready /
Complete / Archived; Complete → Archived; Archived terminal — the unified machine's states, not all
its §3.2 edges: Ready → In progress, In progress → Complete and Ready → Backlog are flagged in
Decision #272 (l)); a move to the state already held answers the idea unchanged. Stamps
`status_changed_at` (and `archived_at`), appends the history row with the operator and note, and
sends `feedback.status_changed` through `comms.fn_notify` to the author and every voter — never the
operator — linking `/feedback?idea=<slug>`.

### `community.respond_to_feedback_idea(p_slug text, p_response text) → jsonb`

SECURITY DEFINER; operators only. Writes the team's response (≤ 2,000) with its instant and author,
or clears all three for an empty response.

### `community.moderate_feedback_idea(p_slug text, p_status text DEFAULT NULL, p_note text DEFAULT NULL, p_response text DEFAULT NULL) → jsonb`

SECURITY DEFINER; what `FeedbackBackendService.moderate` (`POST /api/feedback/ideas/:id/status`)
calls. One statement, so one transaction: `set_feedback_idea_status` when `p_status` is given, then
`respond_to_feedback_idea` when `p_response` is given (an empty string clears it) — a refused
response rolls the move and its notifications back with it. Every check is the two doors' own; it
adds only `22023` when neither is given.

### `community.feedback_status_counts() → jsonb`

SECURITY INVOKER, so the SELECT policies decide: `{ state: n }` for the ideas the caller can see —
the board's tab counts.

### Internal (revoked from every client role)

`fn_feedback_idea_visible(status, author)` (the visibility rule, for the definer doors) ·
`fn_feedback_idea_for_caller(slug)` (the idea, row-locked, or `P0002`) ·
`fn_feedback_move_legal(from,
to)` · `fn_feedback_state_label(status)` (the label a notification
uses) · `fn_feedback_idea_json(idea)` (the client-readable columns + `viewer_voted`) and the trigger
functions `fn_feedback_idea_screen`, `fn_feedback_vote_count`, `fn_feedback_idea_no_delete`,
`fn_feedback_status_events_append_only`.
