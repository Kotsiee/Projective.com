REVOKE USAGE ON SCHEMA analytics,
comms,
files,
finance,
integrations,
marketplace,
ops,
org,
projects,
search,
security
FROM
    anon,
    authenticated,
    service_role;

REVOKE ALL ON ALL TABLES IN SCHEMA analytics,
comms,
files,
finance,
integrations,
marketplace,
ops,
org,
projects,
search,
security
FROM
    anon,
    authenticated,
    service_role;

GRANT USAGE ON SCHEMA org TO anon, authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA org TO anon, authenticated;

GRANT ALL ON ALL SEQUENCES IN SCHEMA org TO anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA org
GRANT ALL ON TABLES TO anon,
authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA org
GRANT ALL ON SEQUENCES TO anon,
authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon,
authenticated,
service_role;

GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon,
authenticated,
service_role;

GRANT USAGE ON SCHEMA comms TO authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA comms TO authenticated;

GRANT ALL ON ALL SEQUENCES IN SCHEMA comms TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA comms
GRANT ALL ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA comms
GRANT ALL ON SEQUENCES TO authenticated;

GRANT USAGE ON SCHEMA files TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA files TO authenticated,
service_role;

GRANT ALL ON ALL SEQUENCES IN SCHEMA files TO authenticated,
service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA files
GRANT ALL ON TABLES TO authenticated,
service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA files
GRANT ALL ON SEQUENCES TO authenticated,
service_role;

GRANT USAGE ON SCHEMA projects TO authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA projects TO authenticated,
service_role;

GRANT ALL ON ALL SEQUENCES IN SCHEMA projects TO authenticated,
service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA projects
GRANT ALL ON TABLES TO authenticated,
service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA projects
GRANT ALL ON SEQUENCES TO authenticated,
service_role;

GRANT USAGE ON SCHEMA search TO anon, authenticated, service_role;

GRANT SELECT ON ALL TABLES IN SCHEMA search TO anon, authenticated;

GRANT
INSERT
,
UPDATE,
DELETE ON search.user_affinity TO authenticated;

GRANT INSERT ON search.query_logs TO authenticated, anon;

GRANT
SELECT
    ON ALL SEQUENCES IN SCHEMA search TO anon,
    authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA search TO service_role;

GRANT ALL ON ALL SEQUENCES IN SCHEMA search TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA search
GRANT
SELECT ON TABLES TO anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA search
GRANT
SELECT ON SEQUENCES TO anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA search
GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA search
GRANT ALL ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA search
GRANT
EXECUTE ON ROUTINES TO anon,
authenticated,
service_role;

GRANT
EXECUTE ON ALL FUNCTIONS IN SCHEMA search TO anon,
authenticated,
service_role;

GRANT USAGE ON SCHEMA marketplace TO anon, authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA marketplace TO anon, authenticated;

GRANT ALL ON ALL SEQUENCES IN SCHEMA marketplace TO anon,
authenticated;

GRANT USAGE ON SCHEMA reviews TO anon, authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA reviews TO anon, authenticated;

GRANT ALL ON ALL SEQUENCES IN SCHEMA reviews TO anon, authenticated;