from flask import Flask, render_template, make_response, jsonify
from dotenv import load_dotenv
import os
import math
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
    values = requests.get(url).json().get("values", [])
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
player_sorts = [("xp", "Level/XP"), ("completions", "SCs Beaten"), ("hardest", "Hardest Tower")] + [(f"most-{name.lower()}", f"{name} Towers") for limit, name in diffs[:6]]

def diff_name(d):
    return next(name for limit, name in diffs if d < limit)

@app.after_request
def no_cache(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

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
            xp = sum(tower_by_id[tid]["xp"] for tid in ids if tid in tower_by_id)
            packs.append({"id": pack["id"], "name": pack["name"], "towers": ids, "xp": math.floor(xp / len(ids)) if ids else 0})
    return sorted(packs, key=lambda p: p["xp"])

def build():
    with ThreadPoolExecutor(max_workers=4) as pool:
        players, towers, games, countries = pool.map(get_data, ["comps!A:C", "towers!A:G", "games!A:C", "nationalities!A:B"])

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

    players.sort(key=lambda p: p["xp"], reverse=True)
    towers.sort(key=lambda t: (-t["difficulty"], -t["id"]))
    for rank, tower in enumerate(towers, 1):
        tower["rank"] = rank
    for rank, p in enumerate(players, 1):
        p["rank"] = rank

    packs = parse_packs(get_data("packs!A:M"), tower_by_id)

    diff_totals = {}
    for tower in towers:
        diff = diff_name(tower["difficulty"])
        diff_totals[diff] = diff_totals.get(diff, 0) + 1

    victors_by_tower = {t["id"]: [] for t in towers}
    pack_victors = {p["id"]: [] for p in packs}
    player_hardest = {}
    diff_counts = {}
    player_towers = {}

    for player in players:
        name = player["username"]
        owned = [tower_by_id[tid] for tid in player["completions"] if tid in tower_by_id]
        counts = {}

        for tower in owned:
            diff = diff_name(tower["difficulty"])
            counts[diff] = counts.get(diff, 0) + 1
            victors_by_tower[tower["id"]].append(name)

        player_hardest[name] = max((t["difficulty"] for t in owned), default=0)
        diff_counts[name] = counts
        player_towers[name] = [t["id"] for t in sorted(owned, key=lambda t: t["rank"])]

        done = set(player["completions"])
        bonus = 0
        for pack in packs:
            if pack["towers"] and done.issuperset(pack["towers"]):
                bonus += pack["xp"]
                pack_victors[pack["id"]].append(name)

        player["total_xp"] = player["xp"] + bonus

    return {
        "players": players,
        "towers": towers,
        "games": games,
        "packs": packs,
        "victors_by_tower": victors_by_tower,
        "pack_victors": pack_victors,
        "player_hardest": player_hardest,
        "diff_counts": diff_counts,
        "diff_totals": diff_totals,
        "player_towers": player_towers,
    }

data = build()
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

# rewrite below
try:
    cool_members = requests.get("http://127.0.0.1:8082/cool_members", timeout=5).json()
except requests.exceptions.RequestException:
    cool_members = []

staff = get_data("credits!A:B")
roles = {}
for entry in staff:
    roles.setdefault(entry["username"], entry["role"])

scotw_points = get_data("scotwpoints!A:B")

@app.route("/")
def home():
    js = {**data, "cool_members": cool_members, "staff": staff, "roles": roles, "scotw_points": scotw_points, "diffs": diffs}
    return render_template("index.html", js=js, diffs=diffs, player_sorts=player_sorts)

def next_scotw(after):
    local = after.astimezone(ZoneInfo("America/New_York"))
    days_left = (6 - local.weekday()) % 7
    check = (local + timedelta(days=days_left)).replace(hour=16, minute=0, second=0, microsecond=0)
    if check <= local:
        check += timedelta(days=7)
    return check.astimezone(timezone.utc)

@app.route("/get_scotw")
def get_scotw():
    scotw = get_data("scotw!A:B")[0]
    start = datetime.fromtimestamp(int(scotw['Time']), tz=timezone.utc)
    return jsonify({**scotw, "Target": int(next_scotw(start).timestamp())})

if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=True, port=5003)
