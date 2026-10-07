# org Schema: Policies

Row-Level Security (RLS) in the `org` schema ensures that identity data, profile settings, and team
configurations are isolated and protected. Access is primarily governed by the `auth.uid()` of the
requester and helper functions that verify administrative or membership status.

## 🛡️ Security Helpers

These functions are used throughout the policies to provide a clean and consistent authorization
layer.

- **`security.is_admin()`**: Returns true if the `auth.uid()` exists in `ops.admin_users`.
- **`org.is_active_team_member(_team_id)`** / **`org.is_active_business_member(_business_id)`**:
  `SECURITY DEFINER`; true if `auth.uid()` holds an `active` row in `org.team_members` /
  `org.business_members` for that entity. These (with `is_organisation_member`) are the only `org`
  functions `anon` and `authenticated` may still `EXECUTE` besides the named RPCs — a policy
  expression runs as the invoking role, and `EXECUTE` on the rest of the schema is revoked
  (`00002510`, 2026-09-28; [Functions.md](Functions.md)).
- **`org.is_organisation_member(p_org, p_min_role)`**: `SECURITY DEFINER`; returns true if the
  `auth.uid()` is an active member of the organisation at or above `p_min_role`
  (`member`/`admin`/`owner`). Definer context bypasses RLS so the organisation policies below don't
  recurse. See `org/Functions.md`.

---

## 👤 User & Profile Policies

### `org.users_public`

Controls visibility of basic user identity. **There is no client write policy.**

```sql
-- SELECT: Any authenticated user can view public profiles
CREATE POLICY "Any authenticated user can view public profiles" 
ON org.users_public FOR SELECT TO public 
USING (auth.role() = 'authenticated');
```

The row holds the few fields an owner edits (name, headline, story, location, visibility) beside
columns nobody may set about themselves — `rating_average`/`rating_count`, the project counters,
`is_freelancer`/`is_operator`/`has_team`/`has_business`, `dob`, `avatar_file_id`. A row-level
policy cannot tell one column from another, so the former own-row `FOR ALL` policy let any signed-in
user PATCH their own rating to 5.00. Every legitimate writer is a `SECURITY DEFINER` function:
provisioning and onboarding, `org.save_profile` (the profile editor — it names every column it
touches), `org.set_profile_avatar` (checks the file is the caller's own), and the rating/counter
triggers. Reading another person's name and photo goes through `org.get_party_cards`.

### `org.freelancer_profiles`

Protects seller-specific data and professional settings. **SELECT only, owner or admin.**

```sql
CREATE POLICY "Users can view their own freelancer profile"
ON org.freelancer_profiles FOR SELECT TO public
USING (user_id = auth.uid() OR security.is_admin());
```

No client INSERT or UPDATE policy, for the `users_public` reason with higher stakes: the row holds
`kyc_status`, `kyc_tier`, `payout_ready` and `max_workload_intensity` — the payout-readiness gate and
the capacity cap. The former own-row policy let a freelancer mark themselves KYC-verified and
payout-ready over PostgREST. The row is created and maintained by definers; `skills` and
`hire_intake` are written through `org.save_profile`.

### `org.business_profiles`

**RLS is on with no policy at all** — default-deny to every client, reads included. Every read of a
business goes through a definer (the profile view `org.get_profile_view`, the discovery reads, the
console's `org.get_workspace_detail`) and every write through `org.create_workspace` /
`org.update_workspace` / `org.set_workspace_status` / `org.transfer_workspace_ownership` /
`org.save_profile` / `org.set_profile_avatar`. A
consequence worth knowing: an RLS-scoped read of `org.business_profiles` returns nothing, so the
project detail's business parties (`live-detail.ts`) degrade to "Unknown" on the live path.

### `org.user_emails`

**SELECT only, owner or admin — no client write policy** (2026-10-06).

```sql
CREATE POLICY "Users can view their own emails"
ON org.user_emails FOR SELECT TO authenticated
USING (user_id = auth.uid() OR security.is_admin());
```

This section used to document a single own-row `FOR ALL` policy; what was actually migrated was four
`TO public` policies — SELECT, INSERT (`WITH CHECK` own row), UPDATE (own row, **no** `WITH CHECK`) and
DELETE — under the schema-wide `GRANT ALL`. Either way a signed-in user could INSERT somebody else's
address with `verified_at` already set, or UPDATE it onto a row they had, and `verified_at` is what the
`projects.project_invitations` SELECT policy, `org.fn_is_invitee` and `projects.invite_by_email` trust:
it read and accepted invitations meant for that person. The three write policies are gone,
`INSERT`/`UPDATE`/`DELETE` are revoked from `anon`/`authenticated` (`00002520`), and every write is a
definer — provisioning, `public.handle_email_confirmed`, and the `00001050` email functions, where a
secondary address is verified only by redeeming a token mailed to it
([Functions.md](Functions.md#-email-addresses-00001050)). `org.trg_user_emails_guard` refuses a client
write to `verified_at` / `email` / `is_primary` / `user_id` should a grant or policy ever return.

### `org.email_verification_tokens`

**RLS on, no policy at all, no client grant** — definer-only. Only `org.confirm_user_email` and
`security.issue_email_verification` (service role) touch it; a row holds only a token's SHA-256.

---

## 🧑‍🤝‍🧑 Team & Membership Policies

### `org.teams`

Governs access to micro-agency data.

```sql
-- SELECT: Visible to the owner, active team members, or admins
CREATE POLICY "Users can view teams they belong to or own" 
ON org.teams FOR SELECT TO public 
USING (
    owner_user_id = auth.uid() 
    OR org.is_active_team_member(id) 
    OR security.is_admin()
);
```

**No client INSERT, UPDATE or DELETE policy** (2026-09-28, Decision #122). A team is created by
`org.create_workspace`, renamed by `org.update_workspace`, published or archived by
`org.set_workspace_status` and handed on by `org.transfer_workspace_ownership` — each a definer that
checks the caller's workspace capability (`org.fn_member_can`). The owner-only UPDATE policy these
replace let an owner rewrite any column the guards did not name, and the DELETE policy let an owner
**hard-delete a team with money held in escrow for it** (root `CLAUDE.md` §5: nothing is
hard-deleted). The 2026-09-23 note stands: a raw client INSERT could set `subscription_tier` and
`treasury_wallet_id` at birth, where the UPDATE-only guard cannot reach.

The two column guards ([`security/Functions.md`](../security/Functions.md), trigger file `00001895`)
stay as **defence in depth**, so a future policy that re-opens the table cannot re-open these columns
with it:

- `trg_teams_derived` — `rating_average`, `rating_count`, `active_project_count`,
  `total_project_count`, `service_count`, `product_count`, `current_workload_intensity` are the
  platform's arithmetic, never the owner's.
- `trg_teams_immutable` — `owner_user_id`, `treasury_wallet_id`, `subscription_tier` (a plan is
  bought, not PATCHed), `slug` (the `@handle`, shared with people's usernames), and `avatar_file_id` /
  `banner_file_id` (set through `org.set_profile_avatar`, which checks the file is the team's own).
  `member_limit` left the list with the column.

### `org.team_members` / `org.business_members`

```sql
CREATE POLICY "Users can view members of their teams"
ON org.team_members FOR SELECT TO public
USING (user_id = auth.uid() OR org.is_active_team_member(team_id) OR security.is_admin());

CREATE POLICY "Members can view business roster"
ON org.business_members FOR SELECT TO authenticated
USING (org.is_active_business_member(business_id) OR security.is_admin());
```

**SELECT only — no client write policy on either roster** (2026-09-28). A roster changes only through
the workspace RPCs (`org.invite_workspace_member`, `org.respond_to_workspace_invitation`,
`org.update_workspace_member`, `org.transfer_workspace_ownership`), which enforce the three-layer
permission model — rank, "never grant what you lack", the single owner — and re-project the vault.
What the removed policies allowed: the team INSERT policy let an owner add anybody **without an
invitation, at any role, past the seat cap**; the team DELETE policy let a member hard-delete
themselves and **keep their payout stake**, so every later release kept paying them; and the business
`FOR ALL` policy ("Owners can manage members") let an owner INSERT a second owner and a member DELETE
themselves while keeping every vault grant they held.

A member's EMAIL is never read from these tables: `org.get_workspace_detail` returns the caller's
own address only.

### `org.team_roles` / `org.business_roles`

```sql
CREATE POLICY "Members can view team roles"
ON org.team_roles FOR SELECT TO authenticated
USING (org.is_active_team_member(team_id) OR security.is_admin());

CREATE POLICY "Members can view business roles"
ON org.business_roles FOR SELECT TO authenticated
USING (org.is_active_business_member(business_id));
```

Read by every active member (the matrix, the role picker). **No client write policy** on either
(2026-09-28): roles change through `org.upsert_workspace_role` / `org.archive_workspace_role`. The
removed `"Owners can manage business roles"` `FOR ALL` policy let an owner write a role row with any
capability set, bypassing the rank and `mayGrant` checks. `"Members can view team roles"` is new:
`org.team_roles` had RLS on (`00002001`) and **no policy at all** — default-deny, `200 []` to every
member. (This file previously showed a `"Team owners manage roles"` policy; no migration ever
created it.)

### `org.org_invitations`

**RLS is on with NO policy at all — deliberately, and not the default-deny bug** of Decision #57. The
`token` column IS the accept capability, so any policy wide enough to show a member their entity's
queue would show them the tokens. Every read and write is a definer: the invitee's inbox is
`org.get_workspace_roster`'s `invitations`, the entity's outgoing queue is
`org.get_workspace_detail`'s `invites` (served only to a viewer holding `invite_members`), and the
writes are `invite_workspace_member` / `respond_to_workspace_invitation` /
`revoke_workspace_invitation` / `resend_workspace_invitation`.

### `org.view_business_staff` (view)

`security_invoker = true` since 2026-09-28 (`00003001`), and `REVOKE ALL … FROM anon` (`00003005`).
As a definer view it read past every policy and handed any signed-in user **every business member's
primary email**; under the caller's own rights the roster is their own businesses'
(`org.business_members` policy) and an email is only ever their own (`org.user_emails` policy).

---

## 🛠 Asset & Skill Policies

### `org.attachments`

(Referencing common security patterns in codebase) Access is typically linked to the
`owner_profile_id` or visibility within a project context.

(`org.team_roles` is documented with its business twin under
[§ Team & Membership Policies](#orgteam_roles--orgbusiness_roles).)

---

## 🏢 Organisation Policies

Added in `0314_organisations.sql`. Both tables have RLS enabled. Membership checks go through the
`SECURITY DEFINER` helper `org.is_organisation_member()` to avoid the self-referential recursion the
Security Notes warn about.

### `org.organisations`

```sql
-- SELECT: owner, any active member, or an admin
CREATE POLICY "Members can view their organisation"
ON org.organisations FOR SELECT TO public
USING (owner_user_id = auth.uid() OR org.is_organisation_member(id) OR security.is_admin());
```

**No client INSERT policy** (2026-09-23): an organisation is provisioned by
`public.create_organisation` (service role) together with its owner membership, and a raw client
INSERT could set `verification_level` and `status` at birth.

**No client UPDATE or DELETE policy** (2026-10-06, Decision #150). The former
`"Owners and admins can update the organisation"` policy (`FOR UPDATE TO public USING (owner OR admin
member OR platform admin)`) had no column list and no `WITH CHECK`, so any admin could rewrite
`legal_name`, `registration_number`, `corporate_email` and `billing_email` over PostgREST with
nothing validated and nothing audited — and, since `USING` judged the post-image too, write
themselves in as owner. Every edit now goes through `org.update_organisation(p_org_id, p_payload)`
(`org/Functions.md`): an allow-list of keys, the legal identity owner-only and frozen once KYB
begins, every value bounded, every edit audited. A raw client `UPDATE` now matches zero rows.

`trg_organisations_immutable` (trigger file `00001895`) stays as defence in depth: it refuses a
client UPDATE of `owner_user_id`, `status` (which includes `suspended`), `verification_level` (the
KYB tier), `handle` and `logo_file_id` (set through `org.set_profile_avatar`), so a future policy
that re-opens the table cannot re-open those columns with it.

### `org.organisation_members`

`SELECT` lets a user see their own row and lets owners/admins see the whole roster.

**No client write policy** (2026-09-28). The owner membership is written by
`public.create_organisation` (service role). The `INSERT` / `UPDATE` / `DELETE` policies this
replaces let an admin UPDATE any row to role `owner` — **including their own** — and hard-DELETE the
owner. Nothing in the app writes the table today; organisation roster management will get definer
RPCs of its own.

---

## 🏷 `org.skills` — public reference data

```sql
CREATE POLICY "Skills are public reference data"
ON org.skills FOR SELECT TO authenticated, anon
USING (true);
```

⚠️ **This table had RLS enabled since `00002001` and not one policy anywhere in the tree** — which
is default-deny, and default-deny on a `SELECT` does not raise: it returns **`200 []`**. So every
skills picker in the product (project staffing, stage requirements, a freelancer's own profile)
returned an empty list and rendered it as "no skills found", and `projects.project_required_skills`
referenced a vocabulary its own readers could not resolve. Nothing was logged and nothing raised;
the only symptom was a control that renders and offers nothing (root `CLAUDE.md` §3 gate 11).

**Read by `anon` as well as `authenticated`** because the list is genuinely public reference data:
three columns (`id`, `slug`, `label`), no owner, no membership, no personal information, and it is
rendered on the signed-out `/explore` filters. `anon` already holds `USAGE` on the schema and `ALL`
on its tables (`00002500`), so the policy is what actually decides.

**`SELECT` only, deliberately.** The vocabulary is a controlled list seeded in `00005050`. A client
that could `INSERT` would let one person's typo become an option everybody else picks from, and the
skill matching that staffing runs on stops meaning anything the moment the terms multiply. New
skills arrive through a seed or an admin path, both of which run as `service_role` and are
unaffected by RLS.

---

## 👥 `org.profile_follows` — a public, counted edge

```sql
CREATE POLICY "Follows are public"
ON org.profile_follows FOR SELECT TO authenticated, anon
USING (true);

CREATE POLICY "Users follow as themselves"
ON org.profile_follows FOR INSERT TO authenticated
WITH CHECK (follower_user_id = auth.uid());

CREATE POLICY "Users unfollow their own follows"
ON org.profile_follows FOR DELETE TO authenticated
USING (follower_user_id = auth.uid());
```

⚠️ **This table was created (`00000011`) with RLS OFF and never named in `00002001`**, while
`00002500` grants `ALL ON ALL TABLES IN SCHEMA org TO anon, authenticated`. RLS off plus a blanket
grant is not weak protection, it is none: any caller — signed in or not — could `INSERT` a row
naming somebody else as `follower_user_id`, delete anybody's follows, or rewrite the graph. The
follower count on every profile was forgeable by anyone with the URL. Found and closed by the
ranked contact picker (Decision #102), which is the first reader of this table.

**`SELECT` is public on purpose.** The table's own comment calls a follow "a public, counted
edge", the profile prints the count to guests, and the picker needs BOTH directions (who I
follow, who follows me) to rank a mutual follow — an own-rows-only policy would hide exactly the
incoming half. Nothing on the row is private: two ids and an instant.

**Writes are the caller's own edges and nothing else.** There is no `UPDATE` policy because a
follow has no mutable column — you follow or you do not — and an `UPDATE` that could rewrite
`follower_user_id` is the forgery the `INSERT` check exists to stop.

---

## ⚠️ Security Notes

- **Recursive Triggers**: The `is_active_team_member` helper must be used carefully to avoid
  infinite recursion in policies where `org.team_members` checks itself.
- **Admin Bypass**: All policies include an `OR security.is_admin()` check to allow platform-level
  moderation and support.
- **Public Discovery**: Currently, `freelancer_profiles` are only visible to the owner. To enable
  the 'Explore' page, a policy allowing public `SELECT` based on `visibility = 'public'` is
  required.

---

## 🏅 Standing, Mastery & Progression (migration `20260724111000`)

RLS is enabled on all six tables. The posture is **public read, definer-only write** — Standing is a
client-facing trust signal, so it must be visible before hiring; but nothing client-side can move a
rung, because no `INSERT`/`UPDATE` grant or policy exists for `authenticated` on any of them.

| Table                     | Policy                       | Effect                                                                                                         |
| :------------------------ | :--------------------------- | :------------------------------------------------------------------------------------------------------------- |
| `org.standing_levels`     | `Read standing ladder`       | `SELECT ... USING (true)` — a client must be able to read what a rung means.                                   |
| `org.entity_standing`     | `Read standing`              | `SELECT ... USING (true)` — public, like `users_public.rating_average`.                                        |
| `org.standing_events`     | `View own standing history`  | Subject-scoped (self / `org.is_active_team_member`) or `security.is_admin()` — it carries the score internals. |
| `org.create_mastery`      | `Read create mastery`        | `SELECT ... USING (true)` — the specialisation signal is public and feeds discovery.                           |
| `org.achievements`        | `Read achievement catalogue` | `SELECT ... USING (true)`.                                                                                     |
| `org.entity_achievements` | `Read awarded achievements`  | Public when the catalogue row is `is_public`; otherwise subject-scoped or admin.                               |
| `org.quality_streaks`     | `Read quality streaks`       | `SELECT ... USING (true)` — clients see on-time/response streaks, which is the point of having them.           |

**Grants.** `authenticated` gets `SELECT` only, plus `EXECUTE` on the two read helpers
(`org.fn_level_for_score`, `org.fn_standing_level`). The four mutating functions are `REVOKE`d from
`public` and granted to `service_role` alone — see [Functions.md](Functions.md).
