# community: Policies

Migration
[`00002021_policies_editorial_community.sql`](../../../supabase/migrations/00002021_policies_editorial_community.sql)
(RLS enabled in `00002001`, regions `[community.*]`). The schema is exposed to PostgREST and `USAGE`
is granted to `anon`, `authenticated` and `service_role` (`00002500`); there is **no schema-wide
table grant to a client role** — each table a client reaches is named in its region of `00002520`
with the narrowest verbs it needs, and never `ALL` (it carries TRUNCATE, which RLS does not bound).
The service role holds every table. Every function is revoked from the client roles by default
(`00002510`) and granted back by name. Tables: [Tables.md](Tables.md) · Functions:
[Functions.md](Functions.md).

**The model:** reads are as narrow as the surface needs; writes go through SECURITY DEFINER doors
that stamp the actor from `auth.uid()`, rate-limit and screen public text — not through INSERT
policies a PostgREST call could reach directly.

## Newsletter

| Table                                | Read                           | Write | Client privilege                                |
| :----------------------------------- | :----------------------------- | :---- | :---------------------------------------------- |
| `community.newsletter_subscriptions` | — **No policy, deliberately.** | —     | **None**, for `anon` and `authenticated` alike. |

Default-deny, and — unlike its old home in `comms`, where a blanket `GRANT ALL … TO authenticated`
left RLS as the only barrier — no client role holds any privilege on it either, so a stray policy
would still grant nothing. Nothing should ever read this table as a user: every row is somebody's
email address paired with a `token` that is the unsubscribe capability, so a SELECT policy wide
enough to be useful is a subscriber-list dump, and a per-row one would still confirm whether a given
address is subscribed. A direct PostgREST INSERT would let anyone enumerate addresses by observing
unique-violation errors. The public form therefore posts to `/api/newsletter/subscribe`, and
`NewsletterBackendService` calls `community.subscribe_newsletter` with the service-role client.

Verified by `supabase/probes/community_editorial_schemas.sql`: both client roles are refused `42501`
on SELECT, INSERT, UPDATE and on the writer itself, before RLS is consulted.

## Help feedback

`community.help_feedback`: RLS on (`00002001`), **no policy and no client privilege** (`00002021` /
`00002520`, `[community.help_feedback]`). A vote is never read, edited or deleted through PostgREST;
the only way in is the SECURITY DEFINER door `community.submit_help_feedback`, which `anon` and
`authenticated` may EXECUTE (`00002510`) because it stamps the voter and rate-limits by itself.
Operators read votes as the service role.

Verified by `supabase/probes/help_centre.sql`: both client roles are refused `42501` on SELECT,
INSERT, UPDATE and DELETE.

## Feedback board

RLS is on for all three tables (`00002001` [community.feedback]); policies in `00002021`
[community.feedback]; column grants in `00002520` [community.feedback]. Reads only — every write is
a definer door. Visibility is ONE rule, stated three times and pinned by
`supabase/probes/feedback_board.sql`: these policies, `community.fn_feedback_idea_visible` (the
doors') and `canSeeFeedbackIdea` (`@projective/types/community`, the fixture road).

| Table                    | Policy                         | Roles                   | Rule                                                                                                  |
| :----------------------- | :----------------------------- | :---------------------- | :---------------------------------------------------------------------------------------------------- |
| `feedback_ideas`         | `feedback_ideas_public_read`   | `anon`, `authenticated` | `status IN ('ready', 'in_progress', 'complete')` — Planned, In progress and Shipped are public.       |
| `feedback_ideas`         | `feedback_ideas_author_read`   | `authenticated`         | `status = 'backlog' AND author_id = auth.uid()` — an idea under review is its author's alone.         |
| `feedback_ideas`         | `feedback_ideas_operator_read` | `authenticated`         | `security.is_admin()` — operators (`ops.admin_users`) read everything, Archived included.             |
| `feedback_votes`         | `feedback_votes_own_read`      | `authenticated`         | `user_id = auth.uid()` — a vote is its owner's.                                                       |
| `feedback_status_events` | `feedback_status_events_read`  | `anon`, `authenticated` | `EXISTS` the idea under the caller's own idea policies — a history is exactly as visible as its idea. |

The idea policies are split by role rather than OR-ed into one, because `anon` holds no USAGE on
`security`: a policy naming `security.is_admin()` for `anon` would error rather than deny.

**Column grants.** `SELECT` on `feedback_ideas` (every column but `pii_categories` and
`team_response_by`) and `feedback_status_events` (every column but `actor_id` and `note`) to `anon`
and `authenticated`; `SELECT (idea_id, user_id, created_at)` on `feedback_votes` to `authenticated`
only. No client INSERT, UPDATE, DELETE or TRUNCATE on any of them.
