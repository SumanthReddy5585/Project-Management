-- Run once as the PostgreSQL superuser (postgres), e.g. in pgAdmin's Query Tool or:
--   psql -U postgres -f create-database.sql
-- Change the password before running. Use the same login/password in config\o2.env (DATABASE_URL).
CREATE ROLE o2app WITH LOGIN PASSWORD 'CHANGE-ME-Strong-Pass-2026';
CREATE DATABASE o2_support_hub OWNER o2app ENCODING 'UTF8' TEMPLATE template0;
