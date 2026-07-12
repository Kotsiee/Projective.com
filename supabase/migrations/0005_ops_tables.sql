CREATE TABLE ops.admin_users (
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'admin'::text,
  granted_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT admin_users_pkey PRIMARY KEY (user_id),
  CONSTRAINT admin_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT admin_users_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES auth.users(id)
);