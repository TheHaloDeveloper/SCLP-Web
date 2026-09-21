function find_player(name) {
    if (player_lookup[name]) return player_lookup[name];
    let lower = name.toLowerCase();
    for (let key in player_lookup) {
        if (key.toLowerCase() == lower) return player_lookup[key];
    }
    return false;
}

function average(values) {
    return values.reduce((a, b) => a + b, 0) / values.length;
}

function hardest(tower_ids) {
    return Math.max(0, ...tower_ids.map(id => tower_lookup[id]?.difficulty ?? 0));
}

function avg_diff(tower_ids) {
    let values = tower_ids.map(id => tower_lookup[id]).filter(Boolean).map(t => t.difficulty);
    return values.length ? average(values) : 0;
}

function avg_quality(tower_ids) {
    let ranks = tower_ids.map(id => tower_lookup[id]).filter(t => t && t.quality != null).map(t => quality_order[t.quality]);
    if (ranks.length == 0) return null;
    let avg_rank = average(ranks);
    return Object.keys(quality_order).reduce((best, key) =>
        Math.abs(quality_order[key] - avg_rank) < Math.abs(quality_order[best] - avg_rank) ? key : best
    );
}

function title_case(str) {
    return str.replace(/\w\S*/g, text => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase());
}

function slug(role) {
    return role.toLowerCase().replaceAll(" ", "-");
}

let credits = {};
for (let {role, username} of staff) {
    (credits[role] ||= []).push(username);
}

for (let [role, users] of Object.entries(credits)) {
    $("#credits").append(`<h3><div class="${slug(role)}">[${title_case(role)}]</div>${users.join(", ")}</h3>`);
}

function format_num(num) {
    let d = num < 20 ? 2 : 0;
    return new Intl.NumberFormat("en-US", {minimumFractionDigits: d}).format(num);
}

function abbr(x) {
    x = x.replace("CumpleAnos", "Cumple Anos").replace(" Facility", "").replace("GBJ Edition", "G B J").replace(/\.([^\s])/g, ' $1').split(" (")[0];
    return x.replace(":", " :").replaceAll('-', ' ').split(' ').map(word => {
        if (!word) return '';
        if (/^\d+$/.test(word)) return word[0];
        let letter = word[0];
        let digit = word.match(/\d/);
        return (letter == letter.toLowerCase() ? letter : letter.toUpperCase()) + (digit ? digit[0] : '');
    }).join('');
}

function diff_name(d) {
    return diffs.find(([limit]) => d < limit)[1];
}

function sub_range(d) {
    d %= 100;
    if (d == 0) return "Baseline";
    if (d == 99) return "Skyline";
    if (d < 12) return "Bottom";
    if (d < 23) return "Bottom-Low";
    if (d < 34) return "Low";
    if (d < 45) return "Low-Mid";
    if (d < 56) return "Mid";
    if (d < 67) return "Mid-High";
    if (d < 78) return "High";
    if (d < 89) return "High-Peak";
    return "Peak";
}

function scale_layout() {
    let designedWidth = 800;
    let screenWidth = window.innerWidth;
    let scale = Math.min(screenWidth / designedWidth, 1);
    let main = document.getElementById('main');

    if (screenWidth < designedWidth) {
        main.style.transform = `scale(${scale})`;
        main.style.transformOrigin = 'top left';
        main.style.width = `${designedWidth}px`;
        main.style.height = `${100 / scale}%`;
    } else {
        main.style.transform = '';
        main.style.width = '';
        main.style.height = '';
    }
}

window.addEventListener('resize', scale_layout);
scale_layout();

document.querySelectorAll("input").forEach(input => {
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("spellcheck", false);
});

let pages = ["Home", "Towers", "Leaderboard", "Packs", "SCoTW"];
for (let page of pages) {
    $("#nav-links").append(`<button class="nav-link" onclick="open_page('${page}')">${page}</button>`);
}

let current_page = "Home";
let current_tower_id = null;
let current_player_name = null;
let current_pack_id = null;

let search_slots = {
    "Towers": "#towers-search",
    "Leaderboard": "#players-search",
    "Packs": "#packs-search",
    "SCoTW": "#scotw-search",
};

let search_filters = {
    "Towers": () => filter_towers(),
    "Leaderboard": () => filter_players(),
    "Packs": () => filter_packs(),
    "SCoTW": () => filter_scotw(),
};

function open_page(page_name) {
    current_page = page_name;
    for (let page of pages) {
        $(`#${page.toLowerCase()}-page`).toggleClass("hidden", page != page_name);
    }
    if (search_slots[page_name]) {
        $("#search").appendTo(search_slots[page_name]).val("");
    }
    push_url();
}

function current_url() {
    let qs = null;
    if (current_page == "Towers" && current_tower_id != null) {
        qs = `t=${current_tower_id}`;
    } else if (current_page == "Leaderboard" && current_player_name != null) {
        qs = `u=${encodeURIComponent(current_player_name)}`;
    } else if (current_page == "Packs" && current_pack_id != null) {
        qs = `pk=${current_pack_id}`;
    } else if (current_page == "Home" || current_page == "SCoTW") {
        qs = `page=${current_page.toLowerCase()}`;
    }
    return qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
}

let restoring = false;
function push_url() {
    if (!restoring) window.history.pushState({page: current_page}, '', current_url());
}
function restore(fn) {
    restoring = true;
    fn();
    restoring = false;
}

function route(params) {
    let page_name = pages.find(p => p.toLowerCase() == (params.get("page") || "").toLowerCase());
    if (params.get("t")) open_tower(parseInt(params.get("t")));
    else if (params.get("u")) open_player(params.get("u"));
    else if (params.get("pk")) open_pack(params.get("pk"));
    else if (page_name) open_page(page_name);
    else return false;
    return true;
}

function query() {
    return $("#search").val().toLowerCase();
}

function filter_rows(table, keep) {
    for (let row of document.getElementById(table).rows) {
        row.style.display = keep(row) ? "" : "none";
    }
}

function render_scotw() {
    let tower = tower_lookup[scotw.Tower];
    $("#scotw-title").attr("class", diff_name(tower.difficulty));
    $("#scotw-title").html(`<button class="tower-link" onclick="open_tower(${tower.id})">${tower.name}</button>`);

    let lb = scotw_points.map(p => ({username: p.username, points: +p.points})).sort((a, b) => b.points - a.points || a.username.localeCompare(b.username));
    $("#scotw-table").html(lb.map((e, i) => player_row(e.username, i + 1, td_right(`${e.points} pts`))).join(""));

    filter_scotw();
    update_timer();
}

function filter_scotw() {
    let search = query();
    filter_rows("scotw-table", row => row.dataset.name.includes(search));
}

function update_timer() {
    let diff = new Date(scotw.Target * 1000) - new Date();

    if (diff <= 0) {
        $("#scotw-timer").text("Updating...");
        return;
    }

    let days = Math.floor(diff / (1000 * 60 * 60 * 24));
    let hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    let minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    let seconds = Math.floor((diff % (1000 * 60)) / 1000);

    $("#scotw-timer").text(`Next tower in: ${days}d ${hours}h ${minutes}m ${seconds}s`);
    setTimeout(update_timer, 1000);
}

$("#search").on("input", () => search_filters[current_page]?.());

let scotw;
fetch("/get_scotw").then(res => res.json()).then(data => {
    scotw = data;
    render_scotw();
});

document.getElementById('discord').addEventListener('click', function() {
    window.open('https://discord.gg/t9crQndHyn', '_blank');
});