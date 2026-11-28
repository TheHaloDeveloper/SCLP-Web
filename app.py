from flask import Flask, render_template, make_response, jsonify, request, session, redirect, url_for
from dotenv import load_dotenv
import os
import json
import math
import hashlib
import base64
import secrets
from urllib.parse import urlencode
import requests
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import threading
from werkzeug.middleware.proxy_fix import ProxyFix
load_dotenv()
import db

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)
app.secret_key = hashlib.sha256(f"session-{os.environ['ROBLOX_CLIENT_SECRET']}".encode()).hexdigest()
app.config.update(SESSION_COOKIE_SAMESITE="Lax", PERMANENT_SESSION_LIFETIME=timedelta(days=30))

diffs = [(9, "Insane"), (10, "Extreme"), (11, "Terrifying"), (12, "Catastrophic"), (13, "Horrific"), (14, "Unreal"), (999, "Nil")]
player_sorts = [("xp", "Level/XP"), ("completions", "SCs Beaten"), ("packs", "Packs Completed"), ("hardest", "Hardest Tower")] + [(f"most-{name.lower()}", f"{name} Towers") for limit, name in diffs[:6]]

def diff_name(d):
    return next(name for limit, name in diffs if d < limit)

@app.after_request
def cache_headers(response):
    if request.path.startswith("/static/") or request.path == "/favicon.ico":
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable" if "v" in request.args else "public, max-age=86400"
    elif "Cache-Control" not in response.headers:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return response

@app.context_processor
def static_urls():
    def static_v(name):
        return f"/static/{name}?v={int(os.path.getmtime(os.path.join(app.static_folder, name)))}"
    return {"static_v": static_v, "user": session.get("user"), "nav_pages": ["Home", "Towers", "Leaderboard", "Packs", "SCoTW"]}

@app.route("/favicon.ico")
def favicon():
    return app.send_static_file("images/sclp.png")

def parse_packs(raw, tower_by_id):
    packs = []
    for pack in raw:
        base_scores = [tower_by_id[tid]["xp"] for tid in pack["towers"] if tid in tower_by_id]
        n = len(base_scores)

        if n > 0:
            power_mean = pow(sum(pow(score, 1.5) for score in base_scores) / n, 1 / 1.5)
            final_xp = math.floor(power_mean * (1.0 + (n - 3) * 0.10))
        else:
            final_xp = 0
        packs.append({"id": pack["id"], "name": pack["name"], "towers": pack["towers"], "xp": final_xp})
    return sorted(packs, key=lambda p: p["xp"])

tower_fields = ["id", "name", "difficulty", "rank", "xp", "places", "place_link", "creators", "length", "alternate_names", "previous_names"]

def load_enjoyability(tower_id=None):
    rows = db.query("select tower_id, round(avg(rating), 1)::float8 as enjoyability, count(*)::int as votes from enjoyability where %s::int is null or tower_id = %s group by tower_id", (tower_id, tower_id))
    return {r["tower_id"]: {"enjoyability": r["enjoyability"], "votes": r["votes"]} for r in rows}

def my_ratings(user):
    rows = db.query("select tower_id, rating from enjoyability where user_id = %s", (int(user["id"]),)) if user else []
    return {r["tower_id"]: r["rating"] for r in rows}

def load_places():
    places = {}
    for r in db.query("select tower_id, game, detail from tower_places order by tower_id, position"):
        places.setdefault(r["tower_id"], []).append([r["game"] or "", r["detail"]])
    return places

def load_db():
    return (
        [{"id": str(r["user_id"]), "username": r["username"], "nationality": r["nationality"], "completions": r["completions"]} for r in db.query("select p.username, p.user_id, p.nationality, coalesce(array_agg(c.tower_id) filter (where c.tower_id is not null), '{}') as completions from players p left join completions c using (user_id) group by p.user_id order by p.user_id")],
        db.query("select id, name, difficulty::float8 as difficulty, place_link, length, creators, alternate_names, previous_names from towers where removed_at is null"),
        db.query("select abbr, name, link from games order by lower(abbr)"),
        db.query("select user_id::text as id, sum(tickets)::int as points from scotw_awards group by user_id"),
        [{"id": str(p["id"]), "name": p["name"], "towers": p["tower_ids"]} for p in db.query("select id, name, tower_ids from packs")],
        load_places(),
    )

def build():
    players, towers, games, scotw_points, raw_packs, places = load_db()

    for tower in towers:
        tower["xp"] = math.floor(3 ** round(tower["difficulty"] - 8, 2) * 100)
        tower["places"] = places.get(tower["id"], [])
        if tower["place_link"]:
            tower["places"].append(["Place", ""])
    tower_by_id = {t["id"]: t for t in towers}

    for p in players:
        p["completions"] = list(set(p["completions"]))
        p["xp"] = sum(tower_by_id[id]["xp"] for id in p["completions"] if id in tower_by_id)

    towers.sort(key=lambda t: (-t["difficulty"], -t["id"]))
    for rank, tower in enumerate(towers, 1):
        tower["rank"] = rank

    packs = parse_packs(raw_packs, tower_by_id)

    diff_totals = {}
    for tower in towers:
        diff = diff_name(tower["difficulty"])
        diff_totals[diff] = diff_totals.get(diff, 0) + 1

    victors_by_tower = {t["id"]: [] for t in towers}
    pack_victors = {p["id"]: [] for p in packs}

    player_packs = {}
    for player in players:
        done = set(player["completions"])
        finished = [pack for pack in packs if pack["towers"] and done.issuperset(pack["towers"])]
        player_packs[player["id"]] = finished
        player["total_xp"] = player["xp"] + sum(pack["xp"] for pack in finished)

    players.sort(key=lambda p: p["total_xp"], reverse=True)
    for rank, player in enumerate(players, 1):
        player["rank"] = rank

    for player in players:
        for tid in player["completions"]:
            if tid in tower_by_id:
                victors_by_tower[tid].append(player["id"])

        for pack in player_packs[player["id"]]:
            pack_victors[pack["id"]].append(player["id"])

    page = {
        "players": players,
        "towers": [{key: tower[key] for key in tower_fields if key in tower} for tower in towers],
        "games": games,
        "packs": packs,
        "diff_totals": diff_totals,
    }
    script = "".join(f"{name}={json.dumps(value, separators=(',', ':'), ensure_ascii=False)};" for name, value in page.items())

    return {
        "players": players,
        "towers": towers,
        "packs": packs,
        "victors_by_tower": victors_by_tower,
        "pack_victors": pack_victors,
        "scotw_points": scotw_points,
        "script": script,
        "version": hashlib.md5(script.encode()).hexdigest()[:12],
    }

for attempt in range(5):
    try:
        data = build()
        break
    except Exception as e:
        print(f"startup build error (attempt {attempt + 1}): {e}")
        if attempt == 4:
            raise
        time.sleep(10)

def refresh():
    global data
    while True:
        time.sleep(60)
        try:
            data = build()
        except Exception as e:
            print(f"refresh error: {e}")

threading.Thread(target=refresh, daemon=True).start()

@app.route("/tower_data")
def tower_data():
    ratings = load_enjoyability()
    return jsonify([{**t, **ratings.get(t["id"], {"enjoyability": None, "votes": 0})} for t in data["towers"]])

@app.route("/tower_data_csv")
def tower_data_csv():
    lines = ["difficulty,name"] + [f'{t["difficulty"]:.2f},{t["name"]}' for t in sorted(data["towers"], key=lambda t: t["difficulty"])]
    response = make_response("\n".join(lines))
    response.headers['Content-Type'] = 'text/csv'
    response.headers['Content-Disposition'] = 'attachment; filename=tower_data.csv'
    return response

cool_members = []
staff = []
roles = {}
role_colors = {}

def load_bot_data():
    global cool_members, staff, roles, role_colors
    try:
        cool_members = requests.get("http://127.0.0.1:8082/cool_members", timeout=5).json()
        staff = requests.get("http://127.0.0.1:8082/staff", timeout=5).json()
    except requests.exceptions.RequestException:
        return
    roles = {}
    for group in staff:
        for name in group["members"]:
            roles.setdefault(name, group["name"])
    role_colors = {group["name"]: group["color"] for group in staff}

def refresh_bot_data():
    while True:
        load_bot_data()
        time.sleep(300)

threading.Thread(target=refresh_bot_data, daemon=True).start()

def level_of(xp):
    level = 0
    need = 175
    while xp >= need:
        xp -= need
        level += 1
        need = 150 + 25 * (level + 1) ** 2
    return level

def page_meta():
    meta = {"title": "SCLP Official", "description": "Soul Crushing Leaderboard Project"}
    user_value = request.args.get("u", "")
    tower_id = request.args.get("t", "")
    pack_id = request.args.get("pk", "")

    player = None
    if user_value:
        target = user_value.strip().lower()
        player = next((p for p in data["players"] if p["id"] == target or p["username"].lower() == target), None)
    tower = next((t for t in data["towers"] if str(t["id"]) == tower_id), None) if tower_id else None
    pack = next((p for p in data["packs"] if p["id"] == pack_id), None) if pack_id else None
    if player:
        meta["title"] = f'{player["username"]} - SCLP'
        meta["description"] = f'Rank #{player["rank"]} | Level {level_of(player["total_xp"])} | {player["total_xp"]:,} XP | {len(player["completions"])} SCs beaten'
    elif tower:
        meta["title"] = f'{tower["name"]} - SCLP'
        meta["description"] = f'{diff_name(tower["difficulty"])} ({tower["difficulty"]:g}) | Rank #{tower["rank"]} | {len(data["victors_by_tower"][tower["id"]])} victors'
    elif pack:
        meta["title"] = f'{pack["name"]} - SCLP'
        meta["description"] = f'{len(pack["towers"])} towers | {pack["xp"]:,} bonus XP | {len(data["pack_victors"][pack["id"]])} victors'
    return meta

@app.route("/")
def home():
    user = session.get("user")
    return render_template("index.html", js={"cool_members": cool_members, "staff": staff, "roles": roles, "role_colors": role_colors, "scotw_points": data["scotw_points"], "diffs": diffs, "me": user, "ratings": load_enjoyability(), "mine": my_ratings(user)}, version=data["version"], diffs=diffs, player_sorts=player_sorts, meta=page_meta())

@app.route("/data.js")
def data_js():
    response = make_response(data["script"])
    response.headers["Content-Type"] = "application/javascript; charset=utf-8"
    response.headers["Cache-Control"] = "public, max-age=31536000, immutable" if request.args.get("v") == data["version"] else "no-store"
    return response

@app.route("/login")
def login():
    verifier = secrets.token_urlsafe(64)
    state = secrets.token_urlsafe(16)
    session["oauth"] = {"state": state, "verifier": verifier}
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return redirect("https://apis.roblox.com/oauth/v1/authorize?" + urlencode({
        "client_id": os.getenv("ROBLOX_CLIENT_ID"),
        "redirect_uri": url_for("callback", _external=True),
        "scope": "openid profile",
        "response_type": "code",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }))

@app.route("/callback")
def callback():
    oauth = session.pop("oauth", None)
    code = request.args.get("code")
    if not oauth or not code or not secrets.compare_digest(request.args.get("state", ""), oauth["state"]):
        return redirect("/")
    try:
        token = requests.post("https://apis.roblox.com/oauth/v1/token", data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": url_for("callback", _external=True),
            "client_id": os.getenv("ROBLOX_CLIENT_ID"),
            "client_secret": os.getenv("ROBLOX_CLIENT_SECRET"),
            "code_verifier": oauth["verifier"],
        }, timeout=10)
        info = requests.get("https://apis.roblox.com/oauth/v1/userinfo", headers={"Authorization": f"Bearer {token.json()['access_token']}"}, timeout=10) if token.ok else None
        user = info.json() if info and info.ok else None
    except (requests.RequestException, KeyError, ValueError):
        user = None
    if not user:
        return redirect("/")
    session.permanent = True
    session["user"] = {"id": user["sub"], "name": user.get("preferred_username") or user["name"]}
    return redirect("/")

@app.route("/enjoyability", methods=["POST"])
def set_enjoyability():
    user = session.get("user")
    if not user:
        return jsonify(error="Sign in to rate enjoyability."), 401
    body = request.get_json(silent=True) or {}
    tower_id, rating = body.get("tower_id"), body.get("rating")
    if type(tower_id) is not int or (rating is not None and (type(rating) is not int or not 0 <= rating <= 100)):
        return jsonify(error="Rating must be 0-100."), 400
    if rating is None:
        db.query("delete from enjoyability where user_id = %s and tower_id = %s", (int(user["id"]), tower_id))
    elif not db.query("insert into enjoyability (user_id, tower_id, rating) select c.user_id, c.tower_id, %s from completions c join towers t on t.id = c.tower_id where c.user_id = %s and c.tower_id = %s and t.removed_at is null on conflict (user_id, tower_id) do update set rating = excluded.rating, rated_at = now() returning 1", (rating, int(user["id"]), tower_id)):
        return jsonify(error="Beat this tower to rate it."), 403
    return jsonify(load_enjoyability(tower_id).get(tower_id, {"enjoyability": None, "votes": 0}))

@app.route("/logout")
def logout():
    session.pop("user", None)
    return redirect("/")

@app.route("/privacy-policy")
def privacy_policy():
    meta = {"title": "Privacy Policy - SCLP", "description": "Privacy Policy for sclp.pro"}
    return render_template("privacy_policy.html", meta=meta)

@app.route("/terms-of-service")
def terms_of_service():
    meta = {"title": "Terms of Service - SCLP", "description": "Terms of Service for sclp.pro"}
    return render_template("terms_of_service.html", meta=meta)

def next_scotw(after):
    local = after.astimezone(ZoneInfo("America/New_York"))
    days_left = (6 - local.weekday()) % 7
    check = (local + timedelta(days=days_left)).replace(hour=16, minute=0, second=0, microsecond=0)
    if check <= local:
        check += timedelta(days=7)
    return check.astimezone(timezone.utc)

scotw_cache = {"time": 0, "value": None}

def load_scotw():
    row = db.query("select tower_id, extract(epoch from started_at)::bigint as time from scotw_state")[0]
    return {"Tower": str(row["tower_id"]), "Time": str(row["time"])}

@app.route("/get_scotw")
def get_scotw():
    if time.time() - scotw_cache["time"] > 60:
        try:
            scotw = load_scotw()
            start = datetime.fromtimestamp(int(scotw['Time']), tz=timezone.utc)
            scotw_cache.update(time=time.time(), value={**scotw, "Target": int(next_scotw(start).timestamp())})
        except Exception:
            if scotw_cache["value"] is None:
                raise
    return jsonify(scotw_cache["value"])

if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=False, port=5003)