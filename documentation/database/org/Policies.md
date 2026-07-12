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

## ⚠️ Security Notes

- **Recursive Triggers**: The `is_active_team_member` helper must be used carefully to avoid
  infinite recursion in policies where `org.team_members` checks itself.
- **Admin Bypass**: All policies include an `OR security.is_admin()` check to allow platform-level
  moderation and support.
- **Public Discovery**: Currently, `freelancer_profiles` are only visible to the owner. To enable
  the 'Explore' page, a policy allowing public `SELECT` based on `visibility = 'public'` is
  required.
