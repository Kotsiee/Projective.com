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

Controls visibility of basic user identity.

```sql
-- SELECT: Any authenticated user can view public profiles
CREATE POLICY "Any authenticated user can view public profiles" 
ON org.users_public FOR SELECT TO public 
USING (auth.role() = 'authenticated');

-- INSERT/UPDATE: Restricted to the user themselves or an admin
CREATE POLICY "Users can manage their own profile" 
ON org.users_public FOR ALL TO public 
USING (user_id = auth.uid() OR security.is_admin());
```

### `org.freelancer_profiles`

Protects seller-specific data and professional settings.

```sql
-- ALL: Managed by the profile owner or an administrator
CREATE POLICY "Users can manage their own freelancer profile" 
ON org.freelancer_profiles FOR ALL TO public 
USING (user_id = auth.uid() OR security.is_admin());
```

### `org.business_profiles`

Ensures businesses are only manageable by their designated owners.

```sql
-- ALL: Only the owner (owner_user_id) or an admin can view/edit/delete
CREATE POLICY "Users can manage their own business profiles" 
ON org.business_profiles FOR ALL TO public 
USING (owner_user_id = auth.uid() OR security.is_admin());
```

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

-- INSERT/UPDATE/DELETE: Restricted to the team owner or admin
CREATE POLICY "Team owners can manage their teams" 
ON org.teams FOR ALL TO public 
USING (owner_user_id = auth.uid() OR security.is_admin());
```

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

-- INSERT: any authenticated user creating an org they own
CREATE POLICY "Users can create organisations they own"
ON org.organisations FOR INSERT TO public
WITH CHECK (owner_user_id = auth.uid());

-- UPDATE: owner or admin members (or admin)
CREATE POLICY "Owners and admins can update the organisation"
ON org.organisations FOR UPDATE TO public
USING (owner_user_id = auth.uid() OR org.is_organisation_member(id, 'admin') OR security.is_admin());
```

### `org.organisation_members`

`SELECT` lets a user see their own row and lets owners/admins see the whole roster;
`INSERT`/`UPDATE`/ `DELETE` are owner/admin-gated. The `INSERT` policy also allows the org **owner**
to seed their own owner-membership at creation time (when no members exist yet), via an `EXISTS` on
`org.organisations.owner_user_id`.

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

| Table                     | Policy                        | Effect                                                                                                          |
| :------------------------ | :---------------------------- | :---------------------------------------------------------------------------------------------------------------- |
| `org.standing_levels`     | `Read standing ladder`        | `SELECT ... USING (true)` — a client must be able to read what a rung means.                                    |
| `org.entity_standing`     | `Read standing`               | `SELECT ... USING (true)` — public, like `users_public.rating_average`.                                          |
| `org.standing_events`     | `View own standing history`   | Subject-scoped (self / `org.is_active_team_member`) or `security.is_admin()` — it carries the score internals.   |
| `org.create_mastery`      | `Read create mastery`         | `SELECT ... USING (true)` — the specialisation signal is public and feeds discovery.                            |
| `org.achievements`        | `Read achievement catalogue`  | `SELECT ... USING (true)`.                                                                                      |
| `org.entity_achievements` | `Read awarded achievements`   | Public when the catalogue row is `is_public`; otherwise subject-scoped or admin.                                |
| `org.quality_streaks`     | `Read quality streaks`        | `SELECT ... USING (true)` — clients see on-time/response streaks, which is the point of having them.            |

**Grants.** `authenticated` gets `SELECT` only, plus `EXECUTE` on the two read helpers
(`org.fn_level_for_score`, `org.fn_standing_level`). The four mutating functions are `REVOKE`d from
`public` and granted to `service_role` alone — see [Functions.md](Functions.md).
