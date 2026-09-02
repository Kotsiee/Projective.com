# projects: Policies

RLS policies for the `projects` schema. Tables: [Tables.md](Tables.md) · Functions:
[Functions.md](Functions.md).

Declared in `00002001_policies_enable_rls.sql` (the `ENABLE ROW LEVEL SECURITY` statements) and
`00002011_policies_projects.sql` (the policies themselves).

---

## The predicates everything is built on

Four `SECURITY DEFINER` helpers carry almost every decision in this schema, so the definition of
"involved" lives in one place rather than being restated in thirty policies. They are
`SECURITY
DEFINER` for the usual reason: a policy that re-enters another policy is at best a
performance cliff and at worst a recursion error.

| Function                            | True when                                                                                                          |
| :---------------------------------- | :----------------------------------------------------------------------------------------------------------------- |
| `projects.has_project_access(uuid)` | Owner · freelancer participant · business participant · stage assignee · active member of an assigned team.        |
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

This matters for the twelve remaining `USING`-only `FOR ALL` policies in this schema
(`project_stages`, `stage_assignments`, `stage_staffing_roles`, `stage_open_seats`,
`project_participants`, `cohorts`, `cohort_memberships`, `session_events`, `maintenance_contracts`,
`stage_revision_requests`, `stage_budget_rules`, `project_application_targets`): **do not treat them
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

### `projects.stage_submissions`

| Policy                   | Command  | Rule                                                                              |
| :----------------------- | :------- | :-------------------------------------------------------------------------------- |
| _View submissions_       | `SELECT` | Submitter · project access · project owner · active client-business member.       |
| _Insert own submissions_ | `INSERT` | `submitted_by = auth.uid()` **AND** `projects.has_stage_access(project_stage_id)` |

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

### `projects.project_invitations`

| Policy                                 | Command  | Rule                                                                                                            |
| :------------------------------------- | :------- | :-------------------------------------------------------------------------------------------------------------- |
| _View invitations as owner or invitee_ | `SELECT` | Project owner, **or** `target_email` matches one of the caller's own `org.user_emails` rows (case-insensitive). |
| _Owner manages invitations_            | `ALL`    | Project owner on both arms, and `inviter_user_id = auth.uid()` on the check.                                    |

🚨 **Never a blanket read.** `token` is the capability: whoever holds the value can accept and be
granted the role the row names. RLS is row-level, so a policy that admits a row admits its token,
and there is no column-level fallback while `00002500` grants the whole table to `authenticated`. A
permissive `SELECT` here is not a disclosure of who was invited, it is a grant of project access to
everyone with an account.

Two readers, and only two. The invitee is addressed by email precisely because at invite time they
may have no account, so the identity join goes through `org.user_emails` — which carries its own
own-rows-only policy, making the `user_id = auth.uid()` filter belt and braces rather than the only
guard. Compared case-insensitively, because an email address is: an invitation that silently fails
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
| `projects.cohorts` / `cohort_memberships` | Member, owner, or public project.                        | Owner (`FOR ALL`).                          |
| `projects.session_events`                 | Cohort member, or project owner.                         | Owner (`FOR ALL`).                          |
| `projects.session_attendance`             | Self, or project owner.                                  | `INSERT` as self.                           |
| `projects.waitlists`                      | Self, or the blueprint's freelancer.                     | Join/leave as self; either side may update. |
| `projects.maintenance_contracts`          | Freelancer or project owner (`FOR ALL`).                 | Same.                                       |
| `projects.project_attachments`            | `has_project_access(project_id)`.                        | Definer RPCs only.                          |

### `projects.project_attachments`

`View attachments of accessible projects` —
`SELECT TO authenticated USING
(projects.has_project_access(project_id))`.

Scoped to project access rather than to the uploader, because an attachment is project context — it
is what the brief refers to — and a freelancer who cannot open the reference a stage description
cites has the stage and not the work. The join row carries nothing beyond the pair, and
`files.items` keeps its own policy, so this admits the **relationship** while the file's own rules
still decide whether the bytes can be fetched.

`SELECT` only. Every write goes through `projects.create_project`, which is `SECURITY DEFINER` and
bypasses RLS, so the table stays fully writable by the path that is supposed to write it. A client
`INSERT` policy could only ever be a route to attach an arbitrary `files.items` id to somebody
else's project — a disclosure dressed as a reference. Same discipline as `ticket_history`.

---

## Known gaps (surface, do not silently resolve)

- **`anon` has no `USAGE` on schema `projects`**, yet nine `FOR SELECT TO public` policies exist and
  are written for exactly that visitor. Either the policies or the grant is wrong; granting it is an
  exposure decision, not a cleanup.
- Several older `FOR ALL` policies carry a `USING` clause and **no `WITH CHECK`**
  (`stage_assignments`, `stage_budget_rules`, `stage_open_seats`, `project_participants`,
  `stage_staffing_roles`, `project_stages`, `cohorts`, `cohort_memberships`, `session_events`,
  `maintenance_contracts`, `stage_revision_requests`). That is the same shape as the
  `projects.projects` defect fixed above: an `UPDATE` can move a row out of the tenancy that the
  `USING` clause just validated. Each needs its own read before being tightened, because the
  post-image predicate is not always simply the pre-image one.
- `projects.stage_submissions.status` is nullable `text` with a NULL-tolerant CHECK, and the DB
  spelling is plural `revisions_requested` against the Zod singular. `live-support.ts` reconciles it
  — use `toSubmissionStatus`, never a cast.
