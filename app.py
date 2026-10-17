
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from functools import wraps

from flask import Flask, request, jsonify, session
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)

# --------------------------------------------------
# CONFIGURATION
# --------------------------------------------------

APP_SECRET_KEY = os.environ.get("APP_SECRET_KEY", "")
AG_ADMIN_KEY = os.environ.get("AG_ADMIN_KEY", "")
DB_PATH = os.environ.get("DB_PATH", "ag_tools.db")

if len(APP_SECRET_KEY) < 32:
    raise RuntimeError("Set APP_SECRET_KEY to a random secret of at least 32 characters.")

if len(AG_ADMIN_KEY) < 24:
    raise RuntimeError("Set AG_ADMIN_KEY to a separate secret of at least 24 characters.")

app.config.update(
    SECRET_KEY=APP_SECRET_KEY,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "true").lower()
        in ("1", "true", "yes"),
    SESSION_COOKIE_SAMESITE="Lax",
    PERMANENT_SESSION_LIFETIME=timedelta(days=7),
    MAX_CONTENT_LENGTH=1 * 1024 * 1024,
)

FREE_TOOLS = 20
TOTAL_TOOLS = 53
VIP_DAYS = 30


# --------------------------------------------------
# DATABASE
# --------------------------------------------------

def get_db():
    folder = os.path.dirname(os.path.abspath(DB_PATH))
    os.makedirs(folder, exist_ok=True)

    db = sqlite3.connect(DB_PATH, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout = 15000")
    return db


def init_db():
    with get_db() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'normal',
                vip_until TEXT,
                created_at TEXT NOT NULL
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS vip_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                payment_method TEXT NOT NULL,
                transaction_ref TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                reviewed_at TEXT,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        """)

        db.execute("""
            CREATE INDEX IF NOT EXISTS idx_vip_requests_status
            ON vip_requests(status)
        """)


def utc_now():
    return datetime.now(timezone.utc)


def iso_time(value):
    return value.isoformat()


def parse_time(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except (ValueError, TypeError):
        return None


def vip_active(user):
    if user["role"] == "admin":
        return True

    if user["role"] != "vip":
        return False

    expiry = parse_time(user["vip_until"])
    return bool(expiry and expiry > utc_now())


def public_user(user):
    active = vip_active(user)

    return {
        "id": user["id"],
        "email": user["email"],
        "role": "admin" if user["role"] == "admin" else (
            "vip" if active else "normal"
        ),
        "vip_active": active,
        "vip_until": user["vip_until"],
        "free_tools": FREE_TOOLS,
        "total_tools": TOTAL_TOOLS if active or user["role"] == "admin"
            else FREE_TOOLS,
        "vip_days": VIP_DAYS,
    }


init_db()


# --------------------------------------------------
# SECURITY HELPERS
# --------------------------------------------------

def error(message, status=400):
    return jsonify({"ok": False, "error": message}), status


def csrf_token():
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_urlsafe(32)
    return session["csrf_token"]


def csrf_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        supplied = request.headers.get("X-CSRF-Token", "")
        expected = session.get("csrf_token", "")

        if not expected or not supplied or not secrets.compare_digest(
            supplied, expected
        ):
            return error("CSRF token missing or invalid. Get a fresh token from /api/csrf.", 403)

        return fn(*args, **kwargs)
    return wrapper


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user_id = session.get("user_id")
        if not user_id:
            return error("Please log in first.", 401)

        with get_db() as db:
            user = db.execute(
                "SELECT * FROM users WHERE id = ?", (user_id,)
            ).fetchone()

        if user is None:
            session.clear()
            return error("Account not found. Please log in again.", 401)

        return fn(user, *args, **kwargs)
    return wrapper


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        supplied = request.headers.get("X-Admin-Key", "")

        if not supplied or not secrets.compare_digest(supplied, AG_ADMIN_KEY):
            return error("Admin authorization failed.", 403)

        return fn(*args, **kwargs)
    return wrapper


def get_json():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


# --------------------------------------------------
# PUBLIC ROUTES
# --------------------------------------------------

@app.get("/")
def home():
    return jsonify({
        "name": "AG TOOLS Backend",
        "status": "ok",
        "health": "/api/health",
        "version": "1.0"
    })


@app.get("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "time": iso_time(utc_now())
    })


@app.get("/api/csrf")
def get_csrf():
    return jsonify({"ok": True, "csrf_token": csrf_token()})


# --------------------------------------------------
# REGISTER / LOGIN / ACCOUNT
# --------------------------------------------------

@app.post("/api/register")
@csrf_required
def register():
    data = get_json()
    email = str(data.get("email", "")).strip().lower()
    password = data.get("password", "")

    if len(email) > 254 or "@" not in email or "." not in email.split("@")[-1]:
        return error("Enter a valid email address.")

    if not isinstance(password, str) or len(password) < 8 or len(password) > 256:
        return error("Password must be 8 to 256 characters.")

    hashed = generate_password_hash(password)
    now = iso_time(utc_now())

    try:
        with get_db() as db:
            cursor = db.execute("""
                INSERT INTO users (email, password_hash, role, created_at)
                VALUES (?, ?, 'normal', ?)
            """, (email, hashed, now))
            user_id = cursor.lastrowid
    except sqlite3.IntegrityError:
        return error("An account with this email already exists.", 409)

    session.clear()
    session.permanent = True
    session["user_id"] = user_id
    csrf_token()

    with get_db() as db:
        user = db.execute(
            "SELECT * FROM users WHERE id = ?", (user_id,)
        ).fetchone()

    return jsonify({
        "ok": True,
        "message": "Account created successfully.",
        "user": public_user(user),
        "csrf_token": session["csrf_token"]
    }), 201


@app.post("/api/login")
@csrf_required
def login():
    data = get_json()
    email = str(data.get("email", "")).strip().lower()
    password = data.get("password", "")

    if not isinstance(password, str):
        return error("Invalid email or password.", 401)

    with get_db() as db:
        user = db.execute(
            "SELECT * FROM users WHERE email = ?", (email,)
        ).fetchone()

    if user is None or not check_password_hash(
        user["password_hash"], password
    ):
        return error("Invalid email or password.", 401)

    session.clear()
    session.permanent = True
    session["user_id"] = user["id"]
    csrf_token()

    return jsonify({
        "ok": True,
        "message": "Login successful.",
        "user": public_user(user),
        "csrf_token": session["csrf_token"]
    })


@app.get("/api/me")
@login_required
def me(user):
    return jsonify({"ok": True, "user": public_user(user)})


@app.post("/api/logout")
@csrf_required
@login_required
def logout(user):
    session.clear()
    return jsonify({"ok": True, "message": "Logged out successfully."})


# --------------------------------------------------
# VIP MEMBERSHIP REQUEST
# --------------------------------------------------

@app.post("/api/vip/request")
@csrf_required
@login_required
def request_vip(user):
    data = get_json()
    method = str(data.get("payment_method", "")).strip()
    reference = str(data.get("transaction_ref", "")).strip()

    if method not in ("bKash", "Nagad", "Other"):
        return error("Choose bKash, Nagad, or Other.")

    if not 4 <= len(reference) <= 100:
        return error("Enter a valid payment transaction reference.")

    with get_db() as db:
        existing = db.execute("""
            SELECT id FROM vip_requests
            WHERE user_id = ? AND status = 'pending'
        """, (user["id"],)).fetchone()

        if existing:
            return error("You already have a pending VIP request.", 409)

        db.execute("""
            INSERT INTO vip_requests
            (user_id, payment_method, transaction_ref, status, created_at)
            VALUES (?, ?, ?, 'pending', ?)
        """, (
            user["id"], method, reference, iso_time(utc_now())
        ))

    return jsonify({
        "ok": True,
        "message": "VIP request submitted. Membership stays inactive until an admin verifies payment."
    }), 201


@app.get("/api/vip/status")
@login_required
def vip_status(user):
    with get_db() as db:
        requests = db.execute("""
            SELECT id, payment_method, transaction_ref, status,
                   created_at, reviewed_at
            FROM vip_requests
            WHERE user_id = ?
            ORDER BY id DESC LIMIT 10
        """, (user["id"],)).fetchall()

    return jsonify({
        "ok": True,
        "user": public_user(user),
        "requests": [dict(item) for item in requests]
    })


# --------------------------------------------------
# ADMIN: REVIEW VIP REQUESTS
# --------------------------------------------------

@app.get("/admin/pending-vip")
@admin_required
def pending_vip():
    with get_db() as db:
        rows = db.execute("""
            SELECT r.id, r.user_id, u.email, r.payment_method,
                   r.transaction_ref, r.status, r.created_at
            FROM vip_requests r
            JOIN users u ON u.id = r.user_id
            WHERE r.status = 'pending'
            ORDER BY r.id ASC
        """).fetchall()

    return jsonify({"ok": True, "requests": [dict(row) for row in rows]})


@app.post("/admin/grant-vip")
@admin_required
def grant_vip():
    data = get_json()

    try:
        request_id = int(data.get("request_id"))
    except (TypeError, ValueError):
        return error("A valid request_id is required.")

    now = utc_now()
    reviewed = iso_time(now)
    expiry = iso_time(now + timedelta(days=VIP_DAYS))

    with get_db() as db:
        row = db.execute("""
            SELECT * FROM vip_requests
            WHERE id = ? AND status = 'pending'
        """, (request_id,)).fetchone()

        if row is None:
            return error("Pending request not found.", 404)

        db.execute("""
            UPDATE users SET role = 'vip', vip_until = ?
            WHERE id = ?
        """, (expiry, row["user_id"]))

        db.execute("""
            UPDATE vip_requests SET status = 'approved', reviewed_at = ?
            WHERE id = ?
        """, (reviewed, request_id))

    return jsonify({
        "ok": True,
        "message": "VIP membership granted.",
        "vip_until": expiry
    })


@app.post("/admin/revoke-vip")
@admin_required
def revoke_vip():
    data = get_json()

    try:
        user_id = int(data.get("user_id"))
    except (TypeError, ValueError):
        return error("A valid user_id is required.")

    with get_db() as db:
        user = db.execute(
            "SELECT id, role FROM users WHERE id = ?", (user_id,)
        ).fetchone()

        if user is None:
            return error("User not found.", 404)

        db.execute("""
            UPDATE users SET role = 'normal', vip_until = NULL
            WHERE id = ?
        """, (user_id,))

    return jsonify({"ok": True, "message": "VIP membership revoked."})


# --------------------------------------------------
# ERROR HANDLERS
# --------------------------------------------------

@app.errorhandler(404)
def not_found(exc):
    return jsonify({"ok": False, "error": "Route not found."}), 404


@app.errorhandler(413)
def too_large(exc):
    return jsonify({"ok": False, "error": "Request body is too large."}), 413


@app.errorhandler(500)
def server_error(exc):
    app.logger.exception("Unexpected server error")
    return jsonify({"ok": False, "error": "Internal server error."}), 500


# --------------------------------------------------
# LOCAL DEVELOPMENT
# Render runs the app with Gunicorn instead.
# --------------------------------------------------

if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=int(os.environ.get("PORT", "5000")),
        debug=False
    )
