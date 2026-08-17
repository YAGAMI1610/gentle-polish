import { config } from "dotenv";

// @prisma/client reads process.env.DATABASE_URL directly and does not load .env
// itself; Vite only surfaces VITE_-prefixed vars to import.meta.env. Load
// apps/web/.env into process.env before any test runs so the DB-readiness probe
// and the DB-gated integration tests can connect when a database is configured.
// A no-op (never throws) when .env is absent — the unit tests need no database.
config();
