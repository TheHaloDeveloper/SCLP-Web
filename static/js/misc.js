function player_identifier(player) {
    return String(player.user_id || player.username || "").trim();
}

function find_player(name) {
    if (name == null || name == "") return false;
    if (player_lookup[name]) return player_lookup[name];
    let lower = String(name).toLowerCase();
    for (let key in player_lookup) {
        if (String(key).toLowerCase() == lower) return player_lookup[key];
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
    return values.length ? average(values.map(v => Math.round(v * 100))) / 100 : 0;
}

const TIERS = [
    [98, "#d600ff"],
    [95, "#a120ec"],
    [92, "#6b40d9"],
    [90, "#5d57e2"],
    [87, "#506eeb"],
    [83, "#4285f4"],
    [80, "#3d91be"],
    [77, "#399c89"],
    [73, "#34a853"],
    [70, "#73b148"],
    [67, "#b2b93d"],
    [63, "#f1c232"],
    [60, "#edb234"],
    [57, "#eaa136"],
    [53, "#e69138"],
    [50, "#dd6125"],
    [40, "#d53013"],
    [30, "#cc0000"],
    [20, "#bb3333"],
    [0, "#797981"],
];

function enjoyability_span(v) {
    return `<span style="color: ${TIERS.find(([min]) => Math.round(v) >= min)[1]}">${Math.round(v)}</span>`;
}

function avg_enjoyability(tower_ids) {
    let values = tower_ids.map(id => tower_lookup[id]).filter(t => t && t.enjoyability != null).map(t => t.enjoyability);
    return values.length ? average(values) : null;
}

function title_case(str) {
    return str.replace(/\w\S*/g, text => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase());
}

function esc(text) {
    return String(text ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
}

function colored(text, color) {
    return color ? `<span style="color: ${color}">${text}</span>` : text;
}

for (let {name, color, members} of staff) {
    if (members.length) $("#credits").append(`<h3><div>${colored(`[${name}]`, color)}</div>${members.map(esc).join(", ")}</h3>`);
}

function format_num(num) {
    let d = num < 20 ? 2 : 0;
    return new Intl.NumberFormat("en-US", {minimumFractionDigits: d}).format(num);
}

function abbr(x) {
    x = x.trim().replace("CumpleAnos", "Cumple Anos").replace(" Facility", "").replace("GBJ Edition", "G B J").replace(/\.([^\s])/g, ' $1').replace(/\s*\([^)]*\)$/, "");
    return x.replace(":", " :").replaceAll('-', ' ').split(' ').map(word => {
        if (word == ":") return word;
        let [letter, ...rest] = Array.from(word.replace(/^[^\p{L}\p{N}]+/u, ""));
        if (!letter) return '';
        if (/\d/.test(letter)) return letter;
        let digit = rest.join("").match(/\d/);
        return (letter == letter.toLowerCase() ? letter : letter.toUpperCase()) + (digit ? digit[0] : '');
    }).join('');
}

function diff_name(d) {
    return diffs.find(([limit]) => d < limit)[1];
}

function sub_range(d) {
    d = Math.round(d * 100) % 100;
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

document.querySelectorAll("input").forEach(input => {
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("spellcheck", false);
});

let pages = ["Home", "Towers", "Leaderboard", "Packs", "SCoTW"];
$("#nav-links").on("click", ".nav-link", function (e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.which > 1) return;
    e.preventDefault();
    $("#nav").removeClass("open");
    open_page($(this).data("page"));
});

$("#menu").on("click", () => $("#nav").toggleClass("open"));

let current_page = "Home";
let showing_detail = false;
let current_tower_id = null;
let current_player_name = null;
let current_player_id = null;
let current_pack_id = null;

let search_slots = {
    "Towers": "#towers-search",
    "Leaderboard": "#players-search",
    "Packs": "#packs-search",
    "SCoTW": "#scotw-search",
};

let search_filters = {
    "Towers": () => render_towers(),
    "Leaderboard": () => render_players(),
    "Packs": () => filter_packs(),
    "SCoTW": () => filter_scotw(),
};

function open_page(page_name, detail = false) {
    let changed = page_name != current_page;
    current_page = page_name;
    showing_detail = detail;
    $(".nav-link").each(function () {
        $(this).toggleClass("active", $(this).data("page") == page_name);
    });
    $("#menu-label").text(page_name);
    document.querySelector(".nav-link.active")?.scrollIntoView({inline: "center", block: "nearest"});
    for (let page of pages) {
        $(`#${page.toLowerCase()}-page`).toggleClass("hidden", page != page_name).toggleClass("detail", detail);
    }
    if (changed && search_slots[page_name]) {
        $("#search").appendTo(search_slots[page_name]).val("");
    }
    push_url();
}

function current_url() {
    let qs = null;
    if (showing_detail && current_page == "Towers") {
        qs = `t=${current_tower_id}`;
    } else if (showing_detail && current_page == "Leaderboard") {
        qs = `u=${encodeURIComponent(current_player_id)}`;
    } else if (showing_detail && current_page == "Packs") {
        qs = `pk=${current_pack_id}`;
    } else {
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
    $("#scotw-title").html(`<button class="tower-link" onclick="open_tower(${tower.id})">${esc(tower.name)}</button>`);

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

$(document).on("click", ".back", () => open_page(current_page));

$("#search").on("input", () => search_filters[current_page]?.());

let scotw;

$(document).on("click", e => {
    if (!$(e.target).closest("#nav-links, #menu").length) $("#nav").removeClass("open");
    if (!$(e.target).closest("#account").length) $("#account").removeAttr("open");
});