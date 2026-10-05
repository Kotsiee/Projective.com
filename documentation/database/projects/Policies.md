# projects: Policies

RLS policies for the `projects` schema. Tables: [Tables.md](Tables.md) · Functions:
[Functions.md](Functions.md).

Declared in `00002001_policies_enable_rls.sql` (the `ENABLE ROW LEVEL SECURITY` statements) and
`00002011_policies_projects.sql` (the policies themselves).

**All 28 `projects` tables have RLS enabled and at least one policy — 60 policies in total**, every one
in `00002011` (no other migration creates or drops a `projects` policy). Privileges sit underneath:
`00002500` grants `ALL` (minus `TRUNCATE`) on every table to `authenticated`, and `00002520` grants
`anon` `SELECT` on six only — `projects`, `project_stages`, `stage_staffing_roles`,
`stage_open_seats`, `stage_open_seat_skills`, `project_required_skills`. So a `TO public` policy on
any other table admits a guest in name only: `anon` is refused by privilege before RLS runs. Roles
below are `public` unless stated.

---

## The predicates everything is built on

Four `SECURITY DEFINER` helpers carry almost every decision in this schema, so the definition of
"involved" lives in one place rather than being restated in thirty policies. They are
`SECURITY
DEFINER` for the usual reason: a policy that re-enters another policy is at best a
performance cliff and at worst a recursion error.

| Function                            | True when                                                                                                          |
| :---------------------------------- | :----------------------------------------------------------------------------------------------------------------- |
| `projects.has_project_access(uuid)` | Owner · freelancer participant · business participant · stage assignee · active member of an assigned team. An assignment counts only while it is not `declined` / `cancelled` / `released` (since 2026-09-28 — [Functions.md](Functions.md#access-predicates)). |
| `projects.has_stage_access(uuid)`   | The paying side (owner / active client-business member), or live talent assigned to **that stage**.                |
| `projects.can_review_project(uuid)` | Owner, or an active member of the paying client business. The "client viewer" authority.                           |
| `projects.is_protected_phase(uuid)` | The project is before its Projective Unlock. Defaults **true** for an unknown id, so the PII filter fails to mask. |

---

## ⚠️ Five holes this domain's policies close

`projects.ticket_history`, `projects.user_preferences`, `projects.project_required_skills` and
`projects.project_invitations` were defined in `00000015` and **never named in `00002001`**, so RLS
was OFF on all four — while `00002500` grants
`ALL ON ALL TABLES IN SCHEMA projects TO
authenticated`. RLS off plus a blanket grant is not weak
protection, it is none, and each one cost something different:

- **`ticket_history`** — the ticket audit log was forgeable and erasable by anyone with an account.
  An audit trail anyone can edit is worse than none, because it is still believed.
- **`user_preferences`** — every user's starred / archived / last-viewed state was world-readable
  and world-writable.
- **`project_required_skills`** — the staffing requirement list, editable by anyone on any project.
  It is what proposals are matched and filtered on, so an outside edit changes who a project appears
  to want.
- **`project_invitations`** — exposed `token`, which that table's own comment calls the capability.
  Whoever reads it can accept, so this was direct project-access **escalation**, not a disclosure.

The fifth, **`projects.project_attachments`**, WAS named in `00002001` and still had no policy —
which fails the opposite way and is why it went unnoticed for longer. Nothing leaked, because
nothing could be read: default-deny on a table only a `SECURITY DEFINER` function writes meant
`projects.create_project` faithfully stored every brief, reference and mood board a client attached
to a new engagement, and then nobody — not the owner, not a participant, not the uploader — could
ever read one back. The attachment step of the create wizard was a control that rendered, accepted
files, reported success and reached nothing (root `CLAUDE.md` §3 gate 11), with no error anywhere to
say so.

That is the shape of every hole in this section and the reason none of them announced themselves: a
default-deny `SELECT` returns **`200 []`**, never an error. It is indistinguishable from an empty
account.

Same class as the five `comms` tables closed in Decision #83. `TRUNCATE` is revoked from
`authenticated` for the whole schema alongside them (`00002500`): `GRANT ALL` includes it and
`TRUNCATE` is not row-level, so a caller who cannot `SELECT` one row of the audit log could
otherwise discard the table.

---

## Core project surface

### `projects.projects`

| Policy                              | Command  | Rule                                                           |
| :---------------------------------- | :------- | :------------------------------------------------------------- |
| _Users can view own projects_       | `SELECT` | `auth.uid() = owner_user_id`                                   |
| _Public can view active published…_ | `SELECT` | `status = 'active' AND visibility = 'public'`                  |
| _Participants can view their…_      | `SELECT` | `projects.has_project_access(id)`                              |
| _Users can create projects_         | `INSERT` | `auth.uid() = owner_user_id`                                   |
| _Users can update own projects_     | `UPDATE` | `USING` **and** `WITH CHECK` both `auth.uid() = owner_user_id` |
| _Users can delete own projects_     | `DELETE` | `auth.uid() = owner_user_id`                                   |

_Participants can view their projects_ is `TO authenticated`; the other five are `TO public`.

⚠️ **A missing `WITH CHECK` on an `UPDATE` policy is NOT a hole by itself.** Postgres uses the
policy's `USING` expression as its `WITH CHECK` when none is written, so
`USING (auth.uid() = owner_user_id)` alone already refused
`UPDATE projects.projects SET owner_user_id = <someone else>`. Verified by reconstructing the
`USING`-only form and attempting exactly that:

```
ERROR:  new row violates row-level security policy for table "projects"
```

The arm is written out because a reader should not have to know that defaulting rule to see that the
post-image is constrained — but it changed no behaviour.

This matters for the eleven remaining `USING`-only `FOR ALL` policies in this schema
(`project_stages`, `stage_assignments`, `stage_staffing_roles`, `stage_open_seats`,
`project_participants`, `cohorts`, `cohort_memberships`, `session_events`, `maintenance_contracts`,
`stage_revision_requests`, `stage_budget_rules` — `project_application_targets` has only a `SELECT`
policy; the SQL comment's "twelve" counts it) plus the `USING`-only `UPDATE` _Manage waitlists_: **do not treat them
as open on the strength of a missing `WITH CHECK`.** Each may still deserve a NARROWER post-image
predicate than its `USING` — that is a per-table judgement about which columns a caller may move a
row across — but the default is a mirror, not an absence.

⚠️ The same claim appears at `00002011:524` for `files.items` (Decision #67) and reads as false for
the same reason. It is another pass's record and is flagged here rather than rewritten; the
`WITH CHECK` it added is still correct and still worth keeping, because repointing
`bucket_id`/`storage_path` genuinely does need a post-image predicate — only the "donation" half of
its rationale is wrong.

⚠️ **_Participants can view their projects_ is the arm the read API depends on.** Until it existed
the only two SELECT paths were "I own it" and "it is active AND public", so a freelancer hired onto
a private project could not read the project row at all, and every dependent read (detail, board,
members, files, submissions) inherited the hole because each resolves the project first.

⚠️ The policies are **OR-ed**, and one of them is `"Public can view active published projects"`. RLS
answers _"may I see this"_, not _"am I working on this"_ — so a feed that means the latter must
scope on involvement itself rather than leaning on RLS (Decision #82).

### `projects.project_stages`

`SELECT` for the owner, for a publicly-visible active project, or via
`projects.has_project_access(project_id)`. `FOR ALL` management for the project owner.

| Policy                                      | Command  | Rule                                                              |
| :------------------------------------------ | :------- | :---------------------------------------------------------------- |
| _Users can view stages of visible projects_ | `SELECT` | Project owner, or project `status = 'active' AND visibility = 'public'`. |
| _Participants can view stages_              | `SELECT` | `projects.has_project_access(project_stages.project_id)`          |
| _Users can manage stages of own projects_   | `ALL`    | Project owner (`USING` only; reused as the check).                |

A direct `DELETE` under the third policy fires `trg_stage_delete_cascade`, which releases the escrow of
every ticket still in the stage ([Functions.md](Functions.md#projectsfn_stage_delete_cascade--trigger)).

---

## Execution & deliverables

### `projects.tickets`

| Policy           | Command  | Rule                                                                                         |
| :--------------- | :------- | :------------------------------------------------------------------------------------------- |
| _View tickets_   | `SELECT` | Assignee · owner · project access or public-active — the latter two minus `reported_hidden`. |
| _Manage tickets_ | `ALL`    | `current_assignee_id = auth.uid()` or project owner, on **both** arms.                       |

A ticket suspended inside an active workload-report window (`status = 'reported_hidden'` and
`hidden_until > now()`) stays visible to its assignee and the owner and is hidden from everyone
else. Column-level immutability once claimed is enforced by `projects.fn_ticket_immutability_guard`,
not by a policy.

🚨 **_Manage tickets_ admits the assignee to `UPDATE` and `DELETE`, and both are money-moving.**
Entering `status = 'completed'` fires `trg_ticket_escrow_sync` and a delete fires
`trg_ticket_delete_protocol`; each releases the ticket's held escrow to its payee. So the policy alone
let an assignee pay themselves with one `PATCH`/`DELETE` and no RPC. A policy cannot express "this
column may not move to this value", so the rule lives in `trg_ticket_authority_guard`
(`projects.fn_ticket_settlement_guard`, [Functions.md](Functions.md#escrow-settlement-doors)): entering
`completed`, or deleting, requires `projects.can_review_project`; a `NULL` `auth.uid()` (service role,
cron) is not gated. The assignee cannot clear their own `current_assignee_id` either — the policy's
`WITH CHECK` refuses the post-image (verified by execution) — so the unassign-release arm of
`trg_ticket_escrow_sync` is reachable only through definer paths (owner removal, workload report).

The RPC doors that settle escrow (`complete_ticket`, `delete_ticket`, `force_complete_stage`,
`approve_stage`, `cancel_stage_fair_exit`) are `SECURITY DEFINER` and bypass this policy entirely;
their authority is their own body guard plus an `authenticated`-only `EXECUTE` grant
([Functions.md](Functions.md#escrow-settlement-doors)).

### `projects.stage_submissions`

| Policy                   | Command  | Rule                                                                              |
| :----------------------- | :------- | :-------------------------------------------------------------------------------- |
| _View submissions_       | `SELECT` | Submitter · project access · project owner · active client-business member.       |
| _Insert own submissions_ | `INSERT` | `submitted_by = auth.uid()` **AND** `projects.has_stage_access(project_stage_id)` |
| _Submit own draft submissions_ | `UPDATE` (`TO authenticated`) | `USING (submitted_by = auth.uid() AND status = 'draft')` · `WITH CHECK (submitted_by = auth.uid() AND status = 'pending_review')` |

The `UPDATE` policy is the only client path that moves a submission: its own author sending a
`draft` for review. The two arms differ on purpose — a `USING`-only form would let the post-image stay
a draft (silent edits after the fact) — and the verdict (`accepted` / `revisions_requested`) belongs
to `projects.review_submission` alone. There is no client `DELETE`.

⚠️ **The stage-access arm is load-bearing.** `submitted_by = auth.uid()` proves only that the row is
not being attributed to somebody else; it says nothing about _where_ the row lands, so any
authenticated caller could file a deliverable against any stage id they had ever seen. A submission
is not inert — it appears in the client's review queue and `projects.review_submission` drives stage
approval from there. Stage ids leak legitimately (a freelancer released from a stage keeps every id
they worked with), so unguessability was never the protection.

### `projects.submission_files`

| Policy                            | Command  | Rule                                                         |
| :-------------------------------- | :------- | :----------------------------------------------------------- |
| _View submission files_           | `SELECT` | Submitter · project access · owner · client-business member. |
| _Attach files to own submissions_ | `INSERT` | The parent submission's `submitted_by = auth.uid()`.         |
| _Detach files from own…_          | `DELETE` | Same predicate.                                              |

This table had `SELECT` and nothing else, so a submission could be read with its files and never
created with them — the write path existed only inside `projects.submit_deliverable`'s definer
context. Authority is the **parent submission's author**, not project access: a deliverable is a
claim about what one person delivered, so letting a third party attach to it would let them alter
the evidence a client reviews and a dispute is settled against. `DELETE` removes only the **link**;
the `files.items` row is untouched and stays in the submitter's library, so this is not the hard
deletion root `CLAUDE.md` §7 forbids.

---

## Audit log, preferences, requirements, invitations

### `projects.ticket_history` — readable by the project, written by nobody

`SELECT` where the ticket's project passes `projects.has_project_access`. **No `INSERT`, `UPDATE` or
`DELETE` policy, deliberately.**

Every row is written by a `SECURITY DEFINER` RPC, which bypasses RLS, so the table stays fully
writable by the paths that are supposed to write it. A client write path could only ever be a
forgery route: _"this ticket was moved to Done by X"_ is a server observation, not a claim a browser
gets to make, and being able to delete the entry recording what really happened is worse, because
the timeline is read as evidence. Same discipline as `comms.notifications` (Decision #57) and
`files.download_events`.

Scoped to the ticket's **project** rather than to the actor: a timeline showing a reader only their
own moves would misrepresent the history it is drawn as.

### `projects.user_preferences`

`FOR ALL` on `user_id = auth.uid()`, with **both** arms written out. `FOR ALL` applies a single
expression to `USING` and `WITH CHECK` only when both are present; with `USING` alone a caller could
take their own row and rewrite `user_id` to somebody else's in the same statement, silently starring
a project on another account.

### `projects.project_required_skills`

| Policy                          | Command  | Rule                                      |
| :------------------------------ | :------- | :---------------------------------------- |
| _View required skills_          | `SELECT` | `projects.has_project_access(project_id)` |
| _Owner manages required skills_ | `ALL`    | Project owner, on both arms.              |
| _Public projects advertise their required skills_ | `SELECT` (`TO anon, authenticated`) | Project `status = 'active' AND visibility = 'public'`. |

The first two are `TO authenticated`. The third is the guest-facing half: an open project's
requirement list is what it is recruiting for, while a draft's stays as private as the draft.

### `projects.project_invitations`

| Policy                                 | Command  | Rule                                                                                                            |
| :------------------------------------- | :------- | :-------------------------------------------------------------------------------------------------------------- |
| _View invitations as owner or invitee_ | `SELECT` | Project owner, **or** `target_user_id = auth.uid()`, **or** `target_email` matches one of the caller's own **verified** `org.user_emails` rows (`verified_at IS NOT NULL`, case-insensitive). |
| _Owner manages invitations_            | `ALL`    | Project owner on both arms, and `inviter_user_id = auth.uid()` on the check.                                    |

🚨 **Never a blanket read.** `token` is the capability: whoever holds the value can accept and be
granted the role the row names. RLS is row-level, so a policy that admits a row admits its token,
and there is no column-level fallback while `00002500` grants the whole table to `authenticated`. A
permissive `SELECT` here is not a disclosure of who was invited, it is a grant of project access to
everyone with an account.

Two readers, and only two. An EMAIL-addressed invitee may have had no account at invite time, so
that identity join goes through `org.user_emails`. Its own-rows-only policy does **not** protect this
join: `org.user_emails` has a client `INSERT` policy, so any caller can add an arbitrary address to
their own row, and without the `verified_at IS NOT NULL` arm asserting the invited address was enough
to read `token`. Only a verified address matches. An
IDENTITY-addressed invitee (a hire from a profile, Decision #108) reads their own row through
`target_user_id = auth.uid()` with no join at all — and only their own, because that column is a
FK the owner wrote, not a value the reader can assert. Verified by execution: the invitee sees
exactly their identity-addressed rows and not the project's email-addressed ones; a stranger sees
zero. Compared case-insensitively, because an email address is: an invitation that silently fails
to match its own recipient is indistinguishable from one that was never sent.

---

## Staffing, applications, sessions

| Table                                     | Read                                                     | Write                                       |
| :---------------------------------------- | :------------------------------------------------------- | :------------------------------------------ |
| `projects.stage_assignments`              | Owner, or public-active project.                         | Owner (`FOR ALL`).                          |
| `projects.stage_open_seats`               | Owner, or public-active project.                         | Owner (`FOR ALL`).                          |
| `projects.stage_open_seat_skills`         | Project access, or any `active` project.                 | Definer RPCs only.                          |
| `projects.stage_staffing_roles`           | Owner, or public-active project.                         | Owner (`FOR ALL`).                          |
| `projects.stage_budget_rules`             | Owner, or public-active project.                         | Owner (`FOR ALL`).                          |
| `projects.project_participants`           | Owner, or public-active project.                         | Owner (`FOR ALL`).                          |
| `projects.project_applications`           | The applicant, or `can_review_project`.                  | Definer RPCs only.                          |
| `projects.project_application_targets`    | Follows the parent application.                          | Definer RPCs only.                          |
| `projects.stage_revision_requests`        | Requester, or project owner.                             | Requester (`FOR ALL`).                      |
| `projects.ticket_workload_reports`        | Reporter, project owner, or project access.              | `INSERT` by the assignee only.              |
| `projects.project_activity`               | Project owner.                                           | `INSERT` as self.                           |
| `projects.project_status_history`         | Actor, project access, owner, or client-business member. | Definer RPCs only.                          |
| `projects.cohorts`                        | Member (arm broken — see Findings), owner, or a project with `visibility = 'public'` (any status). | Owner (`FOR ALL`).                          |
| `projects.cohort_memberships`             | Self, or the cohort's project owner.                     | Owner (`FOR ALL`).                          |
| `projects.session_events`                 | Cohort member (arm is a tautology — see Findings), or project owner. | Owner (`FOR ALL`).                          |
| `projects.session_attendance`             | Self, or project owner.                                  | `INSERT` as self.                           |
| `projects.waitlists`                      | Self, or the blueprint's freelancer.                     | Join/leave as self; either side may update. |
| `projects.maintenance_contracts`          | Freelancer or project owner (`FOR ALL`).                 | Same.                                       |
| `projects.project_attachments`            | `has_project_access(project_id)`.                        | Owner `INSERT` / `DELETE`; no `UPDATE`.     |

Policy names, in table order: _View assignments_ / _Owner manage assignments_; _View seats public or
own_ / _Manage seats own_; _View seat skills_; _View roles public or own_ / _Manage roles own_; _View
budget rules_ / _Owner manage budget rules_; _View participants_ / _Owner manage participants_; _View
own or owned applications_; _View application targets_; _View revisions_ / _Manage own revisions_;
_View workload reports_ / _File workload report_; _Project owner can view activity_ / _Users can
insert their own activity_; _View project status history_; _View cohorts_ / _Manage cohorts_; _View
cohort memberships_ / _Manage cohort memberships_; _View session events_ / _Manage session events_;
_View own attendance_ / _Log own attendance_; _View waitlists_ / _Join waitlist_ / _Manage waitlists_
(`UPDATE`) / _Leave waitlist_ (`DELETE`); _Users can view/manage own contracts_; and the three
attachment policies below. The public-active read arms are `status = 'active' AND visibility =
'public'`; _View seat skills_ is wider — project access **or any `active` project** whatever its
visibility. `project_activity`'s `INSERT` checks only `auth.uid() = actor_user_id`, with no project
predicate (see Findings).

### `projects.project_attachments`

| Policy                              | Command                       | Rule                                      |
| :---------------------------------- | :---------------------------- | :---------------------------------------- |
| _View project attachments_          | `SELECT` (`TO authenticated`) | `projects.has_project_access(project_id)` |
| _Owner attaches project references_ | `INSERT` (`TO authenticated`) | `WITH CHECK` project owner                |
| _Owner detaches project references_ | `DELETE` (`TO authenticated`) | Project owner                             |

Scoped to project access rather than to the uploader, because an attachment is project context — it
is what the brief refers to — and a freelancer who cannot open the reference a stage description
cites has the stage and not the work. The join row carries nothing beyond the pair, and
`files.items` keeps its own policy, so this admits the **relationship** while the file's own rules
still decide whether the bytes can be fetched.

Writes are the **owner's** alone, narrower than the read: a participant adds to the work through
`stage_submissions`, where a deliverable is versioned and reviewed, not to the client's brief. Split
into `INSERT` and `DELETE` because every column is part of the primary key, so there is no `UPDATE` to
grant. Detaching removes only the link; the `files.items` row stays in the owner's library.
`projects.create_project` still writes the initial set under `SECURITY DEFINER`. (This section
previously said the table was `SELECT`-only with writes through definer RPCs; `00002011` now carries
the two owner write policies above.)

---

## Known gaps (surface, do not silently resolve)

- ~~**`anon` has no `USAGE` on schema `projects`**~~ — resolved: `00002500` grants it (Decision
  #85(e)) so the nine `FOR SELECT TO public` policies reach guests. The consequence for functions:
  Postgres grants `EXECUTE` to `PUBLIC` by default and `projects` has no schema-wide revoke, so
  **every `projects` function without an explicit `REVOKE` in `00002510` (or beside its definition in
  `00001100` / `00001130`) is callable by `anon`**.
  A `SECURITY DEFINER` function in this schema must either refuse a `NULL` `auth.uid()` itself or
  carry a `REVOKE … FROM PUBLIC, anon` (the settlement doors now do both).
- Several older `FOR ALL` policies carry a `USING` clause and **no `WITH CHECK`**
  (`stage_assignments`, `stage_budget_rules`, `stage_open_seats`, `project_participants`,
  `stage_staffing_roles`, `project_stages`, `cohorts`, `cohort_memberships`, `session_events`,
  `maintenance_contracts`, `stage_revision_requests`). As the `projects.projects` note above
  verifies, Postgres reuses `USING` as the post-image check, so an `UPDATE` cannot move a row out of
  the tenancy `USING` validated — these are not open. Each may still deserve a narrower post-image
  predicate, and needs its own read before being tightened, because that predicate is not always
  simply the pre-image one.
- `projects.stage_submissions.status` is nullable `text` with a NULL-tolerant CHECK, and the DB
  spelling is plural `revisions_requested` against the Zod singular. `live-support.ts` reconciles it
  — use `toSubmissionStatus`, never a cast.

---

## Findings

Audit of 2026-10-05 against the working tree. Reported here; **no SQL was changed**.

**RLS coverage — clean.** Every one of the 28 tables has `ENABLE ROW LEVEL SECURITY` in `00002001`
and at least one policy in `00002011`; none is RLS-off and none is RLS-on with zero policies.

| Table                         | Policies | Table                       | Policies |
| :---------------------------- | -------: | :-------------------------- | -------: |
| `projects`                    |        6 | `stage_submissions`         |        3 |
| `project_stages`              |        3 | `submission_files`          |        3 |
| `tickets`                     |        2 | `ticket_history`            |        1 |
| `ticket_workload_reports`     |        2 | `user_preferences`          |        1 |
| `project_required_skills`     |        3 | `project_invitations`       |        2 |
| `project_attachments`         |        3 | `project_participants`      |        2 |
| `stage_assignments`           |        2 | `stage_open_seats`          |        2 |
| `stage_open_seat_skills`      |        1 | `stage_staffing_roles`      |        2 |
| `stage_budget_rules`          |        2 | `stage_revision_requests`   |        2 |
| `project_applications`        |        1 | `project_application_targets` |      1 |
| `project_activity`            |        2 | `project_status_history`    |        1 |
| `cohorts`                     |        2 | `cohort_memberships`        |        2 |
| `session_events`              |        2 | `session_attendance`        |        2 |
| `waitlists`                   |        4 | `maintenance_contracts`     |        1 |

Tables whose only writes are definer functions (no client write policy, by design): `ticket_history`,
`project_applications`, `project_application_targets`, `stage_open_seat_skills`,
`project_status_history`.

**Policy defects.**

1. 🚨 **_View session events_ is open to any cohort member on the platform.** Its member arm is
   `EXISTS (SELECT 1 FROM projects.cohort_memberships cm WHERE cm.cohort_id = cohort_id AND cm.user_id =
   auth.uid())`. `cohort_memberships` has its own `cohort_id` column, so the unqualified `cohort_id`
   binds to `cm.cohort_id` and the join is a tautology: a caller with **any** cohort membership reads
   **every** `session_events` row, `host_join_url` and `attendee_join_url` included. Needs
   `cm.cohort_id = session_events.cohort_id`.
2. **_View cohorts_' member arm can never match.** `cm.cohort_id = id` binds `id` to `cm.id`. Fails
   closed (members just cannot see their cohort unless the project is public or theirs) — the
   opposite failure of #1, same cause. Its public arm checks `visibility = 'public'` with no `status`
   test, unlike every other public arm in the schema.
3. **_Users can insert their own activity_ has no project predicate.** `WITH CHECK (auth.uid() =
   actor_user_id)` lets any signed-in caller write `project_activity` rows into **any** project's feed
   under their own name. The owner reads that feed.
4. The public-project read arms on `stage_assignments`, `stage_budget_rules`, `project_participants`,
   `tickets` and `cohorts` never reach a guest: `anon` holds `SELECT` on
   only six tables (top of this page). Not a hole — but the policy text overstates who can read.

**Functions callable by `anon` that write data** (default `PUBLIC` `EXECUTE`, `SECURITY DEFINER`, no
`auth.uid()` test — details in [Functions.md](Functions.md)):

- 🚨 `projects.fn_assign_ticket_core(uuid, uuid, boolean)` and `projects.claim_ticket(uuid, uuid)` —
  attach **any** user to an unclaimed ticket (the core on any stage, `claim_ticket` on `open_pull`
  stages) and hold the client's escrow against them; `p_enforce_capacity = false` skips the cap.
- 🚨 `projects.fn_flag_bad_faith_report(uuid)` — dismisses a workload report and writes a
  `security.penalties` row against its reporter.
- 🚨 `projects.fn_archive_stale_service_drafts(timestamptz)` — caller-supplied `p_now`; a far-future
  value soft-archives every un-funded instantiated draft platform-wide.
- `projects.fn_resolve_expired_workload_reports()` — runs the expiry sweep (writes penalties), but
  only for genuinely expired reports.

Every other `anon`-reachable writer refuses a `NULL` `auth.uid()` or fails its owner /
`can_review_project` / `has_project_access` test for a guest.

**Functions with no caller check that `authenticated` (and `anon`) can call** — reads that bypass the
table policies by id:

- 🚨 `projects.get_stage_details(uuid, uuid)` — a stage's brief, budget, assignee and latest
  submission notes for any (project, stage) pair.
- `projects.get_stage_staffing(uuid, uuid)` checks access to `p_project_id` but never that
  `p_stage_id` is in it — any project member reads any stage's seats, applicants and cover notes.
- `projects.fn_serialize_submission`, `fn_serialize_application`, `fn_serialize_seat` — any row by id.
- `projects.get_workload_capacity`, `check_ticket_capacity` — any user's workload figures.
- `projects.fn_stage_window`, `fn_assignee_slot_conflict`, `is_protected_phase` — low-value oracles.

The guarded definers with no explicit grant (`create_stage`, `delete_stage`, `reorder_stages`,
`move_ticket`, `set_project_status`, `fund_stage`, `submit_deliverable`, `review_submission`,
`assign_from_application`, `create_stage_open_seat`, `apply_to_seat`, the routing RPCs and the
guarded read models) are safe on their body checks alone; narrowing them to `authenticated` would match the
settlement doors' defence in depth.
