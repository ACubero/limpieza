"""Limpieza PWA — Flask API.

Endpoints:
  POST   /api/limpieza/auth/login     {username, password} -> {token, user}
  POST   /api/limpieza/auth/logout    (auth) -> {ok}
  POST   /api/limpieza/auth/refresh   (auth) -> {token, user}    # sliding session
  GET    /api/limpieza/auth/me        (auth) -> {user}

  GET    /api/limpieza/data           (auth) -> {settings, tasks, volunteers, plannings, versions, server_ts}
  PUT    /api/limpieza/data/<section> (auth) {payload, version} -> {applied, version}

  POST   /api/limpieza/migrate        (auth) {tasks, volunteers, plannings, settings} -> {ok, applied}
"""
from flask import Flask, request, jsonify, g
import json
import bcrypt
import db
from functools import wraps

app = Flask(__name__)
SECTIONS = {"settings", "tasks", "volunteers", "plannings"}


def require_auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
        if not token:
            return jsonify({"error": "missing_token"}), 401
        sess = db.get_session(token)
        if not sess:
            return jsonify({"error": "invalid_token"}), 401
        g.user = sess
        return f(*args, **kwargs)
    return wrapper


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "not_found"}), 404


@app.errorhandler(400)
def bad_request(e):
    return jsonify({"error": "bad_request", "message": str(e.description)}), 400


# ---------- Auth ----------

@app.post("/api/limpieza/auth/login")
def login():
    body = request.get_json(silent=True) or {}
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    if not username or not password:
        return jsonify({"error": "missing_credentials"}), 400
    user = db.get_user_by_username(username)
    if not user:
        return jsonify({"error": "invalid_credentials"}), 401
    if not bcrypt.checkpw(password.encode("utf-8"), user["password_hash"].encode("utf-8")):
        return jsonify({"error": "invalid_credentials"}), 401
    token = db.create_session(user["id"])
    return jsonify({
        "token": token,
        "user": {"id": user["id"], "username": user["username"], "display_name": user["display_name"], "role": user["role"]},
    })


@app.post("/api/limpieza/auth/logout")
@require_auth
def logout():
    db.delete_session(g.user["token"])
    return jsonify({"ok": True})


@app.post("/api/limpieza/auth/refresh")
@require_auth
def refresh():
    """Rotate the session token, extending its expiry (sliding session).

    Returns the new token + user info. The frontend should replace the old
    token in localStorage with the new one immediately. The old token is
    invalidated, so any other device still using it will need to re-login.
    """
    old_token = g.user["token"]
    new_token = db.refresh_session(old_token)
    if not new_token:
        return jsonify({"error": "refresh_failed"}), 401
    user = db.get_user_by_id(g.user["user_id"])
    return jsonify({
        "token": new_token,
        "user": {"id": user["id"], "username": user["username"], "display_name": user["display_name"], "role": user["role"]},
    })


@app.get("/api/limpieza/auth/me")
@require_auth
def me():
    return jsonify({
        "user": {"id": g.user["user_id"], "username": g.user["username"], "display_name": g.user["display_name"], "role": g.user["role"]},
    })


# ---------- Data ----------

@app.get("/api/limpieza/data")
@require_auth
def get_data():
    row = db.get_data_row()
    return jsonify({
        "settings": json.loads(row["settings_json"]),
        "tasks": json.loads(row["tasks_json"]),
        "volunteers": json.loads(row["volunteers_json"]),
        "plannings": json.loads(row["plannings_json"]),
        "versions": {
            "settings": row["settings_version"],
            "tasks": row["tasks_version"],
            "volunteers": row["volunteers_version"],
            "plannings": row["plannings_version"],
        },
        "server_ts": row["updated_at"],
    })


@app.put("/api/limpieza/data/<section>")
@require_auth
def put_section(section):
    if section not in SECTIONS:
        return jsonify({"error": "unknown_section"}), 400
    body = request.get_json(silent=True) or {}
    payload = body.get("payload")
    version = body.get("version")
    if payload is None or not isinstance(version, int):
        return jsonify({"error": "missing_payload_or_version"}), 400
    applied, current_version = db.update_section(section, payload, version, g.user["user_id"])
    return jsonify({"applied": applied, "version": current_version})


# ---------- Health (no auth) ----------

@app.get("/api/limpieza/health")
def health():
    return jsonify({"ok": True})


# ---------- Initialise on import ----------

db.init_db()
