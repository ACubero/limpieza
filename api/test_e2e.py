"""End-to-end test: simulates the full flow.
1. Create 2 users
2. Login as user 1 → get token
3. PUT initial data (migration from localStorage)
4. GET data → verify it's there
5. Login as user 2 → PUT a change
6. User 1 GET → sees user 2's change
7. Verify last-wins semantics with stale version
"""
import sys
import bcrypt
sys.path.insert(0, "/home/hermes/limpieza-api")
import db

DB_PATH_TEST = "/tmp/limpieza-test.db"
import os
os.environ["DB_PATH_OVERRIDE"] = DB_PATH_TEST
# Override DB_PATH in db module
import db as dbmod
dbmod.DB_PATH = __import__("pathlib").Path(DB_PATH_TEST)

dbmod.init_db()

# Clean slate
with dbmod.get_conn() as c:
    c.execute("DELETE FROM users")

print("=" * 60)
print("STEP 1: Create users")
print("=" * 60)
hash1 = bcrypt.hashpw(b"alex-password", bcrypt.gensalt()).decode()
hash2 = bcrypt.hashpw(b"ayudante-password", bcrypt.gensalt()).decode()
uid1 = dbmod.create_user("alex", hash1, "Alex", "editor")
uid2 = dbmod.create_user("ayudante", hash2, "Ayudante", "editor")
print(f"  Created user: alex (id={uid1})")
print(f"  Created user: ayudante (id={uid2})")
print(f"  Users in DB: {dbmod.list_users()}")

print()
print("=" * 60)
print("STEP 2: Simulate login + token via the API")
print("=" * 60)
from app import app
client = app.test_client()

# Wrong password
r = client.post("/api/limpieza/auth/login", json={"username": "alex", "password": "wrong"})
print(f"  Wrong password: {r.status_code} {r.get_json()}")
assert r.status_code == 401

# Correct password
r = client.post("/api/limpieza/auth/login", json={"username": "alex", "password": "alex-password"})
print(f"  Correct login: {r.status_code}")
data = r.get_json()
token1 = data["token"]
print(f"  Got token: {token1[:16]}...")
assert r.status_code == 200

print()
print("=" * 60)
print("STEP 3: Migration from localStorage (PUT all sections at v=1)")
print("=" * 60)
migrated_tasks = [
    {"id": "t1", "name": "Limpieza general", "days": [4, 6], "requiresEmpty": False, "needed": 1, "gender": "any"},
]
migrated_vols = [
    {"id": "v1", "name": "Ana López", "gender": "F", "canWait": False, "days": [4, 6], "active": True},
    {"id": "v2", "name": "Beto Martín", "gender": "M", "canWait": False, "days": [4, 6], "active": True},
]
migrated_settings = {"groupTitle": "Test G2", "days": [4, 6]}
migrated_plannings = []

headers = {"Authorization": f"Bearer {token1}"}

r = client.put("/api/limpieza/data/tasks", json={"payload": migrated_tasks, "version": 1}, headers=headers)
print(f"  PUT tasks v1: {r.status_code} {r.get_json()}")
assert r.status_code == 200
assert r.get_json()["applied"] is True

r = client.put("/api/limpieza/data/volunteers", json={"payload": migrated_vols, "version": 1}, headers=headers)
print(f"  PUT volunteers v1: {r.status_code} {r.get_json()}")
assert r.status_code == 200

r = client.put("/api/limpieza/data/settings", json={"payload": migrated_settings, "version": 1}, headers=headers)
print(f"  PUT settings v1: {r.status_code} {r.get_json()}")
assert r.status_code == 200

r = client.put("/api/limpieza/data/plannings", json={"payload": migrated_plannings, "version": 1}, headers=headers)
print(f"  PUT plannings v1: {r.status_code} {r.get_json()}")
assert r.status_code == 200

print()
print("=" * 60)
print("STEP 4: GET data and verify")
print("=" * 60)
r = client.get("/api/limpieza/data", headers=headers)
print(f"  GET: {r.status_code}")
d = r.get_json()
print(f"  Volunteers in DB: {len(d['volunteers'])}")
print(f"  Tasks in DB: {len(d['tasks'])}")
print(f"  Versions: {d['versions']}")
assert len(d["volunteers"]) == 2
assert len(d["tasks"]) == 1
assert d["versions"]["tasks"] == 1

print()
print("=" * 60)
print("STEP 5: User 2 (ayudante) edits")
print("=" * 60)
r = client.post("/api/limpieza/auth/login", json={"username": "ayudante", "password": "ayudante-password"})
token2 = r.get_json()["token"]
headers2 = {"Authorization": f"Bearer {token2}"}

new_tasks = migrated_tasks + [{"id": "t2", "name": "Barrer entrada", "days": [6], "requiresEmpty": False, "needed": 1, "gender": "any"}]
r = client.put("/api/limpieza/data/tasks", json={"payload": new_tasks, "version": 2}, headers=headers2)
print(f"  Ayudante PUT tasks v2: {r.status_code} {r.get_json()}")
assert r.status_code == 200
assert r.get_json()["applied"] is True

print()
print("=" * 60)
print("STEP 6: User 1 sees user 2's change")
print("=" * 60)
r = client.get("/api/limpieza/data", headers=headers)
d = r.get_json()
print(f"  Alex GET: tasks count = {len(d['tasks'])} (expected 2)")
print(f"  Versions: {d['versions']}")
assert len(d["tasks"]) == 2
assert d["versions"]["tasks"] == 2

print()
print("=" * 60)
print("STEP 7: Last-wins — stale version is rejected")
print("=" * 60)
stale_tasks = [{"id": "t1", "name": "Should not apply", "days": [4], "requiresEmpty": False, "needed": 1, "gender": "any"}]
r = client.put("/api/limpieza/data/tasks", json={"payload": stale_tasks, "version": 1}, headers=headers)
print(f"  Stale PUT v1 (current is v2): {r.status_code} {r.get_json()}")
assert r.status_code == 200
assert r.get_json()["applied"] is False
assert r.get_json()["version"] == 2  # server version returned

# Verify data wasn't overwritten
r = client.get("/api/limpieza/data", headers=headers)
d = r.get_json()
print(f"  After stale PUT, tasks count = {len(d['tasks'])} (expected 2, NOT 1)")
assert len(d["tasks"]) == 2

print()
print("=" * 60)
print("STEP 8: Logout invalidates token")
print("=" * 60)
r = client.post("/api/limpieza/auth/logout", headers=headers)
print(f"  Logout: {r.status_code} {r.get_json()}")
r = client.get("/api/limpieza/data", headers=headers)
print(f"  GET after logout: {r.status_code} (expected 401)")
assert r.status_code == 401

print()
print("=" * 60)
print("STEP 9: Unauth requests rejected")
print("=" * 60)
r = client.get("/api/limpieza/data")
print(f"  GET no token: {r.status_code} (expected 401)")
assert r.status_code == 401

r = client.put("/api/limpieza/data/tasks", json={"payload": [], "version": 1})
print(f"  PUT no token: {r.status_code} (expected 401)")
assert r.status_code == 401

print()
print("=" * 60)
print("ALL TESTS PASSED ✓")
print("=" * 60)
