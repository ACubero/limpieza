-- Limpieza PWA — schema
-- Diseño: "documento JSON" con versionado por sección
-- Cada sección (tasks, volunteers, plannings, settings) tiene su propio
-- `version` que se incrementa en cada cambio. El sync offline usa
-- "último gana" comparando versiones.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,        -- bcrypt
  display_name TEXT,
  role TEXT DEFAULT 'editor',         -- 'editor' | 'viewer' (futuro)
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS data (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- solo 1 fila (singleton)
  settings_json TEXT NOT NULL DEFAULT '{}',
  settings_version INTEGER DEFAULT 0,
  tasks_json TEXT NOT NULL DEFAULT '[]',
  tasks_version INTEGER DEFAULT 0,
  volunteers_json TEXT NOT NULL DEFAULT '[]',
  volunteers_version INTEGER DEFAULT 0,
  plannings_json TEXT NOT NULL DEFAULT '[]',
  plannings_version INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,            -- datetime('now', '+30 days')
  last_seen_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Cambios pendientes de subir desde un cliente (para offline sync)
CREATE TABLE IF NOT EXISTS pending_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL,             -- para idempotencia
  section TEXT NOT NULL,               -- 'tasks' | 'volunteers' | 'plannings' | 'settings'
  payload_json TEXT NOT NULL,          -- sección completa
  version INTEGER NOT NULL,            -- versión que el cliente quiere imponer
  created_at TEXT DEFAULT (datetime('now')),
  applied INTEGER DEFAULT 0,
  applied_at TEXT,
  UNIQUE(client_id, section, version)
);

-- Trigger: mantener updated_at fresco
CREATE TRIGGER IF NOT EXISTS data_touch AFTER UPDATE ON data
BEGIN
  UPDATE data SET updated_at = datetime('now') WHERE id = NEW.id;
END;
