from flask import Flask, render_template, make_response, jsonify, request
from dotenv import load_dotenv
import os
import json
import math
import hashlib
import requests
import pycountry
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import threading
from concurrent.futures import ThreadPoolExecutor
load_dotenv()

app = Flask(__name__)

def get_data(r):
    url = f"https://sheets.googleapis.com/v4/spreadsheets/1PCndMCuQkslsWITs19Q2YaLFa16XnpUZzts4npzCjtE/values/{r}?key={os.getenv('GOOGLE_SHEETS_API_KEY')}" # will set up a db for a lot of this stuff later
    values = requests.get(url, timeout=20).json().get("values", [])
    if len(values) < 2:
        return []

    headers = values[0]
    data = []
    for row in values[1:]:
        item = {}
        for i, header in enumerate(headers):
            val = row[i] if i < len(row) else ""
            if header.lower() == "completions":
                item[header] = [int(x) for x in val.split(",") if x]
            else:
                item[header] = val
        data.append(item)
    return data

diffs = [(900, "Insane"), (1000, "Extreme"), (1100, "Terrifying"), (1200, "Catastrophic"), (1300, "Horrific"), (1400, "Unreal"), (99999, "Nil")]
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
    return {"static_v": static_v}

@app.route("/favicon.ico")
def favicon():
    return app.send_static_file("images/sclp.png")

def country_code(x):
    return pycountry.countries.lookup(x).alpha_2.lower()

def parse_tower(tower):
    tower["id"] = int(tower["id"])
    tower["difficulty"] = int(tower["difficulty"])
    tower["xp"] = math.floor((3 ** ((tower["difficulty"] - 800) / 100)) * 100)
    parts = [part.strip() for part in tower["places"].split(";") if part.strip()]
    tower["creators"] = [c.strip() for c in tower["creators"].split(",") if c.strip()]
    tower["places"] = [p.split(",") for p in parts]

    if tower["game"] == "":
        tower["game"] = None
    else:
        tower["places"].append(["Place", ""])

    tower["quality"] = tower["quality"].strip() or None

def parse_packs(raw, tower_by_id):
    packs = []
    for pack in raw:
        if pack["id"]:
            ids = [int(pack[f"tower{i}"]) for i in range(1, 11) if pack[f"tower{i}"] != ""]

            base_scores = [tower_by_id[tid]["xp"] for tid in ids if tid in tower_by_id]
            n = len(base_scores)

            if n > 0:
                power_mean = pow(sum(pow(score, 1.5) for score in base_scores) / n, 1 / 1.5)
                final_xp = math.floor(power_mean * (1.0 + (n - 3) * 0.10))
            else:
                final_xp = 0
            packs.append({"id": pack["id"], "name": pack["name"], "towers": ids, "xp": final_xp})
    return sorted(packs, key=lambda p: p["xp"])

tower_fields = ["id", "name", "difficulty", "rank", "xp", "places", "game", "creators", "quality", "time/length", "alternate name(s)", "previous name(s)"]

def build():
    with ThreadPoolExecutor(max_workers=4) as pool:
        players, towers, games, countries = pool.map(get_data, ["comps!A:C", "towers!A:Q", "games!A:C", "nationalities!A:B"])

    flags = {}
    for c in countries:
        try:
            flags[c["username"]] = country_code(c["nationality"])
        except Exception:
            pass

    for tower in towers:
        parse_tower(tower)
    tower_by_id = {t["id"]: t for t in towers}

    for p in players:
        p["completions"] = list(set(p["completions"]))
        p["nationality"] = flags.get(p["username"])
        p["xp"] = sum(tower_by_id[id]["xp"] for id in p["completions"] if id in tower_by_id)

    towers.sort(key=lambda t: (-t["difficulty"], -t["id"]))
    for rank, tower in enumerate(towers, 1):
        tower["rank"] = rank

    packs = parse_packs(get_data("packs!A:M"), tower_by_id)

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
        player_packs[player["username"]] = finished
        player["total_xp"] = player["xp"] + sum(pack["xp"] for pack in finished)

    players.sort(key=lambda p: p["total_xp"], reverse=True)
    for rank, player in enumerate(players, 1):
        player["rank"] = rank

    for player in players:
        name = player["username"]
        for tid in player["completions"]:
            if tid in tower_by_id:
                victors_by_tower[tid].append(name)

        for pack in player_packs[name]:
            pack_victors[pack["id"]].append(name)

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
        time.sleep(3600)
        try:
            data = build()
        except Exception as e:
            print(f"refresh error: {e}")

threading.Thread(target=refresh, daemon=True).start()

@app.route("/tower_data")
def tower_data():
    return jsonify(data["towers"])

@app.route("/tower_data_csv")
def tower_data_csv():
    lines = ["difficulty,name"] + [f'{t["difficulty"]},{t["name"]}' for t in sorted(data["towers"], key=lambda t: t["difficulty"])]
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

scotw_points = get_data("scotwpoints!A:B")

def player_identity(player):
    return str(player.get("userid") or player.get("username", "")).strip()

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
        player = next((
            p for p in data["players"]
            if str(p.get("username", "")).lower() == target
            or player_identity(p).lower() == target
        ), None)
    tower = next((t for t in data["towers"] if str(t["id"]) == tower_id), None) if tower_id else None
    pack = next((p for p in data["packs"] if p["id"] == pack_id), None) if pack_id else None
    if player:
        meta["title"] = f'{player["username"]} - SCLP'
        meta["description"] = f'Rank #{player["rank"]} | Level {level_of(player["total_xp"])} | {player["total_xp"]:,} XP | {len(player["completions"])} SCs beaten'
    elif tower:
        meta["title"] = f'{tower["name"]} - SCLP'
        meta["description"] = f'{diff_name(tower["difficulty"])} ({tower["difficulty"] / 100:g}) | Rank #{tower["rank"]} | {len(data["victors_by_tower"][tower["id"]])} victors'
    elif pack:
        meta["title"] = f'{pack["name"]} - SCLP'
        meta["description"] = f'{len(pack["towers"])} towers | {pack["xp"]:,} bonus XP | {len(data["pack_victors"][pack["id"]])} victors'
    return meta

@app.route("/")
def home():
    return render_template("index.html", js={"cool_members": cool_members, "staff": staff, "roles": roles, "role_colors": role_colors, "scotw_points": scotw_points, "diffs": diffs}, version=data["version"], diffs=diffs, player_sorts=player_sorts, meta=page_meta())

@app.route("/data.js")
def data_js():
    response = make_response(data["script"])
    response.headers["Content-Type"] = "application/javascript; charset=utf-8"
    response.headers["Cache-Control"] = "public, max-age=31536000, immutable" if request.args.get("v") == data["version"] else "no-store"
    return response

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

@app.route("/get_scotw")
def get_scotw():
    if time.time() - scotw_cache["time"] > 60:
        try:
            scotw = get_data("scotw!A:B")[0]
            start = datetime.fromtimestamp(int(scotw['Time']), tz=timezone.utc)
            scotw_cache.update(time=time.time(), value={**scotw, "Target": int(next_scotw(start).timestamp())})
        except Exception:
            if scotw_cache["value"] is None:
                raise
    return jsonify(scotw_cache["value"])

if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=False, port=5003)