# community: Functions

Migration
[`00001320_functions_editorial_community.sql`](../../../supabase/migrations/00001320_functions_editorial_community.sql)
(regions `[community.*]`); triggers in `00001898` under the same region names. EXECUTE is revoked
from `PUBLIC`, `anon` and `authenticated` on the whole schema (`00002510`, "editorial + community —
deny by default") and granted back by name in the surface's region there. Tables:
[Tables.md](Tables.md) · Policies: [Policies.md](Policies.md).

## Newsletter

### `community.subscribe_newsletter(p_email text, p_source text DEFAULT 'footer', p_topic text DEFAULT 'general') → jsonb`

The opt-in's **one writer**. `SECURITY INVOKER`, `search_path = ''`, **service role only** — called
by `NewsletterBackendService` (`packages/backend/services/newsletter/`) behind
`NEWSLETTER_BACKEND_LIVE`. It lowercases and trims the address (`22023` when it is not an address or
is longer than 254 characters, `NEWSLETTER_EMAIL_MAX`), locks the address's row, and decides one of
four outcomes:

| Outcome        | When                                  | Writes                                                                                                                                                                                                                                                                                                                                                                                                             |
| :------------- | :------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `created`      | no row for the address                | INSERT with `topics = {p_topic}`, unconfirmed.                                                                                                                                                                                                                                                                                                                                                                     |
| `resubscribed` | the address had unsubscribed          | Records the request only: `p_topic` joins `resubscribe_topics` (sorted, distinct) and `resubscribe_requested_at` is stamped. `unsubscribed_at` / `unsubscribed_reason` (the only record of the opt-out), `topics` and `confirmed_at` are untouched, so the row stays unsendable until the confirm link applies the request — a public form proves nobody owns the address. A second request joins the pending set. |
| `topic_added`  | active, and `p_topic` is new          | `p_topic` joins `topics` (sorted by code point, distinct); `updated_at` set. `source` keeps the first capture.                                                                                                                                                                                                                                                                                                     |
| `unchanged`    | active, and `p_topic` is already held | Nothing — not even `updated_at`.                                                                                                                                                                                                                                                                                                                                                                                   |

Returns `{ email, topic, outcome, already_subscribed }`, with `already_subscribed` true exactly for
`unchanged`, so a repeat submission answers the same success the first one did — and the answer
never names the address's other topics. A concurrent first subscribe of the same address is folded
in, not raised (`INSERT … ON CONFLICT DO NOTHING`, then loop to lock the winner's row). `p_source`
and `p_topic` are checked by the table's CHECKs (`23514`); NULL falls back to the defaults. Topic
sets are sorted `COLLATE "C"` (code point), the order the TypeScript twin's `normalizeTopics`
produces.

Its TypeScript twin is `planNewsletterSubscription` (`subscription-plan.ts`, unit-tested); the probe
`supabase/probes/community_editorial_schemas.sql` pins the same four outcomes in SQL.

## Help feedback

_Not yet documented._ (P2.)

## Feedback board

Region `[community.feedback]` of `00001320`; granted by name in `00002510` (the doors to
`authenticated`, the counts to `anon` too — every other function stays revoked). Each door stamps
`auth.uid()` itself and refuses with a typed SQLSTATE `FeedbackBackendService` maps to a status:
`28000` not signed in (401) · `42501` not an operator (403) · `22023` a field out of bounds, message
`field: …` (422) · `P0002` no idea the caller can see (404 — an idea under review is never
confirmed to exist) · `55000` voting closed or an illegal move (409) · `PR429` over a rate limit,
DETAIL = the ISO instant to retry (429).

### `community.submit_feedback_idea(p_title text, p_category text, p_impact text, p_body text DEFAULT NULL) → jsonb`

SECURITY DEFINER. Trims and bounds the fields (title 6–90, impact 10–600, details ≤ 4,000, a known
category), allows five ideas per person per rolling 24 hours, inserts the idea in `backlog`, appends
the submission history row (NULL → backlog) and casts the author's own vote. Answers the idea as
`fn_feedback_idea_json` shapes it.

### `community.vote_feedback_idea(p_slug text) → jsonb` · `community.unvote_feedback_idea(p_slug text) → jsonb`

SECURITY DEFINER. Idempotent both ways — a repeat answers the same `{ voted, vote_count }`. The idea
must be visible to the caller (else `P0002`) and open for votes — `backlog`, `ready` or `in_progress`
(else `55000`). 120 new votes per person per rolling hour.

### `community.set_feedback_idea_status(p_slug text, p_status text, p_note text DEFAULT NULL) → jsonb`

SECURITY DEFINER; operators only (`security.is_admin()`). Moves along `fn_feedback_move_legal`
(Backlog → Ready / Archived; Ready → Backlog / In progress / Archived; In progress → Ready / Complete
/ Archived; Complete → Archived; Archived terminal); a move to the state already held answers the
idea unchanged. Stamps `status_changed_at` (and `archived_at`), appends the history row with the
operator and note, and sends `feedback.status_changed` through `comms.fn_notify` to the author and
every voter — never the operator — linking `/feedback?idea=<slug>`.

### `community.respond_to_feedback_idea(p_slug text, p_response text) → jsonb`

SECURITY DEFINER; operators only. Writes the team's response (≤ 2,000) with its instant and author,
or clears all three for an empty response.

### `community.feedback_status_counts() → jsonb`

SECURITY INVOKER, so the SELECT policies decide: `{ state: n }` for the ideas the caller can see —
the board's tab counts.

### Internal (revoked from every client role)

`fn_feedback_idea_visible(status, author)` (the visibility rule, for the definer doors) ·
`fn_feedback_idea_for_caller(slug)` (the idea, row-locked, or `P0002`) · `fn_feedback_move_legal(from,
to)` · `fn_feedback_state_label(status)` (the label a notification uses) ·
`fn_feedback_idea_json(idea)` (the client-readable columns + `viewer_voted`) and the trigger functions
`fn_feedback_idea_screen`, `fn_feedback_vote_count`, `fn_feedback_idea_no_delete`,
`fn_feedback_status_events_append_only`.
