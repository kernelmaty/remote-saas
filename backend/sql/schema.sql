-- =============================================================
-- RemoteDesk SaaS — Esquema PostgreSQL 16 (multi-tenant por company_id)
-- =============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ---------- Tenants ----------
CREATE TABLE companies (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    plan        TEXT NOT NULL DEFAULT 'trial',      -- trial | starter | pro | enterprise
    max_seats   INT  NOT NULL DEFAULT 3,
    max_devices INT  NOT NULL DEFAULT 20,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active   BOOLEAN NOT NULL DEFAULT true
);

-- ---------- Usuarios (técnicos / admins de cada empresa) ----------
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    email         CITEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name     TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'technician',  -- admin | technician
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_company ON users(company_id);

-- ---------- Refresh tokens (rotativos, hasheados) ----------
CREATE TABLE refresh_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    family     UUID NOT NULL,                -- detección de reuso
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);

-- ---------- Clientes (empresas/personas a las que se da soporte) ----------
CREATE TABLE clients (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    contact_email TEXT,
    phone      TEXT,
    notes      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active  BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX idx_clients_company ON clients(company_id);

-- ---------- Dispositivos (hosts remotos) ----------
CREATE TABLE devices (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,                       -- "PC-Contaduría"
    os            TEXT,                                -- windows | macos | linux
    device_token_hash TEXT NOT NULL,                   -- acceso desatendido
    access_key_hash   TEXT,                            -- clave extra opcional
    last_seen_at  TIMESTAMPTZ,
    is_online     BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active     BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX idx_devices_company ON devices(company_id);
CREATE INDEX idx_devices_client  ON devices(client_id);

-- ---------- Tickets ----------
CREATE TABLE tickets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    client_id   UUID REFERENCES clients(id) ON DELETE SET NULL,
    number      BIGINT GENERATED ALWAYS AS IDENTITY,   -- #341 visible
    title       TEXT NOT NULL,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'open',          -- open | in_progress | resolved | closed
    priority    TEXT NOT NULL DEFAULT 'medium',        -- low | medium | high | critical
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at   TIMESTAMPTZ
);
CREATE INDEX idx_tickets_company_status ON tickets(company_id, status);

CREATE TABLE ticket_comments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id  UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    body       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_comments_ticket ON ticket_comments(ticket_id);

-- ---------- Sesiones remotas (historial de conexiones) ----------
CREATE TABLE sessions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    device_id    UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    technician_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticket_id    UUID REFERENCES tickets(id) ON DELETE SET NULL,
    status       TEXT NOT NULL DEFAULT 'pending',   -- pending | active | ended | rejected | failed
    connection_type TEXT,                           -- p2p | relay
    started_at   TIMESTAMPTZ,
    ended_at     TIMESTAMPTZ,
    duration_sec INT GENERATED ALWAYS AS
                 (GREATEST(0, EXTRACT(EPOCH FROM (ended_at - started_at)))::INT) STORED,
    tech_ip      INET,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_company_created ON sessions(company_id, created_at DESC);

-- ---------- Auditoría inmutable de eventos de sesión ----------
CREATE TABLE session_events (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,    -- connected | control_granted | file_sent | file_received | clipboard | ended
    payload    JSONB,            -- {"file":"factura.pdf","bytes":48211}
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_session ON session_events(session_id);

-- ---------- Chat (persistente fuera de sesión) ----------
CREATE TABLE chat_messages (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    sender_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    sender_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    body       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_session ON chat_messages(session_id);

-- ---------- Trigger updated_at ----------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_tickets_touch BEFORE UPDATE ON tickets
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- =============================================================
-- Row Level Security (segunda barrera de aislamiento multi-tenant)
-- La API hace: SET app.company_id = '<uuid del JWT>'
-- =============================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','clients','devices','tickets','sessions','chat_messages']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
       USING (company_id = current_setting(''app.company_id'', true)::uuid)', t);
  END LOOP;
END $$;
-- Nota: el rol de la app NO debe ser superuser ni owner para que RLS aplique.
