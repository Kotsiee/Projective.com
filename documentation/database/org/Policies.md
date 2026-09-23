# org Schema: Policies

Row-Level Security (RLS) in the `org` schema ensures that identity data, profile settings, and team
configurations are isolated and protected. Access is primarily governed by the `auth.uid()` of the
requester and helper functions that verify administrative or membership status.

## 🛡️ Security Helpers

These functions are used throughout the policies to provide a clean and consistent authorization
layer.

- **`security.is_admin()`**: Returns true if the `auth.uid()` exists in `ops.admin_users`.
- **`org.is_active_team_member(_team_id)`**: Returns true if the `auth.uid()` has an 'active' status
  in `org.team_members` for the specified team.
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
business goes through a definer (the profile view `org.get_profile_view`, the discovery reads) and
every write through `org.create_business` / `org.save_profile` / `org.set_profile_avatar`. A
consequence worth knowing: an RLS-scoped read of `org.business_profiles` returns nothing, so the
project detail's business parties (`live-detail.ts`) degrade to "Unknown" on the live path.

### `org.user_emails`

Protects secondary and primary email associations.

```sql
-- ALL: Strictly private to the owning user or platform admins
CREATE POLICY "Users can manage their own emails" 
ON org.user_emails FOR ALL TO public 
USING (user_id = auth.uid() OR security.is_admin());
```

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

-- UPDATE / DELETE: the team owner or an admin (UPDATE has no WITH CHECK, so Postgres applies the
-- USING clause to the post-image as well — an owner cannot write another user in as owner)
CREATE POLICY "Team owners can update their teams"
ON org.teams FOR UPDATE TO public
USING (owner_user_id = auth.uid() OR security.is_admin());

CREATE POLICY "Team owners can delete their teams"
ON org.teams FOR DELETE TO public
USING (owner_user_id = auth.uid() OR security.is_admin());
```

**No client INSERT policy** (2026-09-23). A team is created by `org.create_team` (definer), which
also opens its treasury wallet; a raw INSERT skipped that and could set `subscription_tier`,
`member_limit` and `treasury_wallet_id` at birth.

The UPDATE policy cannot tell a rename from a forged rating, so two column guards
([`security/Functions.md`](../security/Functions.md), trigger file `00001895`) narrow what a client
UPDATE may change:

- `trg_teams_derived` — `rating_average`, `rating_count`, `active_project_count`,
  `total_project_count`, `service_count`, `product_count`, `current_workload_intensity` are the
  platform's arithmetic, never the owner's.
- `trg_teams_immutable` — `owner_user_id`, `treasury_wallet_id`, `subscription_tier`, `member_limit`
  (a plan is bought, not PATCHed), `slug` (the `@handle`, shared with people's usernames), and
  `avatar_file_id` / `banner_file_id` (set through `org.set_profile_avatar`, which checks the file is
  the team's own).

Name, headline, story, visibility, status and the hire intake stay owner-editable.

### `org.team_members`

Critical policies for managing team rosters and permissions.

```sql
-- SELECT: Users see their own rows, and team members see fellow members
CREATE POLICY "Users can view members of their teams" 
ON org.team_members FOR SELECT TO public 
USING (
    user_id = auth.uid() 
    OR org.is_active_team_member(team_id) 
    OR security.is_admin()
);

-- INSERT/UPDATE: Restricted to Team Owners or Admins
CREATE POLICY "Team owners can manage memberships" 
ON org.team_members FOR ALL TO public 
USING (
    EXISTS (
        SELECT 1 FROM org.teams t 
        WHERE t.id = team_id AND t.owner_user_id = auth.uid()
    ) 
    OR security.is_admin()
);

-- DELETE: Owner can remove members; members can leave
CREATE POLICY "Team owners can remove members or members can leave" 
ON org.team_members FOR DELETE TO public 
USING (
    user_id = auth.uid() 
    OR EXISTS (
        SELECT 1 FROM org.teams t 
        WHERE t.id = team_id AND t.owner_user_id = auth.uid()
    ) 
    OR security.is_admin()
);
```

---

## 🛠 Asset & Skill Policies

### `org.attachments`

(Referencing common security patterns in codebase) Access is typically linked to the
`owner_profile_id` or visibility within a project context.

### `org.team_roles`

Strictly managed by the team hierarchy.

```sql
-- ALL: Managed by team owners
CREATE POLICY "Team owners manage roles" 
ON org.team_roles FOR ALL TO public 
USING (
    EXISTS (
        SELECT 1 FROM org.teams t 
        WHERE t.id = team_id AND t.owner_user_id = auth.uid()
    )
);
```

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

-- UPDATE: owner or admin members (or admin)
CREATE POLICY "Owners and admins can update the organisation"
ON org.organisations FOR UPDATE TO public
USING (owner_user_id = auth.uid() OR org.is_organisation_member(id, 'admin') OR security.is_admin());
```

**No client INSERT policy** (2026-09-23): an organisation is provisioned by
`public.create_organisation` (service role) together with its owner membership, and a raw client
INSERT could set `verification_level` and `status` at birth.

Because the UPDATE policy has no `WITH CHECK`, its `USING` clause judges the post-image too — and an
ADMIN member satisfies it whatever `owner_user_id` says, so it let an admin write themselves in as
owner. `trg_organisations_immutable` (trigger file `00001895`) refuses a client UPDATE of
`owner_user_id`, `status` (which includes `suspended`), `verification_level` (the KYB tier), `handle`
and `logo_file_id` (set through `org.set_profile_avatar`). The trading name, address and contact
details stay editable by the owner and admins.

### `org.organisation_members`

`SELECT` lets a user see their own row and lets owners/admins see the whole roster;
`INSERT`/`UPDATE`/ `DELETE` are owner/admin-gated. The `INSERT` policy also allows the org **owner**
to seed their own owner-membership at creation time (when no members exist yet), via an `EXISTS` on
`org.organisations.owner_user_id`.

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
