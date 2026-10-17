# community: Tables

What people **do** around the platform and its promises (Decision #274): the newsletter opt-in, the
help centre's helpfulness votes and the public feedback board. Every row is written by a person,
through a SECURITY DEFINER door or the service role — never by a content generator
(platform-authored content is [`editorial`](../editorial/Tables.md)). Migration
[`00000025_tables_community.sql`](../../../supabase/migrations/00000025_tables_community.sql).
Policies: [Policies.md](Policies.md) · Functions: [Functions.md](Functions.md).

Each surface owns one region of every SQL file it adds to and one heading below, so the work orders
that build them merge without touching each other's lines:

| Surface        | Region (`00000025`, `00002001`, `00002021`, `00002510`, `00002520`, `00001320`, `00001898`, `00004013`) | Built by      |
| :------------- | :------------------------------------------------------------------------------------------------------ | :------------ |
| Newsletter     | `[newsletter]` / `[community.newsletter]`                                                               | Decision #274 |
| Help feedback  | `[help_feedback]` / `[community.help_feedback]`                                                         | P2            |
| Feedback board | `[feedback]` / `[community.feedback]`                                                                   | P7            |

## Newsletter

### `community.newsletter_subscriptions`

The public "stay updated" capture: one row per address. **Moved from `comms`** on 2026-10-17
(Decision #274) with every column, constraint and reasoning intact, plus `topics`. Sends to this
list are still gated by `comms.channel_suppressions` (bounces and complaints), which stays in
`comms` with the rest of outbound delivery — a send job reads both. Zod SSOT:
`@projective/types/community` (`NewsletterSubscriptionRowSchema`, `NewsletterSubscribeSchema`,
`NEWSLETTER_TOPICS`).

| Column                     | Type        | Notes                                                                                                                                                                                                                                                                                                                                                               |
| :------------------------- | :---------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                       | uuid PK     | `gen_random_uuid()`.                                                                                                                                                                                                                                                                                                                                                |
| `email`                    | text        | NOT NULL, UNIQUE, CHECK `email = lower(email)` and `char_length(email) <= 254` (RFC 5321; the same cap as the Zod `NEWSLETTER_EMAIL_MAX` and the writer's guard). The capture is anonymous, so the address is the row's only identity; two casings would mean two sends and two half-working unsubscribe links.                                                     |
| `source`                   | text        | NOT NULL, default `'footer'`, CHECK `IN ('footer', 'landing', 'explore')` = `NewsletterSource`. Where the FIRST capture happened; a later capture that adds a topic keeps it.                                                                                                                                                                                       |
| `topics`                   | text[]      | NOT NULL, default `{general}`. CHECK: at least one element, no NULL element, and a subset of `{general, changelog}` = `NEWSLETTER_TOPICS`. Stored sorted and distinct by its one writer. Never empty: leaving the list is `unsubscribed_at`.                                                                                                                        |
| `user_id`                  | uuid        | Nullable; FK → `org.users_public(user_id)` ON DELETE SET NULL. Subscribing never needs an account, and closing one is not unsubscribing.                                                                                                                                                                                                                            |
| `locale`                   | text        | Nullable.                                                                                                                                                                                                                                                                                                                                                           |
| `confirmed_at`             | timestamptz | Double opt-in: NULL = captured but unconfirmed. A send-eligible row is `confirmed_at IS NOT NULL AND unsubscribed_at IS NULL`.                                                                                                                                                                                                                                      |
| `unsubscribed_at`          | timestamptz | Set when the address leaves the list — the only record of the opt-out, so the public form never clears it.                                                                                                                                                                                                                                                          |
| `unsubscribed_reason`      | text        | Nullable.                                                                                                                                                                                                                                                                                                                                                           |
| `resubscribe_topics`       | text[]      | Nullable. A re-subscribe request on an unsubscribed address, pending its owner's confirmation: the topics asked for since the unsubscribe, sorted and distinct. CHECK (`newsletter_subscriptions_resubscribe_check`): set together with `resubscribe_requested_at`, only while `unsubscribed_at` is, never empty, no NULL element, a subset of `NEWSLETTER_TOPICS`. |
| `resubscribe_requested_at` | timestamptz | Nullable; when the request was last made. Applied by the confirm-link handler (not built yet) in one write: `topics = resubscribe_topics`, `confirmed_at = now()`, and `unsubscribed_at`, `unsubscribed_reason` and both `resubscribe_*` cleared.                                                                                                                   |
| `token`                    | uuid        | NOT NULL, UNIQUE, `gen_random_uuid()`. The confirm / unsubscribe capability carried in the link — one-click unsubscribe cannot ask the reader to sign in.                                                                                                                                                                                                           |
| `created_at`               | timestamptz | `now()`.                                                                                                                                                                                                                                                                                                                                                            |
| `updated_at`               | timestamptz | `now()`; set by the writer on every change, untouched by a repeat subscribe that changes nothing.                                                                                                                                                                                                                                                                   |

**Topics.** `general` is the platform newsletter; `changelog` the release notes `/changelog` offers.
A new topic is a change to `NEWSLETTER_TOPICS`, `newsletter_subscriptions_topics_check` and
`newsletter_subscriptions_resubscribe_check` in the same commit (`newsletter.test.ts` reads both
CHECKs).

**An opt-out is undone only by its owner.** Typing an unsubscribed address into a public form proves
nobody owns it, so the writer never clears `unsubscribed_at` / `unsubscribed_reason` (or touches
`topics` / `confirmed_at`) for it: it records the request in `resubscribe_topics` +
`resubscribe_requested_at`, and the row stays unsendable until the owner follows the confirm link.

**Indexes** (`00004013`): `idx_newsletter_subscriptions_topics_sendable` — GIN on `topics` over the
send-eligible rows only, for "everyone confirmed and subscribed who opted into `changelog`". The
email and token lookups are served by their UNIQUE constraints.

**Access**: no policy and no client privilege — see [Policies.md](Policies.md#newsletter). The one
writer is [`community.subscribe_newsletter`](Functions.md#newsletter).

## Help feedback

### `community.help_feedback`

One row per "Was this helpful?" answer on a help article (P2). Insert-only, written by ONE door —
[`community.submit_help_feedback`](Functions.md#help-feedback) — and readable by the service role
only. Zod SSOT: `@projective/types/community` (`HelpFeedbackRowSchema`, `HelpFeedbackInputSchema`,
`HelpFeedbackRpcResultSchema`).

| Column                   | Type        | Notes                                                                                                                                                                                                                                                                                                      |
| :----------------------- | :---------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                     | uuid PK     | `gen_random_uuid()`.                                                                                                                                                                                                                                                                                       |
| `article_slug`           | text        | NOT NULL, FK → `editorial.help_articles(slug)` ON DELETE RESTRICT (an article is retracted by visibility, never deleted).                                                                                                                                                                                  |
| `helpful`                | boolean     | NOT NULL.                                                                                                                                                                                                                                                                                                  |
| `comment`                | text        | Nullable; only with `helpful = false` (`help_feedback_comment_on_no`). Stored **masked** by `comms.mask_pii` (Decision #147). The reader types ≤ 280 characters (refused before masking); a placeholder can be longer than what it replaced, so the column holds ≤ 1,400 (`help_feedback_comment_length`). |
| `comment_pii_categories` | text[]      | NOT NULL, default `{}` — what the mask hid (`email` · `payment_link` · `handle` · `phone`); empty without a comment.                                                                                                                                                                                       |
| `user_id`                | uuid        | Nullable; FK → `org.users_public(user_id)` ON DELETE SET NULL. Stamped from `auth.uid()` by the writer when it names a profile; NULL for a guest.                                                                                                                                                          |
| `created_at`             | timestamptz | `now()`.                                                                                                                                                                                                                                                                                                   |

**Indexes** (`00004013`): `idx_help_feedback_voter_recent` (`user_id, created_at DESC` where
`user_id` is set) for the writer's per-voter checks and the user FK;
`idx_help_feedback_article_recent` (`article_slug, created_at DESC`) for the per-article guest
ceiling, an operator's tally and the article FK.

**Access**: no policy and no client privilege — see [Policies.md](Policies.md#help-feedback).

## Feedback board

_Not yet documented._ (P7: ideas, votes and status events. An idea stores a unified-machine state —
`Backlog` shown "Under review" and visible only to its author and operators, `Ready` "Planned",
`In Progress`, `Complete` "Shipped", `Archived` — per owner ruling (d), 2026-10-17.)
