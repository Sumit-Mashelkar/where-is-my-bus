"""TransitPulse — Flask + SQLite + python-socketio (ASGI)."""
from __future__ import annotations

import asyncio
import os
import sqlite3
import uuid
import math
import json as _json
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional
from urllib.request import urlopen, Request as URequest
from urllib.parse import urlencode

from flask import Flask, jsonify, request, g
from flask_cors import CORS
from asgiref.wsgi import WsgiToAsgi
import socketio
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

DB_PATH = ROOT_DIR / "transitpulse.db"

flask_app = Flask(__name__)
CORS(flask_app, resources={r"/api/*": {"origins": "*"}})


@flask_app.errorhandler(400)
def bad_request(e):
    return jsonify({"error": "bad_request", "detail": str(e)}), 400


@flask_app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "not_found", "detail": str(e)}), 404


@flask_app.errorhandler(409)
def conflict(e):
    return jsonify({"error": "conflict", "detail": str(e)}), 409


@flask_app.errorhandler(429)
def rate_limited(e):
    return jsonify({"error": "rate_limited", "detail": "Too many requests"}), 429


@flask_app.errorhandler(500)
def server_error(e):
    return jsonify({"error": "server_error", "detail": "An internal error occurred"}), 500


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, check_same_thread=False)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
        g.db.execute("PRAGMA journal_mode = WAL")
        g.db.execute("PRAGMA synchronous  = NORMAL")
        g.db.execute("PRAGMA cache_size   = -16000")
        g.db.execute("PRAGMA temp_store   = MEMORY")
    return g.db


@flask_app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


# ── confidence / reputation helpers ───────────────────────────────────────────

def compute_confidence(confirmations: int, rejections: int) -> float:
    total = confirmations + rejections
    if total == 0:
        return 0.5
    return round(confirmations / total, 3)


def confidence_label(score: float) -> str:
    if score >= 0.7:
        return "high"
    if score >= 0.4:
        return "medium"
    return "low"


VERIFIED_MIN_CONFIRMS = 3
VERIFIED_MIN_CONFIDENCE = 0.7
RATE_LIMIT_SECONDS = 60
MERGE_WINDOW_MINUTES = 10


def upsert_reputation(db: sqlite3.Connection, user_id: str) -> None:
    db.execute(
        "INSERT OR IGNORE INTO user_reputation (user_id, trust_points, updates_submitted,"
        " updates_confirmed, updates_rejected, votes_cast, created_at)"
        " VALUES (?, 100, 0, 0, 0, 0, ?)",
        (user_id, now_iso()),
    )


def reputation_badge(trust_points: int, updates_confirmed: int, updates_submitted: int, votes_cast: int) -> str:
    if trust_points >= 250 and updates_confirmed >= 5:
        return "Trusted Commuter"
    if trust_points >= 150 and votes_cast >= 10:
        return "Verified Commuter"
    if updates_submitted >= 3:
        return "Frequent Reporter"
    return "New Rider"


def serialize_update(r, user_id: Optional[str] = None, db=None) -> dict:
    conf = r["confidence"] if r["confidence"] is not None else 0.5
    out = {
        "update_id":        r["update_id"],
        "bus_id":           r["bus_id"],
        "stop_index":       r["stop_index"],
        "stop_name":        r["stop_name"],
        "status":           r["status"],
        "direction":        r["direction"],
        "reported_by":      r["reported_by"],
        "confirmations":    r["confirmations"],
        "rejections":       r["rejections"],
        "confidence":       conf,
        "confidence_label": confidence_label(conf),
        "verified":         bool(r["verified"]),
        "verified_at":      r["verified_at"],
        "created_at":       r["created_at"],
        "user_vote":        None,
        "is_own":           False,
    }
    if user_id and db:
        vote_row = db.execute(
            "SELECT vote FROM update_votes WHERE update_id=? AND user_id=?",
            (r["update_id"], user_id),
        ).fetchone()
        out["user_vote"] = vote_row["vote"] if vote_row else None
        out["is_own"] = r["reported_by"] == user_id
    return out


# ── DB init ───────────────────────────────────────────────────────────────────

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS stops (
            stop_id TEXT PRIMARY KEY,
            name    TEXT NOT NULL,
            lat     REAL NOT NULL,
            lng     REAL NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS buses (
            bus_id              TEXT PRIMARY KEY,
            number              TEXT NOT NULL,
            name                TEXT NOT NULL,
            direction           TEXT,
            departure_time      TEXT NOT NULL DEFAULT '06:00',
            arrival_time        TEXT NOT NULL DEFAULT '22:00',
            status              TEXT NOT NULL DEFAULT 'running',
            current_lat         REAL,
            current_lng         REAL,
            last_update         TEXT,
            current_stop_index  INTEGER NOT NULL DEFAULT 0,
            created_at          TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS bus_stops (
            bus_id    TEXT NOT NULL,
            stop_id   TEXT NOT NULL,
            position  INTEGER NOT NULL,
            PRIMARY KEY (bus_id, position),
            FOREIGN KEY (bus_id) REFERENCES buses(bus_id) ON DELETE CASCADE,
            FOREIGN KEY (stop_id) REFERENCES stops(stop_id)
        );
        CREATE TABLE IF NOT EXISTS bus_updates (
            update_id     TEXT PRIMARY KEY,
            bus_id        TEXT NOT NULL,
            stop_index    INTEGER NOT NULL,
            stop_name     TEXT NOT NULL,
            status        TEXT NOT NULL,
            direction     TEXT,
            reported_by   TEXT NOT NULL,
            confirmations INTEGER NOT NULL DEFAULT 0,
            rejections    INTEGER NOT NULL DEFAULT 0,
            confidence    REAL NOT NULL DEFAULT 0.5,
            verified      INTEGER NOT NULL DEFAULT 0,
            verified_at   TEXT,
            created_at    TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS update_votes (
            vote_id    TEXT PRIMARY KEY,
            update_id  TEXT NOT NULL,
            user_id    TEXT NOT NULL,
            vote       TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE (update_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS user_reputation (
            user_id           TEXT PRIMARY KEY,
            trust_points      INTEGER NOT NULL DEFAULT 100,
            updates_submitted INTEGER NOT NULL DEFAULT 0,
            updates_confirmed INTEGER NOT NULL DEFAULT 0,
            updates_rejected  INTEGER NOT NULL DEFAULT 0,
            votes_cast        INTEGER NOT NULL DEFAULT 0,
            created_at        TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pending_routes (
            route_id      TEXT PRIMARY KEY,
            bus_number    TEXT NOT NULL,
            bus_name      TEXT NOT NULL,
            direction     TEXT,
            stops_json    TEXT NOT NULL,
            submitted_by  TEXT NOT NULL,
            upvotes       INTEGER NOT NULL DEFAULT 0,
            downvotes     INTEGER NOT NULL DEFAULT 0,
            status        TEXT NOT NULL DEFAULT 'pending',
            verified_at   TEXT,
            created_at    TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pending_route_votes (
            vote_id    TEXT PRIMARY KEY,
            route_id   TEXT NOT NULL,
            user_id    TEXT NOT NULL,
            vote       TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE (route_id, user_id)
        );
        """
    )
    conn.commit()

    # Migrations — safe to run repeatedly
    for migration in [
        "ALTER TABLE buses ADD COLUMN current_stop_index INTEGER NOT NULL DEFAULT 0",
    ]:
        try:
            conn.execute(migration)
            conn.commit()
        except Exception:
            pass

    # Indexes — idempotent, improve read performance
    for idx_sql in [
        "CREATE INDEX IF NOT EXISTS idx_bus_updates_bus_time   ON bus_updates(bus_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_bus_updates_verified   ON bus_updates(verified, bus_id)",
        "CREATE INDEX IF NOT EXISTS idx_bus_updates_merge      ON bus_updates(bus_id, stop_index, status, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_update_votes_lookup    ON update_votes(update_id, user_id)",
        "CREATE INDEX IF NOT EXISTS idx_bus_stops_bus          ON bus_stops(bus_id, position)",
        "CREATE INDEX IF NOT EXISTS idx_buses_status           ON buses(status)",
        "CREATE INDEX IF NOT EXISTS idx_pending_routes_status  ON pending_routes(status, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_pending_route_votes    ON pending_route_votes(route_id, user_id)",
    ]:
        try:
            conn.execute(idx_sql)
        except Exception:
            pass
    conn.commit()

    cur.execute("SELECT COUNT(*) FROM stops")
    if cur.fetchone()[0] == 0:
        seed = [
            ("Central Station", 40.7527, -73.9772),
            ("Times Square",    40.7580, -73.9855),
            ("Union Square",    40.7359, -73.9911),
            ("Wall Street",     40.7074, -74.0113),
            ("Brooklyn Bridge", 40.7061, -73.9969),
            ("Empire State",    40.7484, -73.9857),
            ("Columbus Circle", 40.7681, -73.9819),
            ("Lincoln Center",  40.7725, -73.9835),
            ("Penn Station",    40.7506, -73.9935),
            ("Bryant Park",     40.7536, -73.9832),
            ("Harlem Plaza",    40.8116, -73.9465),
            ("Grand Central",   40.7527, -73.9772),
        ]
        stop_ids = {}
        for name, lat, lng in seed:
            sid = uid("stop")
            stop_ids[name] = sid
            cur.execute(
                "INSERT INTO stops (stop_id, name, lat, lng, created_at) VALUES (?,?,?,?,?)",
                (sid, name, lat, lng, now_iso()),
            )
        demo_buses = [
            ("M15", "Downtown Express",
             ["Central Station", "Times Square", "Empire State", "Union Square", "Wall Street"],
             40.7580, -73.9855, "06:00", "08:15", 2),
            ("B25", "Brooklyn Loop",
             ["Wall Street", "Brooklyn Bridge", "Union Square", "Bryant Park"],
             40.7074, -74.0113, "07:30", "09:00", 1),
            ("M5", "Uptown Cruiser",
             ["Penn Station", "Bryant Park", "Grand Central", "Columbus Circle", "Lincoln Center", "Harlem Plaza"],
             40.7681, -73.9819, "08:00", "10:30", 3),
            ("Q44", "Midtown Shuttle",
             ["Times Square", "Bryant Park", "Grand Central", "Empire State"],
             40.7536, -73.9832, "09:15", "10:00", 1),
        ]
        for number, bname, stops, lat, lng, dep, arr, csi in demo_buses:
            bid = uid("bus")
            cur.execute(
                "INSERT INTO buses (bus_id, number, name, current_lat, current_lng, last_update,"
                " departure_time, arrival_time, current_stop_index, created_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?)",
                (bid, number, bname, lat, lng, now_iso(), dep, arr, csi, now_iso()),
            )
            for pos, sname in enumerate(stops):
                cur.execute(
                    "INSERT INTO bus_stops (bus_id, stop_id, position) VALUES (?,?,?)",
                    (bid, stop_ids[sname], pos),
                )
        conn.commit()
    conn.close()


init_db()


# ── row serializers ────────────────────────────────────────────────────────────

def stop_row(r) -> dict:
    return {"stop_id": r["stop_id"], "name": r["name"], "lat": r["lat"], "lng": r["lng"]}


def bus_row(r, db: sqlite3.Connection, with_stops: bool = False) -> dict:
    keys = r.keys()
    out = {
        "bus_id":           r["bus_id"],
        "number":           r["number"],
        "name":             r["name"],
        "direction":        r["direction"] if "direction" in keys else None,
        "departure_time":   r["departure_time"],
        "arrival_time":     r["arrival_time"],
        "status":           r["status"],
        "current_lat":      r["current_lat"],
        "current_lng":      r["current_lng"],
        "last_update":      r["last_update"],
        "current_stop_index": r["current_stop_index"] if "current_stop_index" in keys else 0,
    }
    if with_stops:
        rows = db.execute(
            "SELECT s.stop_id, s.name, s.lat, s.lng FROM bus_stops bs "
            "JOIN stops s ON s.stop_id = bs.stop_id WHERE bs.bus_id = ? ORDER BY bs.position",
            (r["bus_id"],),
        ).fetchall()
        out["stops"] = [stop_row(x) for x in rows]
    return out


def haversine(lat1, lng1, lat2, lng2) -> float:
    R = 6371.0
    dl  = math.radians(lat2 - lat1)
    dlg = math.radians(lng2 - lng1)
    a = (math.sin(dl / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlg / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(a))


VALID_STATUSES = {"running", "delayed", "arriving", "cancelled", "bus_full"}


# ── routes: meta ──────────────────────────────────────────────────────────────

@flask_app.get("/api/")
def root():
    return jsonify({"app": "TransitPulse", "status": "ok"})


@flask_app.get("/api/healthz")
def healthz():
    return jsonify({"status": "ok"})


# ── routes: stops ─────────────────────────────────────────────────────────────

@flask_app.get("/api/stops")
def list_stops():
    rows = get_db().execute("SELECT * FROM stops ORDER BY name").fetchall()
    return jsonify([stop_row(r) for r in rows])


@flask_app.post("/api/stops")
def create_stop():
    body = request.get_json(force=True, silent=True) or {}
    name, lat, lng = body.get("name"), body.get("lat"), body.get("lng")
    if not name or lat is None or lng is None:
        return jsonify({"detail": "name, lat, lng required"}), 400
    sid = uid("stop")
    db = get_db()
    db.execute(
        "INSERT INTO stops (stop_id, name, lat, lng, created_at) VALUES (?,?,?,?,?)",
        (sid, name.strip(), float(lat), float(lng), now_iso()),
    )
    db.commit()
    return jsonify({"stop_id": sid, "name": name, "lat": float(lat), "lng": float(lng)})


# ── routes: buses ─────────────────────────────────────────────────────────────

@flask_app.get("/api/buses")
def list_buses():
    db = get_db()
    rows = db.execute("SELECT * FROM buses ORDER BY number").fetchall()
    return jsonify([bus_row(r, db) for r in rows])


@flask_app.get("/api/buses/<bus_id>")
def get_bus(bus_id):
    db = get_db()
    r = db.execute("SELECT * FROM buses WHERE bus_id = ?", (bus_id,)).fetchone()
    if not r:
        return jsonify({"detail": "Bus not found"}), 404
    return jsonify(bus_row(r, db, with_stops=True))


@flask_app.post("/api/buses")
def create_bus():
    body = request.get_json(force=True, silent=True) or {}
    number = (body.get("number") or "").strip()
    name   = (body.get("name")   or "").strip()
    stops  = body.get("stops") or []
    if not number or not name or len(stops) < 2:
        return jsonify({"detail": "number, name, and at least 2 stops required"}), 400
    db = get_db()
    placeholders = ",".join("?" * len(stops))
    found_ids = {r["stop_id"] for r in db.execute(
        f"SELECT stop_id FROM stops WHERE stop_id IN ({placeholders})", stops
    ).fetchall()}
    missing = set(stops) - found_ids
    if missing:
        return jsonify({"detail": f"unknown stops: {sorted(missing)}"}), 400
    status = body.get("status", "running")
    if status not in VALID_STATUSES:
        return jsonify({"detail": f"status must be one of {sorted(VALID_STATUSES)}"}), 400
    bid = uid("bus")
    db.execute(
        "INSERT INTO buses (bus_id, number, name, direction, departure_time, arrival_time, status, created_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (bid, number, name,
         (body.get("direction") or "").strip() or None,
         body.get("departure_time", "06:00"),
         body.get("arrival_time", "22:00"),
         status, now_iso()),
    )
    for pos, sid in enumerate(stops):
        db.execute("INSERT INTO bus_stops (bus_id, stop_id, position) VALUES (?,?,?)", (bid, sid, pos))
    db.commit()
    r = db.execute("SELECT * FROM buses WHERE bus_id = ?", (bid,)).fetchone()
    new_bus = bus_row(r, db, with_stops=True)
    broadcast("bus_added", new_bus)
    return jsonify(new_bus)


@flask_app.post("/api/buses/<bus_id>/location")
def update_location(bus_id):
    body = request.get_json(force=True, silent=True) or {}
    lat, lng = body.get("lat"), body.get("lng")
    status   = body.get("status")
    if lat is None or lng is None:
        return jsonify({"detail": "lat and lng required"}), 400
    if status is not None and status not in VALID_STATUSES:
        return jsonify({"detail": f"status must be one of {sorted(VALID_STATUSES)}"}), 400
    db = get_db()
    r = db.execute("SELECT * FROM buses WHERE bus_id = ?", (bus_id,)).fetchone()
    if not r:
        return jsonify({"detail": "Bus not found"}), 404
    ts = now_iso()
    if status:
        db.execute(
            "UPDATE buses SET current_lat=?, current_lng=?, last_update=?, status=? WHERE bus_id=?",
            (float(lat), float(lng), ts, status, bus_id),
        )
    else:
        db.execute(
            "UPDATE buses SET current_lat=?, current_lng=?, last_update=? WHERE bus_id=?",
            (float(lat), float(lng), ts, bus_id),
        )
    db.commit()
    payload = {
        "bus_id": bus_id, "number": r["number"], "name": r["name"],
        "lat": float(lat), "lng": float(lng),
        "status": status or r["status"], "last_update": ts,
    }
    broadcast("bus_location", payload)
    return jsonify(payload)


@flask_app.post("/api/buses/<bus_id>/current-stop")
def update_current_stop(bus_id):
    body = request.get_json(force=True, silent=True) or {}
    idx = body.get("stop_index")
    if idx is None:
        return jsonify({"detail": "stop_index required"}), 400
    db = get_db()
    r = db.execute("SELECT * FROM buses WHERE bus_id = ?", (bus_id,)).fetchone()
    if not r:
        return jsonify({"detail": "Bus not found"}), 404
    total = db.execute("SELECT COUNT(*) as cnt FROM bus_stops WHERE bus_id=?", (bus_id,)).fetchone()["cnt"]
    idx = max(0, min(int(idx), total - 1))
    db.execute("UPDATE buses SET current_stop_index=? WHERE bus_id=?", (idx, bus_id))
    db.commit()
    payload = {"bus_id": bus_id, "current_stop_index": idx, "number": r["number"]}
    broadcast("bus_stop_update", payload)
    return jsonify(payload)


# ── routes: community status updates ─────────────────────────────────────────

@flask_app.post("/api/buses/<bus_id>/status-update")
def status_update(bus_id):
    """Stop-based status update with community verification tracking."""
    body      = request.get_json(force=True, silent=True) or {}
    stop_index = body.get("stop_index")
    status     = body.get("status")
    direction  = body.get("direction")
    user_id    = (body.get("user_id") or "anonymous").strip() or "anonymous"
    lat        = body.get("lat")
    lng        = body.get("lng")

    if stop_index is None:
        return jsonify({"detail": "stop_index required"}), 400
    if not status:
        return jsonify({"detail": "status required"}), 400
    if status not in VALID_STATUSES:
        return jsonify({"detail": f"status must be one of {sorted(VALID_STATUSES)}"}), 400

    db = get_db()
    r = db.execute("SELECT * FROM buses WHERE bus_id = ?", (bus_id,)).fetchone()
    if not r:
        return jsonify({"detail": "Bus not found"}), 404

    # Rate limit: max 1 submission per user per bus per 60 s
    if user_id != "anonymous":
        cutoff = (datetime.now(timezone.utc) - timedelta(seconds=RATE_LIMIT_SECONDS)).isoformat()
        recent = db.execute(
            "SELECT update_id FROM bus_updates WHERE bus_id=? AND reported_by=? AND created_at > ? LIMIT 1",
            (bus_id, user_id, cutoff),
        ).fetchone()
        if recent:
            return jsonify({
                "detail": "rate_limited",
                "message": f"Please wait {RATE_LIMIT_SECONDS} seconds before submitting another update",
            }), 429

    # Fetch route stops
    stop_rows = db.execute(
        "SELECT s.stop_id, s.name, s.lat, s.lng FROM bus_stops bs "
        "JOIN stops s ON s.stop_id = bs.stop_id WHERE bs.bus_id = ? ORDER BY bs.position",
        (bus_id,),
    ).fetchall()
    stops = [dict(s) for s in stop_rows]
    total = len(stops)
    idx   = max(0, min(int(stop_index), total - 1))
    ts    = now_iso()
    stop_name = stops[idx]["name"] if stops else "Unknown"

    # Smart merge: same stop+status within MERGE_WINDOW_MINUTES
    merge_cutoff = (datetime.now(timezone.utc) - timedelta(minutes=MERGE_WINDOW_MINUTES)).isoformat()
    existing = db.execute(
        "SELECT update_id, confirmations, rejections FROM bus_updates "
        "WHERE bus_id=? AND stop_index=? AND status=? AND created_at > ? AND verified=0 "
        "ORDER BY created_at DESC LIMIT 1",
        (bus_id, idx, status, merge_cutoff),
    ).fetchone()

    merged = False
    if existing and existing["reported_by"] if hasattr(existing, "__getitem__") else False:
        pass  # fallback handled below

    if existing:
        update_id = existing["update_id"]
        # Only add implicit confirmation if user hasn't voted yet and isn't the reporter
        reporter = db.execute("SELECT reported_by FROM bus_updates WHERE update_id=?", (update_id,)).fetchone()
        already_voted = db.execute(
            "SELECT 1 FROM update_votes WHERE update_id=? AND user_id=?", (update_id, user_id)
        ).fetchone()
        if reporter and reporter["reported_by"] != user_id and not already_voted:
            db.execute(
                "INSERT OR IGNORE INTO update_votes (vote_id, update_id, user_id, vote, created_at)"
                " VALUES (?,?,?,?,?)",
                (uid("vote"), update_id, user_id, "confirm", ts),
            )
            new_confirms = existing["confirmations"] + 1
            new_conf     = compute_confidence(new_confirms, existing["rejections"])
            now_verified = new_confirms >= VERIFIED_MIN_CONFIRMS and new_conf >= VERIFIED_MIN_CONFIDENCE
            db.execute(
                "UPDATE bus_updates SET confirmations=?, confidence=?, verified=?, verified_at=? WHERE update_id=?",
                (new_confirms, new_conf, 1 if now_verified else 0,
                 ts if now_verified else None, update_id),
            )
        merged = True
    else:
        update_id = uid("upd")
        db.execute(
            "INSERT INTO bus_updates (update_id, bus_id, stop_index, stop_name, status, direction,"
            " reported_by, confirmations, rejections, confidence, verified, created_at)"
            " VALUES (?,?,?,?,?,?,?,0,0,0.5,0,?)",
            (update_id, bus_id, idx, stop_name, status, direction, user_id, ts),
        )

    # Update the live bus record
    fields = ["current_stop_index=?", "status=?", "last_update=?"]
    values = [idx, status, ts]
    if direction is not None:
        fields.append("direction=?")
        values.append(direction.strip() or None)
    if lat is not None and lng is not None:
        fields.append("current_lat=?")
        fields.append("current_lng=?")
        values.extend([float(lat), float(lng)])
    values.append(bus_id)
    db.execute(f"UPDATE buses SET {', '.join(fields)} WHERE bus_id=?", values)

    # Update reporter's reputation
    if user_id != "anonymous":
        upsert_reputation(db, user_id)
        if not merged:
            db.execute(
                "UPDATE user_reputation SET updates_submitted = updates_submitted + 1 WHERE user_id=?",
                (user_id,),
            )

    db.commit()

    upd_row = db.execute("SELECT * FROM bus_updates WHERE update_id=?", (update_id,)).fetchone()
    upd_dict = serialize_update(upd_row, user_id, db)
    upd_dict["merged"] = merged

    prev_stop = {"name": stops[idx - 1]["name"]} if idx > 0 else None
    curr_stop = {"name": stop_name}
    next_stop = {"name": stops[idx + 1]["name"]} if idx < total - 1 else None
    upd_dict.update({
        "previous_stop": prev_stop,
        "current_stop":  curr_stop,
        "next_stop":     next_stop,
    })

    broadcast("bus_status_update", {
        "bus_id": bus_id, "number": r["number"], "name": r["name"],
        "status": status, "current_stop_index": idx, "updated_at": ts,
        "previous_stop": prev_stop, "current_stop": curr_stop, "next_stop": next_stop,
    })
    broadcast("bus_stop_update", {"bus_id": bus_id, "current_stop_index": idx, "number": r["number"]})
    broadcast("update_created", upd_dict)

    return jsonify(upd_dict)


@flask_app.get("/api/buses/<bus_id>/updates")
def list_updates(bus_id):
    user_id = request.args.get("user_id", "")
    db = get_db()
    rows = db.execute(
        "SELECT * FROM bus_updates WHERE bus_id=? ORDER BY created_at DESC LIMIT 15",
        (bus_id,),
    ).fetchall()
    return jsonify([serialize_update(r, user_id or None, db) for r in rows])


@flask_app.post("/api/updates/<update_id>/vote")
def cast_vote(update_id):
    body    = request.get_json(force=True, silent=True) or {}
    user_id = (body.get("user_id") or "").strip()
    vote    = (body.get("vote")    or "").strip()

    if not user_id:
        return jsonify({"detail": "user_id required"}), 400
    if vote not in ("confirm", "reject"):
        return jsonify({"detail": "vote must be 'confirm' or 'reject'"}), 400

    db = get_db()
    upd = db.execute("SELECT * FROM bus_updates WHERE update_id=?", (update_id,)).fetchone()
    if not upd:
        return jsonify({"detail": "Update not found"}), 404

    # Can't vote on own update
    if upd["reported_by"] == user_id:
        return jsonify({"detail": "Cannot vote on your own report"}), 403

    # One vote per user per update (INSERT OR IGNORE won't raise, but we check)
    existing_vote = db.execute(
        "SELECT vote FROM update_votes WHERE update_id=? AND user_id=?", (update_id, user_id)
    ).fetchone()
    if existing_vote:
        return jsonify({"detail": "already_voted", "your_vote": existing_vote["vote"]}), 409

    ts = now_iso()
    db.execute(
        "INSERT INTO update_votes (vote_id, update_id, user_id, vote, created_at) VALUES (?,?,?,?,?)",
        (uid("vote"), update_id, user_id, vote, ts),
    )

    new_confirms = upd["confirmations"] + (1 if vote == "confirm" else 0)
    new_rejects  = upd["rejections"]   + (1 if vote == "reject"  else 0)
    new_conf     = compute_confidence(new_confirms, new_rejects)
    now_verified = (
        new_confirms >= VERIFIED_MIN_CONFIRMS
        and new_conf >= VERIFIED_MIN_CONFIDENCE
        and not upd["verified"]
    )
    verified_at  = ts if now_verified else upd["verified_at"]

    db.execute(
        "UPDATE bus_updates SET confirmations=?, rejections=?, confidence=?, verified=?, verified_at=?"
        " WHERE update_id=?",
        (new_confirms, new_rejects, new_conf,
         1 if (now_verified or upd["verified"]) else 0,
         verified_at, update_id),
    )

    # Reputation: voter
    upsert_reputation(db, user_id)
    db.execute(
        "UPDATE user_reputation SET votes_cast = votes_cast + 1 WHERE user_id=?", (user_id,)
    )

    # Reputation: reporter gets +20 if update just got verified, -10 if confidence drops below 0.3
    reporter = upd["reported_by"]
    if reporter != "anonymous":
        upsert_reputation(db, reporter)
        if now_verified:
            db.execute(
                "UPDATE user_reputation SET trust_points = trust_points + 20,"
                " updates_confirmed = updates_confirmed + 1 WHERE user_id=?",
                (reporter,),
            )
        elif new_conf < 0.3 and new_rejects >= 3:
            db.execute(
                "UPDATE user_reputation SET trust_points = MAX(0, trust_points - 10),"
                " updates_rejected = updates_rejected + 1 WHERE user_id=?",
                (reporter,),
            )

    db.commit()

    upd_row = db.execute("SELECT * FROM bus_updates WHERE update_id=?", (update_id,)).fetchone()
    result  = serialize_update(upd_row, user_id, db)

    broadcast("update_voted", result)
    if now_verified:
        broadcast("update_verified", result)

    return jsonify(result)


@flask_app.get("/api/users/<user_id>/reputation")
def get_reputation(user_id):
    db = get_db()
    row = db.execute("SELECT * FROM user_reputation WHERE user_id=?", (user_id,)).fetchone()
    if not row:
        return jsonify({
            "user_id": user_id, "trust_points": 100,
            "updates_submitted": 0, "updates_confirmed": 0,
            "updates_rejected": 0, "votes_cast": 0,
            "badge": "New Rider",
        })
    return jsonify({
        "user_id":           row["user_id"],
        "trust_points":      row["trust_points"],
        "updates_submitted": row["updates_submitted"],
        "updates_confirmed": row["updates_confirmed"],
        "updates_rejected":  row["updates_rejected"],
        "votes_cast":        row["votes_cast"],
        "badge": reputation_badge(
            row["trust_points"], row["updates_confirmed"],
            row["updates_submitted"], row["votes_cast"],
        ),
    })


# ── routes: search ────────────────────────────────────────────────────────────

@flask_app.post("/api/routes/search")
def search_routes():
    body   = request.get_json(force=True, silent=True) or {}
    origin = (body.get("origin")      or "").strip().lower()
    dest   = (body.get("destination") or "").strip().lower()
    if not origin or not dest:
        return jsonify({"detail": "origin and destination required"}), 400
    db    = get_db()
    stops = {r["stop_id"]: dict(r) for r in db.execute("SELECT * FROM stops").fetchall()}

    def match(query: str):
        for s in stops.values():
            if query in s["name"].lower():
                return s
        return None

    o_stop = match(origin)
    d_stop = match(dest)
    if not o_stop or not d_stop:
        return jsonify({
            "origin_stop":      stop_row(o_stop) if o_stop else None,
            "destination_stop": stop_row(d_stop) if d_stop else None,
            "buses": [],
        })

    bus_rows_all = db.execute("SELECT * FROM buses").fetchall()
    results = []
    for b in bus_rows_all:
        ordered = db.execute(
            "SELECT stop_id FROM bus_stops WHERE bus_id=? ORDER BY position", (b["bus_id"],)
        ).fetchall()
        ids = [r["stop_id"] for r in ordered]
        if o_stop["stop_id"] not in ids or d_stop["stop_id"] not in ids:
            continue
        oi = ids.index(o_stop["stop_id"])
        di = ids.index(d_stop["stop_id"])
        if oi >= di:
            continue
        segment = [stops[ids[i]] for i in range(oi, di + 1)]
        dist = sum(
            haversine(segment[i]["lat"], segment[i]["lng"], segment[i + 1]["lat"], segment[i + 1]["lng"])
            for i in range(len(segment) - 1)
        )
        eta_min = max(1, int(dist / 25 * 60) + 2)
        if b["status"] == "delayed":   eta_min += 8
        elif b["status"] == "cancelled": eta_min += 30
        bus = bus_row(b, db)
        bus["eta_min"]      = eta_min
        bus["from_stop"]    = stop_row(o_stop)
        bus["to_stop"]      = stop_row(d_stop)
        bus["segment_stops"] = [stop_row(s) for s in segment]
        results.append(bus)
    results.sort(key=lambda x: x["eta_min"])
    return jsonify({
        "origin_stop":      stop_row(o_stop),
        "destination_stop": stop_row(d_stop),
        "buses": results,
    })


# ── geocode (Nominatim proxy) ──────────────────────────────────────────────────

@flask_app.get("/api/geocode")
def geocode():
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify({"detail": "q required"}), 400
    params = urlencode({"q": q + " New York City", "format": "json", "limit": 3})
    url = f"https://nominatim.openstreetmap.org/search?{params}"
    try:
        req = URequest(url, headers={"User-Agent": "TransitPulse/1.0"})
        with urlopen(req, timeout=6) as r:
            data = _json.loads(r.read())
        if not data:
            return jsonify({"found": False, "results": []})
        results = [
            {
                "found": True,
                "lat": float(item["lat"]),
                "lng": float(item["lon"]),
                "display_name": item.get("display_name", q),
                "short_name": item.get("display_name", q).split(",")[0].strip(),
            }
            for item in data[:3]
        ]
        return jsonify({"found": True, "results": results})
    except Exception:
        return jsonify({"found": False, "results": []})


# ── pending route proposals ────────────────────────────────────────────────────

def _pending_row(row, user_id: str = "") -> dict:
    stops = _json.loads(row["stops_json"]) if isinstance(row["stops_json"], str) else []
    user_vote = None
    if user_id:
        db = get_db()
        v = db.execute(
            "SELECT vote FROM pending_route_votes WHERE route_id=? AND user_id=?",
            (row["route_id"], user_id),
        ).fetchone()
        if v:
            user_vote = v["vote"]
    total = (row["upvotes"] or 0) + (row["downvotes"] or 0)
    confidence = (row["upvotes"] or 0) / total if total > 0 else 0.5
    return {
        "route_id":    row["route_id"],
        "bus_number":  row["bus_number"],
        "bus_name":    row["bus_name"],
        "direction":   row["direction"],
        "stops":       stops,
        "submitted_by": row["submitted_by"],
        "upvotes":     row["upvotes"] or 0,
        "downvotes":   row["downvotes"] or 0,
        "confidence":  round(confidence, 3),
        "status":      row["status"],
        "verified_at": row["verified_at"],
        "created_at":  row["created_at"],
        "user_vote":   user_vote,
    }


@flask_app.get("/api/routes/pending")
def list_pending_routes():
    user_id = (request.args.get("user_id") or "").strip()
    db = get_db()
    rows = db.execute(
        "SELECT * FROM pending_routes ORDER BY created_at DESC LIMIT 80"
    ).fetchall()
    return jsonify([_pending_row(r, user_id) for r in rows])


@flask_app.post("/api/routes/propose")
def propose_route():
    body        = request.get_json(force=True, silent=True) or {}
    bus_number  = (body.get("bus_number") or "").strip()
    bus_name    = (body.get("bus_name")   or "").strip()
    direction   = (body.get("direction")  or "").strip()
    stops_data  = body.get("stops") or []
    user_id     = (body.get("user_id")    or "anonymous").strip()

    if not bus_number or not bus_name:
        return jsonify({"detail": "bus_number and bus_name required"}), 400
    if len(stops_data) < 2:
        return jsonify({"detail": "At least 2 stops required"}), 400

    route_id = uid("route")
    ts       = now_iso()
    db       = get_db()
    db.execute(
        "INSERT INTO pending_routes "
        "(route_id, bus_number, bus_name, direction, stops_json, submitted_by, upvotes, downvotes, status, created_at)"
        " VALUES (?,?,?,?,?,?,0,0,'pending',?)",
        (route_id, bus_number, bus_name, direction or None, _json.dumps(stops_data), user_id, ts),
    )
    db.commit()
    result = _pending_row(db.execute("SELECT * FROM pending_routes WHERE route_id=?", (route_id,)).fetchone())
    broadcast("route_proposed", result)
    return jsonify(result), 201


@flask_app.post("/api/routes/pending/<route_id>/vote")
def vote_pending_route(route_id):
    body    = request.get_json(force=True, silent=True) or {}
    user_id = (body.get("user_id") or "").strip()
    vote    = (body.get("vote")    or "").strip()

    if not user_id:
        return jsonify({"detail": "user_id required"}), 400
    if vote not in ("up", "down"):
        return jsonify({"detail": "vote must be 'up' or 'down'"}), 400

    db  = get_db()
    row = db.execute("SELECT * FROM pending_routes WHERE route_id=?", (route_id,)).fetchone()
    if not row:
        return jsonify({"detail": "Route not found"}), 404
    if row["submitted_by"] == user_id:
        return jsonify({"detail": "Cannot vote on your own proposal"}), 403
    if row["status"] != "pending":
        return jsonify({"detail": "Route already finalised"}), 409

    existing = db.execute(
        "SELECT vote FROM pending_route_votes WHERE route_id=? AND user_id=?", (route_id, user_id)
    ).fetchone()
    if existing:
        return jsonify({"detail": "already_voted", "your_vote": existing["vote"]}), 409

    ts = now_iso()
    db.execute(
        "INSERT INTO pending_route_votes (vote_id, route_id, user_id, vote, created_at) VALUES (?,?,?,?,?)",
        (uid("rvote"), route_id, user_id, vote, ts),
    )

    new_up   = (row["upvotes"]   or 0) + (1 if vote == "up"   else 0)
    new_down = (row["downvotes"] or 0) + (1 if vote == "down" else 0)
    total    = new_up + new_down
    conf     = new_up / total if total > 0 else 0.5
    verified = new_up >= 3 and conf >= 0.7

    new_status   = "verified" if verified else row["status"]
    verified_at  = ts if verified else row["verified_at"]

    db.execute(
        "UPDATE pending_routes SET upvotes=?, downvotes=?, status=?, verified_at=? WHERE route_id=?",
        (new_up, new_down, new_status, verified_at, route_id),
    )

    if verified:
        stops_data = _json.loads(row["stops_json"])
        stop_ids   = []
        for s in stops_data:
            ex = db.execute("SELECT stop_id FROM stops WHERE lower(name)=lower(?)", (s["name"],)).fetchone()
            if ex:
                stop_ids.append(ex["stop_id"])
            else:
                sid = uid("stop")
                db.execute(
                    "INSERT INTO stops (stop_id, name, lat, lng, created_at) VALUES (?,?,?,?,?)",
                    (sid, s["name"], float(s["lat"]), float(s["lng"]), ts),
                )
                stop_ids.append(sid)

        bid = uid("bus")
        db.execute(
            "INSERT INTO buses (bus_id, number, name, direction, status, current_lat, current_lng, created_at)"
            " VALUES (?,?,?,?,'running',?,?,?)",
            (bid, row["bus_number"], row["bus_name"], row["direction"],
             float(stops_data[0]["lat"]), float(stops_data[0]["lng"]), ts),
        )
        for pos, sid in enumerate(stop_ids):
            db.execute(
                "INSERT OR IGNORE INTO bus_stops (bus_id, stop_id, position) VALUES (?,?,?)",
                (bid, sid, pos),
            )
        db.commit()
        broadcast("route_verified", {"route_id": route_id, "bus_id": bid})
        broadcast("bus_added", {"bus_id": bid})
    else:
        db.commit()

    result = _pending_row(
        db.execute("SELECT * FROM pending_routes WHERE route_id=?", (route_id,)).fetchone(),
        user_id,
    )
    broadcast("route_voted", result)
    return jsonify(result)


# ── socket.io ─────────────────────────────────────────────────────────────────

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
_main_loop: Optional[asyncio.AbstractEventLoop] = None


@sio.event
async def connect(sid, _environ):
    pass


@sio.event
async def disconnect(sid):
    pass


def broadcast(event: str, payload: dict) -> None:
    if _main_loop is None:
        return
    asyncio.run_coroutine_threadsafe(sio.emit(event, payload), _main_loop)


_socketio_asgi = socketio.ASGIApp(
    sio, other_asgi_app=WsgiToAsgi(flask_app), socketio_path="/api/socket.io"
)


async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        global _main_loop
        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                _main_loop = asyncio.get_running_loop()
                await send({"type": "lifespan.startup.complete"})
            elif message["type"] == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return
    else:
        await _socketio_asgi(scope, receive, send)
