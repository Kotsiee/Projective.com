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

_Not yet documented._ (P7.)
