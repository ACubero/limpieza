"""SQLite helpers + initial migration for the Limpieza PWA backend."""
import sqlite3
import json
import secrets
from pathlib import Path
from contextlib import contextmanager

DB_PATH = Path("/var/lib/limpieza/limpieza.db")
SCHEMA_PATH = Path(__file__).parent / "schema.sql"


# Default seed tasks for new installs. Must match the frontend's seedTasks()
# in store.js — the backend seeds on first boot so a fresh installation
# doesn't show an empty list. Frontend still has its own seedTasks() as a
# fallback for the offline cache.
DEFAULT_TASKS = [
    {"id": secrets.token_urlsafe(8), "name": "Quitar polvo de las sillas", "days": [4, 6], "requiresEmpty": False, "needed": 1, "gender": "any"},
    {"id": secrets.token_urlsafe(8), "name": "Quitar polvo mobiliario general (pasamanos, barandillas, caja donaciones, sonido, publicaciones, etc.)", "days": [4, 6], "requiresEmpty": False, "needed": 1, "gender": "any"},
    {"id": secrets.token_urlsafe(8), "name": "Quitar polvo plataforma (atril, mesa y sillas)", "days": [4, 6], "requiresEmpty": False, "needed": 1, "gender": "any"},
    {"id": secrets.token_urlsafe(8), "name": "Vaciar papeleras", "days": [4, 6], "requiresEmpty": False, "needed": 1, "gender": "any"},
    {"id": secrets.token_urlsafe(8), "name": "Rellenar vasos, papel higiénico, secamanos y jabón", "days": [4, 6], "requiresEmpty": False, "needed": 1, "gender": "any"},
    {"id": secrets.token_urlsafe(8), "name": "Baño hombres (limpiar y desinfectar lavamanos, inodoros y suelo)", "days": [4, 6], "requiresEmpty": True, "needed": 1, "gender": "any"},
    {"id": secrets.token_urlsafe(8), "name": "Baño mujeres (limpiar y desinfectar lavamanos, inodoros y suelo)", "days": [4, 6], "requiresEmpty": True, "needed": 1, "gender": "any"},
    {"id": secrets.token_urlsafe(8), "name": "Lavar las bayetas en casa", "days": [4, 6], "requiresEmpty": False, "needed": 1, "gender": "any"},
    {"id": secrets.token_urlsafe(8), "name": "Barrer entrada salón", "days": [4, 6], "requiresEmpty": False, "needed": 1, "gender": "any"},
    {"id": secrets.token_urlsafe(8), "name": "Barrer entrada vivienda", "days": [4, 6], "requiresEmpty": False, "needed": 1, "gender": "any"},
    {"id": secrets.token_urlsafe(8), "name": "Aspirar plataforma", "days": [4, 6], "requiresEmpty": False, "needed": 1, "gender": "any"},
    {"id": secrets.token_urlsafe(8), "name": "Aspirar auditorio", "days": [4, 6], "requiresEmpty": True, "needed": 1, "gender": "any"},
]


def _connect():
    conn = sqlite3.connect(DB_PATH, timeout=10, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


@contextmanager
def get_conn():
    conn = _connect()
    try:
        yield conn
    finally:
        conn.close()


def init_db():
    """Create tables if they don't exist. Idempotent."""
    with get_conn() as conn:
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        # Ensure singleton row with sensible defaults.
        # The schema's DEFAULT '{}' for settings_json is wrong — the frontend
        # expects {groupTitle, days: [4, 6]} from defaultData() in store.js.
        # A fresh install would otherwise leave settings empty, which breaks
        # anything that does [...db.settings.days] (volForm, taskForm, pickWeek).
        # Use INSERT OR IGNORE so re-running this is safe; the row only
        # matters on the very first boot.
        default_settings = json.dumps(
            {"groupTitle": "Tareas limpieza G2", "days": [4, 6]},
            ensure_ascii=False,
        )
        default_tasks = json.dumps(DEFAULT_TASKS, ensure_ascii=False)
        conn.execute(
            "INSERT OR IGNORE INTO data (id, settings_json, settings_version, "
            "tasks_json, tasks_version, volunteers_json, plannings_json) "
            "VALUES (1, ?, 1, ?, 1, '[]', '[]')",
            (default_settings, default_tasks),
        )


def get_data_row():
    """Return the singleton data row as a dict."""
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM data WHERE id = 1").fetchone()
        if not row:
            init_db()
            row = conn.execute("SELECT * FROM data WHERE id = 1").fetchone()
        return dict(row)


def get_section(section):
    """Return the parsed JSON for a section + its version."""
    row = get_data_row()
    col = f"{section}_json"
    ver = f"{section}_version"
    return json.loads(row[col]), row[ver]


def update_section(section, payload, version, user_id):
    """Update a section if the incoming version is newer (last-wins)."""
    col = f"{section}_json"
    ver = f"{section}_version"
    with get_conn() as conn:
        current = conn.execute(f"SELECT {ver} FROM data WHERE id = 1").fetchone()
        current_ver = current[0]
        if version <= current_ver:
            return False, current_ver  # rejected: not newer
        conn.execute(
            f"UPDATE data SET {col} = ?, {ver} = ?, updated_by = ? WHERE id = 1",
            (json.dumps(payload, ensure_ascii=False), version, user_id),
        )
        return True, version


def list_users():
    with get_conn() as conn:
        return [dict(r) for r in conn.execute("SELECT id, username, display_name, role, active FROM users ORDER BY username")]


def create_user(username, password_hash, display_name=None, role="editor"):
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)",
            (username, password_hash, display_name, role),
        )
        return cur.lastrowid


def get_user_by_username(username):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ? AND active = 1", (username,)).fetchone()
        return dict(row) if row else None


def get_user_by_id(user_id):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ? AND active = 1", (user_id,)).fetchone()
        return dict(row) if row else None


def create_session(user_id, days=365):
    """Create a new session token that expires in `days` days. Default 1 year.

    The long default + the /auth/refresh endpoint (sliding session) means a
    user who opens the app at least once a year never has to re-login.
    """
    import secrets
    token = secrets.token_urlsafe(32)
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))",
            (token, user_id, f"+{days} days"),
        )
    return token


def refresh_session(old_token, days=365):
    """Rotate a session token: create a new one for the same user and delete the old.

    Returns the new token, or None if the old token was invalid/expired.
    """
    with get_conn() as conn:
        row = conn.execute(
            "SELECT s.user_id FROM sessions s "
            "WHERE s.token = ? AND s.expires_at > datetime('now')",
            (old_token,),
        ).fetchone()
        if not row:
            return None
        user_id = row["user_id"]
        new_token = create_session(user_id, days)
        conn.execute("DELETE FROM sessions WHERE token = ?", (old_token,))
        return new_token


def get_session(token):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT s.*, u.username, u.display_name, u.role FROM sessions s "
            "JOIN users u ON u.id = s.user_id "
            "WHERE s.token = ? AND s.expires_at > datetime('now')",
            (token,),
        ).fetchone()
        if row:
            conn.execute("UPDATE sessions SET last_seen_at = datetime('now') WHERE token = ?", (token,))
            return dict(row)
        return None


def delete_session(token):
    with get_conn() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))


def delete_user_sessions(user_id):
    with get_conn() as conn:
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
