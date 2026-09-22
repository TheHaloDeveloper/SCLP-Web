let tower_lookup = {};
let player_lookup = {};
let game_lookup = {};
let pack_info = {};

let quality_order = {
    "SS": 0, "S+": 1, "S": 2, "S-": 3, "A+": 4, "A": 5, "A-": 6, "B+": 7, "B": 8, "B-": 9, "C+": 10, "C": 11, "C-": 12, "D+": 13, "D": 14, "D-": 15, "F+": 16, "F": 17, "F-": 18, "X": 19, "Z": 20
};

function victors(id) {
    return victors_by_tower[id].length;
}

function build_lookups() {
    tower_lookup = Object.fromEntries(towers.map(t => [t.id, t]));
    player_lookup = Object.fromEntries(players.map(p => [p.username, p]));
    game_lookup = Object.fromEntries(games.map(g => [g.abbr, g]));

    pack_info = Object.fromEntries(packs.map(p => [p.id, {
        hardest: hardest(p.towers),
        avg_diff: avg_diff(p.towers),
        avg_quality: avg_quality(p.towers),
    }]));
    [...packs].sort((a, b) => b.xp - a.xp).forEach((p, i) => pack_info[p.id].rank = i + 1);
}

function td_right(html) {
    return `<td class="end">${html}</td>`;
}

function empty_row(msg) {
    return `<tr><td colspan="3" class="muted center">${msg}</td></tr>`;
}

function diff_span(d) {
    return `<span class="${diff_name(d)}">${format_num(d / 100)}</span>`;
}

function tower_row(t, last, button = "tower-link", attrs = "") {
    return `
        <tr ${attrs}>
            <td class="${diff_name(t.difficulty)}">#${t.rank}</td>
            <td><button class="${button}" onclick="open_tower(${t.id})">${t.name}</button></td>
            ${last}
        </tr>
    `;
}

function player_row(name, rank, last, attrs = "") {
    return `
        <tr data-name="${name.toLowerCase()}" ${attrs}>
            <td>#${rank}</td>
            <td><button class="player-link" onclick='open_player("${name}", ${rank})'>${role(name, true)}</button></td>
            ${last}
        </tr>
    `;
}

function victor_rows(names, empty) {
    let rows = names.filter(name => player_lookup[name]).map(name => {
        let p = player_lookup[name];
        return player_row(name, p.rank, td_right(`Level ${level_text(p.xp, true)}`));
    }).join("");
    return rows || empty_row(empty);
}

function render_towers() {
    let sort = $("#tower-sort").val() || "difficulty";
    let sign = $("#tower-sort-dir").attr("data-dir") == "asc" ? -1 : 1;
    let value = {
        difficulty: t => t.difficulty,
        victors: t => victors(t.id),
        quality: t => -quality_order[t.quality],
    }[sort];
    let last = {
        difficulty: t => diff_span(t.difficulty),
        victors: t => victors(t.id),
        quality: t => `<span class="${quality_cls(t.quality)}">${t.quality}</span>`,
    }[sort];

    let sorted_towers = towers.filter(t => sort != "quality" || t.quality != null);
    sorted_towers.sort((a, b) => sign * (value(b) - value(a)) || a.rank - b.rank);

    $("#towers-table").html(sorted_towers.map(t => tower_row(t, td_right(last(t)), "tower-link", `
        data-id="${t.id}"
        data-name="${t.name.toLowerCase()}"
        data-abbr="${abbr(t.name).toLowerCase()}"
        data-diff="${Math.floor(t.difficulty / 100)}"
        data-places="${t.places.map(p => p[0]).join(",")}"
    `)).join(""));
    filter_towers();
}

function filter_towers() {
    let search = query();
    let place = $("#game-filter").val();
    let player = checked_player();
    let done = new Set(player ? player.completions : []);
    let allowed = [8, 9, 10, 11, 12, 13].filter(i => $("#diff-" + i).prop("checked"));

    filter_rows("towers-table", row => {
        let {id, name, abbr, diff, places} = row.dataset;
        row.querySelector("button").className = done.has(+id) ? "tower-link-done" : "tower-link";
        return (name.includes(search) || abbr.includes(search)) && allowed.includes(+diff) && (!place || places.split(",").includes(place));
    });
}

function render_players() {
    let sort = $("#player-sort").val() || "xp";
    let asc = $("#player-sort-dir").attr("data-dir") == "asc";
    let sign = asc ? -1 : 1;
    let diff = sort.startsWith("most-") ? title_case(sort.slice(5)) : null;
    let value = {
        xp: p => p.total_xp,
        completions: p => p.completions.length,
        hardest: p => player_hardest[p.username],
    }[sort] || (p => diff_counts[p.username][diff] || 0);
    let text = {
        xp: v => `Level ${level_text(v, true)}`,
        completions: v => `${v} SCs`,
        hardest: v => diff_span(v),
    }[sort] || (v => `<span class="${diff}">${v} ${diff}s</span>`);

    let ranked = [...players].sort((a, b) => sign * (value(b) - value(a)) || b.total_xp - a.total_xp);

    $("#players-table").html(ranked.map((p, i) => {
        let v = value(p);
        if (v == 0 && (asc || diff)) return "";
        return player_row(p.username, i + 1, td_right(text(v)), `data-nationality="${p.nationality || ""}"`);
    }).join(""));
    filter_players();
}

function filter_players() {
    let search = query();
    let country = $("#country-filter").val();
    filter_rows("players-table", row => row.dataset.name.includes(search) && (!country || row.dataset.nationality == country));
}
function filter_packs() {
    let search = query();
    filter_rows("packs-table", row => row.dataset.name.includes(search));
}

function checked_player() {
    return find_player($("#username").val());
}

function done_count(pack, player) {
    return player ? pack.towers.filter(id => player.completions.includes(id)).length : 0;
}

function render_packs() {
    let sort = $("#pack-sort").val() || "xp";
    let sign = $("#pack-sort-dir").attr("data-dir") == "asc" ? -1 : 1;
    let player = checked_player();
    let value = {
        xp: p => p.xp,
        towers: p => p.towers.length,
        hardest: p => pack_info[p.id].hardest,
        quality: p => quality_order[pack_info[p.id].avg_quality],
    }[sort];
    let last = {
        xp: p => `${format_num(p.xp)} XP`,
        towers: p => `${done_count(p, player)}/${p.towers.length}`,
        hardest: p => diff_span(pack_info[p.id].hardest),
        quality: p => `<span class="${quality_cls(pack_info[p.id].avg_quality)}">${pack_info[p.id].avg_quality}</span>`,
    }[sort];

    let sorted_packs = packs.filter(p => sort != "quality" || pack_info[p.id].avg_quality != null);
    sorted_packs.sort((a, b) => sign * (value(b) - value(a)));

    $("#packs-table").html(sorted_packs.map(pack => {
        let done = pack.towers.length > 0 && done_count(pack, player) == pack.towers.length;
        return `
            <tr data-name="${pack.name.toLowerCase()}">
                <td class="${diff_name(pack_info[pack.id].avg_diff)}">#${pack_info[pack.id].rank}</td>
                <td><button class="${done ? 'pack-link-done' : 'pack-link'}" onclick="open_pack('${pack.id}')">${pack.name}</button></td>
                ${td_right(last(pack))}
            </tr>
        `;
    }).join(""));
    filter_packs();
}

function open_pack(id) {
    current_pack_id = id;
    open_page("Packs");
    let pack = packs.find(p => p.id == id);
    let player = checked_player();
    let names = pack_victors[id];

    $("#pack-name").html(pack.name);
    $("#pack-progress").html(`${done_count(pack, player)}/${pack.towers.length}`);
    $("#pack-bonus").html(`${format_num(pack.xp)} XP`);
    $("#pack-victor-count").html(names.length);

    let pack_towers = pack.towers.map(tid => tower_lookup[tid]).filter(Boolean).sort((a, b) => a.difficulty - b.difficulty);
    $("#pack-towers").html(pack_towers.map(t => tower_row(t, `<td>${diff_span(t.difficulty)}</td>`, player && player.completions.includes(t.id) ? "tower-link-done" : "tower-link")).join(""));
    $("#pack-victors").html(victor_rows(names, "No pack victors yet"));
}

$("#game-filter, [id^=diff-]").on("input change", filter_towers);
$("#username").on("input", function () {
    filter_towers();
    render_packs();
    localStorage.setItem("sclp-username", $(this).val());
});
$("#username").val(localStorage.getItem("sclp-username") || "");
$("#country-filter").on("change", filter_players);

function bind_sort(name, sort, dir, render) {
    let select = $(`#${name}-sort`);
    let button = $(`#${name}-sort-dir`);
    let show = d => button.attr("data-dir", d).html(d == "desc" ? "↓" : "↑");

    select.val(localStorage.getItem(`sclp-${name}-sort`) || sort);
    select.on("change", function () {
        localStorage.setItem(`sclp-${name}-sort`, $(this).val());
        render();
    });

    show(localStorage.getItem(`sclp-${name}-sort-dir`) || dir);
    button.on("click", function () {
        let next = button.attr("data-dir") == "asc" ? "desc" : "asc";
        show(next);
        localStorage.setItem(`sclp-${name}-sort-dir`, next);
        render();
    });
}
bind_sort("tower", "difficulty", "desc", render_towers);
bind_sort("player", "xp", "desc", render_players);
bind_sort("pack", "xp", "asc", render_packs);

function places_html(tower, start, end) {
    return tower.places.slice(start, end).map(([abbr, extra]) => {
        let href = abbr == "Place" ? tower.game : game_lookup[abbr]?.link;
        return `<a href='${href}' target='_blank'>${extra ? `${abbr}, ${extra}` : abbr}</a>`;
    }).join(" / ");
}

function quality_cls(q) {
    let suffix = q == "S+" ? "-plus" : q == "S-" ? "-minus" : "";
    return "quality-" + q.replace(/[+\-]$/, "").toLowerCase() + suffix;
}

function open_tower(id) {
    current_tower_id = id;
    open_page("Towers");
    let tower = tower_lookup[id];
    let diff = diff_name(tower.difficulty);
    let tower_packs = packs.filter(pack => pack.towers.includes(id));

    $("#tower-name").html(`(${abbr(tower.name)}) ${tower.name}`);
    $("#tower-diff").html(`<span class="${diff}">${sub_range(tower.difficulty)} ${diff}</span> (${format_num(tower.difficulty / 100)})`);
    $("#tower-location").html(places_html(tower, 0, 1));
    $("#tower-other-locations").html(tower.places.length > 1 ? `<i>Other Locations: ${places_html(tower, 1, tower.places.length)}</i>` : "");
    $("#tower-rank").html(tower.rank);
    $("#tower-xp").html(tower.xp);
    $("#tower-victor-count").html(victors(id));
    $("#tower-quality").html(tower.quality ? `Quality: <span class="${quality_cls(tower.quality)}">${tower.quality}</span>` : "");
    $("#tower-packs").html(tower_packs.length ? `Packs: ${tower_packs.map(pack => `<a href="javascript:void(0)" onclick="open_pack('${pack.id}')">${pack.name}</a>`).join(", ")}` : "");
    $("#tower-id").html(id);
    $("#tower-victors").html(victor_rows(victors_by_tower[id], "No SCLP victors yet"));
}

function level_text(xp, level_only) {
    let level = 0;
    let need = 175;
    while (xp >= need) {
        xp -= need;
        level++;
        need = 150 + 25 * (level + 1) ** 2;
    }
    return level_only ? level : `${level} (${xp}/${need})`;
}

function role(name, html = false) {
    let found = roles[name];
    if (!html) return found || "";
    if (found) return `<span class="${slug(found)}">${name}</span>`;
    return cool_members.includes(name) ? `<span class="cool">${name}</span>` : name;
}

function add_badges(player, role) {
    let badges = [];
    if (player.rank <= 3) badges.push(`top${player.rank}`);
    if (role != "" && !role.includes("Former")) badges.push("staff");

    let sc_level = [500, 400, 300, 200, 100, 50].find(level => player.completions.length >= level);
    if (sc_level) badges.push(sc_level);

    let top = hardest(player.completions);
    if (top >= 1100) badges.push(diff_name(top).toLowerCase());

    $("#player-name").append(badges.map(b => `<img src='/static/images/badges/${b}.png' class="badge">`).join(""));
}

function flag_html(x) {
    if (!x) return `<span class="fi-placeholder" title="Unknown"></span>`;
    return `<span class="fi fi-${x.toLowerCase()}" title="${x.toUpperCase()}"></span>`;
}

function open_player(name, rank) {
    let player = find_player(name);
    let username = player.username;
    current_player_name = username;
    open_page("Leaderboard");
    let job = role(username);
    let counts = diff_counts[username];
    let sum = (a, b) => a + b;
    let percent = (got, total) => total ? +(got / total * 100).toFixed(2) : 0;
    let got_all = Object.values(counts).reduce(sum, 0);
    let total_all = Object.values(diff_totals).reduce(sum, 0);

    $("#player-name").html(`${username} ${flag_html(player.nationality)}`);
    $("#player-role").html(job ? `<span class="${slug(job)}">${job}</span>` : "");
    $("#player-xp").html(format_num(player.total_xp));
    $("#player-level").html(level_text(player.total_xp));
    $("#player-rank").html(`#${rank || player.rank}`);

    let diff_rows = [8, 9, 10, 11, 12, 13].map(d => {
        let diff = diff_name(d * 100);
        let got = counts[diff] || 0;
        let total = diff_totals[diff] || 0;
        return `
            <tr>
                <td class="${diff}">${diff}</td>
                <td>${got}/${total}</td>
                <td>${percent(got, total)}%</td>
            </tr>
        `;
    }).join("");
    $("#player-stats").html(`
        <th>TOTAL</th>
        <th>${got_all}/${total_all}</th>
        <th>${percent(got_all, total_all)}%</th>
    ` + diff_rows);

    let completed = player_towers[username];
    $("#player-towers").html(completed.map(id => tower_row(tower_lookup[id], `<td>${diff_span(tower_lookup[id].difficulty)}</td>`)).join(""));

    let completed_packs = packs.filter(pack => pack_victors[pack.id].includes(username));
    $("#player-packs").html(completed_packs.length ? completed_packs.map(pack => `<p>${pack.name} (${format_num(pack.xp)} Bonus XP)</p>`).join("") : '<p class="muted">No packs completed</p>');

    add_badges(player, job);
}

$("#game-filter").html("<option value=''>All</option><option value='Place'>Place</option>");
for (let game of games) {
    $("#game-filter").append(`<option value='${game.abbr}'>${game.abbr}</option>`);
}

window.addEventListener('popstate', event => restore(() => {
    if (!route(new URLSearchParams(window.location.search)) && event.state && event.state.page) {
        open_page(event.state.page);
    }
}));

build_lookups();
render_towers();
render_players();
render_packs();

let countries = [...new Set(players.map(p => p.nationality).filter(Boolean))].sort();
for (let code of countries) {
    $("#country-filter").append(`<option value="${code}">${code.toUpperCase()}</option>`);
}

restore(() => {
    open_player(players[0].username);
    open_pack(packs[0].id);
    open_tower(towers[0].id);
    if (!route(new URLSearchParams(window.location.search))) open_page("Home");
});
window.history.replaceState({page: current_page}, '', current_url());
