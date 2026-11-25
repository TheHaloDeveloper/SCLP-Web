let tower_lookup = {};
let player_lookup = {};
let game_lookup = {};
let pack_info = {};
let pack_counts = {};
let tower_names = {};
let victors_by_tower = {};
let pack_victors = {};
let player_hardest = {};
let diff_counts = {};
let player_towers = {};
let tower_creators_expanded = false;
let player_created_towers = [];

let quality_order = {
    "SS": 0, "S+": 1, "S": 2, "S-": 3, "A+": 4, "A": 5, "A-": 6, "B+": 7, "B": 8, "B-": 9, "C+": 10, "C": 11, "C-": 12, "D+": 13, "D": 14, "D-": 15, "F+": 16, "F": 17, "F-": 18, "X": 19, "Z": 20
};

function victors(id) {
    return victors_by_tower[id].length;
}

function derive_data() {
    victors_by_tower = Object.fromEntries(towers.map(t => [t.id, []]));
    pack_victors = Object.fromEntries(packs.map(p => [p.id, []]));
    for (let p of players) {
        let done = new Set(p.completions);
        let owned = p.completions.map(id => tower_lookup[id]).filter(Boolean);
        let counts = {};
        for (let t of owned) {
            let diff = diff_name(t.difficulty);
            counts[diff] = (counts[diff] || 0) + 1;
            victors_by_tower[t.id].push(p.username);
        }
        player_hardest[p.username] = owned.reduce((max, t) => Math.max(max, t.difficulty), 0);
        diff_counts[p.username] = counts;
        player_towers[p.username] = owned.sort((a, b) => a.rank - b.rank).map(t => t.id);
        for (let pack of packs) {
            if (pack.towers.length && pack.towers.every(id => done.has(id))) pack_victors[pack.id].push(p.username);
        }
    }
}

function build_lookups() {
    tower_lookup = Object.fromEntries(towers.map(t => [t.id, t]));
    player_lookup = Object.fromEntries(players.map(p => [p.username, p]));
    game_lookup = Object.fromEntries(games.map(g => [g.abbr, g]));
    derive_data();
    tower_names = Object.fromEntries(towers.map(t => {
        let others = `${t["alternate name(s)"]},${t["previous name(s)"]}`.split(",").map(n => n.trim()).filter(n => n.length > 1);
        return [t.id, [t.name, abbr(t.name), ...others, ...others.map(abbr)].map(n => n.toLowerCase())];
    }));

    pack_info = Object.fromEntries(packs.map(p => [p.id, {
        hardest: hardest(p.towers),
        avg_diff: avg_diff(p.towers),
        avg_quality: avg_quality(p.towers),
    }]));
    [...packs].sort((a, b) => b.xp - a.xp).forEach((p, i) => pack_info[p.id].rank = i + 1);

    for (let names of Object.values(pack_victors)) {
        for (let name of names) pack_counts[name] = (pack_counts[name] || 0) + 1;
    }
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

function format_length(length) {
    let value = String(length ?? "").trim();
    return value && !value.endsWith("+") ? `${value}+` : value;
}

function plain_click(event) {
    return event.button == 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}

function open_tower_row_link(event, id) {
    if (!plain_click(event)) return true;
    open_tower(id);
    return false;
}

function open_player_row_link(event, name, rank) {
    if (!plain_click(event)) return true;
    open_player(name, rank);
    return false;
}

function middle_click(event, url) {
    if (event.button != 1) return;
    event.preventDefault();
    window.open(url, "_blank", "noopener");
}

function tower_row(t, last, button = "tower-link", attrs = "") {
    return `
        <tr ${attrs}>
            <td class="${diff_name(t.difficulty)}">#${t.rank}</td>
            <td><a class="table-row-link ${button}" href="/?t=${t.id}" onclick="return open_tower_row_link(event, ${t.id})">${esc(t.name)}</a></td>
            ${last}
        </tr>
    `;
}

function diff_row(t, button) {
    return tower_row(t, `<td>${diff_span(t.difficulty)}</td>`, button);
}

function pack_button(pack, button = "pack-link") {
    return `<button class="${button}" onclick="open_pack('${pack.id}')" onmousedown="middle_click(event, '/?pk=${encodeURIComponent(pack.id)}')">${esc(pack.name)}</button>`;
}

function player_row(name, rank, last) {
    let player = find_player(name);
    let encoded_name = encodeURIComponent(player ? player_identifier(player) : name).replace(/'/g, "%27");
    return `
        <tr data-name="${esc(name.toLowerCase())}">
            <td>#${rank}</td>
            <td>${player ? `<a class="table-row-link player-link" href="/?u=${encoded_name}" onclick="return open_player_row_link(event, decodeURIComponent('${encoded_name}'), ${rank})">${role(name, true)}</a>` : role(name, true)}</td>
            ${last}
        </tr>
    `;
}

let tables = {};

function render_rows(table, items, row) {
    tables[table] = {items, row, count: 0};
    $("#" + table).empty();
    more_rows(table);
}

function more_rows(table) {
    let state = tables[table];
    if (state.count >= state.items.length) return;
    let next = state.items.slice(state.count, state.count + 100);
    state.count += next.length;
    $("#" + table).append(next.map(state.row).join(""));
}

function render_victors(table, names, empty) {
    let victors = names.filter(name => player_lookup[name]);
    if (!victors.length) {
        delete tables[table];
        $("#" + table).html(empty_row(empty));
        return;
    }
    render_rows(table, victors, name => {
        let p = player_lookup[name];
        return player_row(name, p.rank, td_right(`Level ${level_text(p.total_xp, true)}`));
    });
}

$(".list, #tower-details, #pack-details, #player-details").on("scroll", function () {
    if (this.scrollTop + this.clientHeight < this.scrollHeight - 800) return;
    $(this).find("table").each((i, table) => tables[table.id] && more_rows(table.id));
});

function diff_range() {
    return [+$("#diff-min").val(), +$("#diff-max").val()];
}

function render_towers() {
    let sort = $("#tower-sort").val() || "difficulty";
    let sign = $("#tower-sort-dir").attr("data-dir") == "asc" ? -1 : 1;
    let value = {
        difficulty: t => -t.rank,
        victors: t => victors(t.id),
        quality: t => -quality_order[t.quality],
        length: t => parseInt(t["time/length"], 10),
    }[sort];
    let last = {
        difficulty: t => diff_span(t.difficulty),
        victors: t => victors(t.id),
        quality: t => `<span class="${quality_cls(t.quality)}">${t.quality}</span>`,
        length: t => format_length(t["time/length"]),
    }[sort];

    let search = query();
    let place = $("#game-filter").val();
    let [low, high] = diff_range();
    let player = checked_player();
    let done_towers = new Set(player ? player.completions : []);

    let matches = towers.filter(t => {
        if (sort == "quality" && t.quality == null) return false;
        if (sort == "length" && String(t["time/length"] || "").trim() == "") return false;
        return tower_names[t.id].some(name => name.includes(search)) && t.difficulty >= low && t.difficulty <= high && (!place || t.places.some(p => p[0] == place));
    });
    matches.sort((a, b) => sign * (value(b) - value(a)) || sign * (b.rank - a.rank));
    render_rows("towers-table", matches, t => tower_row(t, td_right(last(t)), done_towers.has(t.id) ? "tower-link-done" : "tower-link", `data-id="${t.id}"`));
}

function render_players() {
    let sort = $("#player-sort").val() || "xp";
    let asc = $("#player-sort-dir").attr("data-dir") == "asc";
    let sign = asc ? -1 : 1;
    let diff = sort.startsWith("most-") ? title_case(sort.slice(5)) : null;
    let value = {
        xp: p => p.total_xp,
        completions: p => p.completions.length,
        packs: p => pack_counts[p.username] || 0,
        hardest: p => player_hardest[p.username],
    }[sort] || (p => diff_counts[p.username][diff] || 0);
    let text = {
        xp: v => `Level ${level_text(v, true)}`,
        completions: v => `${v} SCs`,
        packs: v => `${v} Packs`,
        hardest: v => diff_span(v),
    }[sort] || (v => `<span class="${diff}">${v} ${diff}s</span>`);

    let search = query();
    let country = $("#country-filter").val();
    let ranked = [...players].sort((a, b) => sign * (value(b) - value(a)) || b.total_xp - a.total_xp).filter(p => value(p) != 0 || !(asc || diff));

    let matches = [];
    ranked.forEach((p, i) => {
        if (p.username.toLowerCase().includes(search) && (!country || p.nationality == country)) matches.push([p, i + 1, value(p)]);
    });
    render_rows("players-table", matches, ([p, rank, v]) => player_row(p.username, rank, td_right(text(v))));
}

function filter_packs() {
    let search = query();
    filter_rows("packs-table", row => row.dataset.name.includes(search));
}

function checked_player() {
    if (!me) return false;
    return players.find(p => p.userid == me.id) || find_player(me.name);
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
        progress_towers_left: p => p.towers.length - done_count(p, player),
        progress_percentage: p => p.towers.length ? done_count(p, player) / p.towers.length : 0,
        quality: p => quality_order[pack_info[p.id].avg_quality],
        victors: p => pack_victors[p.id].length,
    }[sort];
    let last = {
        xp: p => `${format_num(p.xp)} XP`,
        towers: p => `${done_count(p, player)}/${p.towers.length}`,
        hardest: p => diff_span(pack_info[p.id].hardest),
        progress_towers_left: p => `${p.towers.length - done_count(p, player)} left`,
        progress_percentage: p => `${(value(p) * 100).toFixed(1)}%`,
        quality: p => `<span class="${quality_cls(pack_info[p.id].avg_quality)}">${pack_info[p.id].avg_quality}</span>`,
        victors: p => pack_victors[p.id].length,
    }[sort];

    let sorted_packs = packs.filter(p => sort != "quality" || pack_info[p.id].avg_quality != null);
    sorted_packs.sort((a, b) => sign * (value(b) - value(a)) || (sort == "xp" ? -sign * (pack_info[b.id].rank - pack_info[a.id].rank) : 0));

    $("#packs-table").html(sorted_packs.map(pack => {
        let done = pack.towers.length > 0 && done_count(pack, player) == pack.towers.length;
        return `
            <tr data-name="${esc(pack.name.toLowerCase())}">
                <td class="${diff_name(pack_info[pack.id].avg_diff)}">#${pack_info[pack.id].rank}</td>
                <td>${pack_button(pack, done ? "pack-link-done" : "pack-link")}</td>
                ${td_right(last(pack))}
            </tr>
        `;
    }).join(""));
    filter_packs();
}

function open_pack(id) {
    current_pack_id = id;
    open_page("Packs", true);
    let pack = packs.find(p => p.id == id);
    let player = checked_player();
    let names = pack_victors[id];

    $("#pack-name").html(esc(pack.name));
    $("#pack-progress").html(`${done_count(pack, player)}/${pack.towers.length}`);
    $("#pack-bonus").html(`${format_num(pack.xp)} XP`);
    $("#pack-victor-count").html(names.length);

    let pack_towers = pack.towers.map(tid => tower_lookup[tid]).filter(Boolean).sort((a, b) => a.difficulty - b.difficulty);
    $("#pack-towers").html(pack_towers.map(t => diff_row(t, player && player.completions.includes(t.id) ? "tower-link-done" : "tower-link")).join(""));
    render_victors("pack-victors", names, "No pack victors yet");
}

function range_color(value) {
    let stops = [[0x00, 0x3F, 0xFF], [0x00, 0x9F, 0xFF], [0x00, 0xFF, 0xFF], [0xFF, 0xFF, 0xFF], [0xEC, 0xB2, 0xFA], [0x9F, 0x3F, 0xFF]];
    let pos = Math.min(Math.max((value - 800) / 599 * 6 - 0.5, 0), 5);
    let i = Math.min(Math.floor(pos), 4);
    return `rgb(${stops[i].map((c, k) => Math.round(c + (stops[i + 1][k] - c) * (pos - i))).join(",")})`;
}

function show_range() {
    let [low, high] = diff_range();
    $("#diff-min").css("--knob", range_color(low));
    $("#diff-max").css("--knob", range_color(high));
    $("#diff-min-text").val(format_num(low / 100));
    $("#diff-max-text").val(format_num(high / 100));
    $("#range-dim-low").css("width", `${(low - 800) / 599 * 100}%`);
    $("#range-dim-high").css("width", `${(1399 - high) / 599 * 100}%`);
}

$("#diff-min, #diff-max").on("input", function () {
    let [low, high] = diff_range();
    if (low > high) $(this.id == "diff-min" ? "#diff-max" : "#diff-min").val(this.value);
    show_range();
});
$(".range").on("pointerdown", function (e) {
    if ($(e.target).is("input")) return;
    let box = this.getBoundingClientRect();
    let to_value = x => Math.round(800 + Math.min(Math.max((x - box.left - 9) / (box.width - 18), 0), 1) * 599);
    let value = to_value(e.clientX);
    let [low, high] = diff_range();
    let knob = $(value - low < high - value ? "#diff-min" : "#diff-max");
    knob.val(value).trigger("input");
    $(document).on("pointermove.range", e => knob.val(to_value(e.clientX)).trigger("input"));
    $(document).one("pointerup.range", () => $(document).off("pointermove.range"));
    e.preventDefault();
});
$(".diff-text").on("change", function () {
    let value = Math.round(parseFloat(this.value) * 100);
    if (!isNaN(value)) $(this.id == "diff-min-text" ? "#diff-min" : "#diff-max").val(Math.min(Math.max(value, 800), 1399)).trigger("input");
    show_range();
});
$(".diff-text").on("keydown", function (e) {
    if (e.key == "Enter") this.blur();
    if (e.key != "ArrowUp" && e.key != "ArrowDown") return;
    e.preventDefault();
    let slider = $(this.id == "diff-min-text" ? "#diff-min" : "#diff-max");
    let step = e.shiftKey ? 10 : 1;
    slider.val(Math.min(Math.max(+slider.val() + (e.key == "ArrowUp" ? step : -step), 800), 1399)).trigger("input");
});
$("#game-filter, #diff-min, #diff-max").on("input", render_towers);
$("#country-filter").on("change", render_players);

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

function places_html(tower) {
    return tower.places.map(([abbr, extra]) => {
        let href = abbr == "Place" ? tower.game : game_lookup[abbr]?.link;
        return `<a href='${esc(href)}' target='_blank'>${esc(extra ? `${abbr}, ${extra}` : abbr)}</a>`;
    }).join(" / ");
}

function quality_cls(q) {
    let suffix = q == "S+" ? "-plus" : q == "S-" ? "-minus" : "";
    return "quality-" + q.replace(/[+\-]$/, "").toLowerCase() + suffix;
}

function entity_link(kind, key, label) {
    return `<a href="/?${kind}=${encodeURIComponent(key)}" data-open="${kind}" data-key="${encodeURIComponent(key)}">${label}</a>`;
}

$(document).on("click", "a[data-open]", function (e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.which > 1) return;
    e.preventDefault();
    let key = decodeURIComponent(this.getAttribute("data-key"));
    let kind = this.getAttribute("data-open");
    if (kind == "u") open_player(key);
    else if (kind == "pk") open_pack(key);
    else open_tower(+key);
});

function render_tower_creators(creators) {
    let creator_links = names => names.map(c => {
        let player = find_player(c);
        return player ? entity_link("u", player.username, esc(c)) : esc(c);
    }).join(", ");
    let toggle = label => `<button type="button" class="link-button" onclick="toggle_tower_creators()">${label}</button>`;
    if (creators.length <= 5) return creator_links(creators);
    if (tower_creators_expanded) {
        return `${creator_links(creators)} ${toggle("(Show Less)")}`;
    }
    return `${creator_links(creators.slice(0, 4))}, ${toggle(`and ${creators.length - 4} other creators`)}`;
}

function toggle_tower_creators() {
    tower_creators_expanded = !tower_creators_expanded;
    $("#tower-creator").html(row_html("Creators", render_tower_creators(tower_lookup[current_tower_id].creators)));
}

function row_html(label, value) {
    return `<span class="label">${label}</span><span>${value}</span>`;
}

function show_info(selector, content, method = "html") {
    $(selector)[method](content).toggle(Boolean(content));
}

function open_tower(id) {
    current_tower_id = id;
    tower_creators_expanded = false;
    open_page("Towers", true);
    let tower = tower_lookup[id];
    let diff = diff_name(tower.difficulty);

    let known_as = (field, label) => {
        let names = tower[field]?.trim().replace(/,(?=\S)/g, ", ");
        return names ? `${label}: ${names}` : "";
    };

    $("#tower-name").html(`(${esc(abbr(tower.name))}) ${esc(tower.name)}`);
    show_info("#tower-alternate-names", known_as("alternate name(s)", "also known as"), "text");
    show_info("#tower-previous-names", known_as("previous name(s)", "previously known as"), "text");
    $("#tower-diff").html(`<span class="${diff}">${sub_range(tower.difficulty)} ${diff}</span> (${format_num(tower.difficulty / 100)})`);
    $("#tower-location").html(places_html(tower));
    $("#tower-rank").html(tower.rank);
    show_info("#tower-creator", tower.creators.length ? row_html("Creators", render_tower_creators(tower.creators)) : "");
    $("#tower-xp").html(tower.xp);
    $("#tower-victor-count").html(victors(id));
    show_info("#tower-quality", tower.quality ? row_html("Quality", `<span class="${quality_cls(tower.quality)}">${tower.quality}</span>`) : "");
    show_info("#tower-length", tower["time/length"] ? row_html("Length", `${format_length(tower["time/length"])} minutes`) : "");
    let tower_packs = packs.filter(pack => pack.towers.includes(id));
    show_info("#tower-packs", tower_packs.length ? row_html("Packs", tower_packs.map(pack => entity_link("pk", pack.id, esc(pack.name))).join(", ")) : "");
    render_victors("tower-victors", victors_by_tower[id], "No SCLP victors yet");
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
    if (found) return colored(esc(name), role_colors[found]);
    return cool_members.includes(name) ? `<span class="cool">${esc(name)}</span>` : esc(name);
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

function show_player_tower_view(view) {
    let panes = {completions: "#player-towers", packs: "#player-packs", creations: "#player-creations"};
    for (let [name, pane] of Object.entries(panes)) {
        $(pane).toggleClass("hidden", name != view);
        $(`#player-${name}-tab`).toggleClass("active", name == view).attr("aria-pressed", String(name == view));
    }
    $("#player-creation-filters").toggleClass("hidden", view != "creations");
}

function render_player_creations() {
    let solo = player_created_towers.filter(t => t.creators.length == 1);
    $("#player-creation-filter option[value=all]").text(`All creations (${player_created_towers.length})`);
    $("#player-creation-filter option[value=solo]").text(`Solo projects (${solo.length})`);
    $("#player-creation-filter option[value=collab]").text(`Collaborations (${player_created_towers.length - solo.length})`);
    let kind = $("#player-creation-filter").val();
    $("#player-creations").html(player_created_towers.filter(t => kind == "all" || (kind == "solo") == (t.creators.length == 1)).map(t => diff_row(t)).join(""));
}

function open_player(name, rank) {
    let player = find_player(name) || players.find(p => player_identifier(p) == name);
    if (!player) return;
    let username = player.username;
    current_player_name = username;
    current_player_id = player_identifier(player);
    open_page("Leaderboard", true);
    let job = role(username);
    let counts = diff_counts[username];
    let sum = (a, b) => a + b;
    let percent = (got, total) => total ? +(got / total * 100).toFixed(2) : 0;
    let got_all = Object.values(counts).reduce(sum, 0);
    let total_all = Object.values(diff_totals).reduce(sum, 0);

    $("#player-name").html(`${esc(username)} ${flag_html(player.nationality)}`);
    $("#player-role").html(job ? colored(esc(job), role_colors[job]) : "");
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
        <tr>
            <th>Stats</th>
            <th>${got_all}/${total_all}</th>
            <th>${percent(got_all, total_all)}%</th>
        </tr>
    ` + diff_rows);

    let completed = player_towers[username];
    render_rows("player-towers", completed, id => diff_row(tower_lookup[id]));
    let created = towers.filter(t => t.creators.some(creator => creator.toLowerCase() == username.toLowerCase()))
        .sort((a, b) => b.difficulty - a.difficulty || a.rank - b.rank);
    player_created_towers = created;
    render_player_creations();
    let completed_packs = packs.filter(pack => pack_victors[pack.id].includes(username))
        .sort((a, b) => pack_info[a.id].rank - pack_info[b.id].rank);
    $("#player-packs").html(completed_packs.length ? completed_packs.map(pack => `
        <tr>
            <td class="${diff_name(pack_info[pack.id].avg_diff)}">#${pack_info[pack.id].rank}</td>
            <td>${pack_button(pack)}</td>
            ${td_right(`${format_num(pack.xp)} XP`)}
        </tr>
    `).join("") : empty_row("No packs completed"));
    $("#player-completions-tab").text(`Completions (${completed.length})`);
    $("#player-packs-tab").text(`Packs (${completed_packs.length})`);
    $("#player-creations-tab").text(`Creations (${created.length})`);
    let has_tabs = created.length > 0 || completed_packs.length > 0;
    $("#player-tower-view-title").toggleClass("hidden", has_tabs);
    $("#player-tower-views").toggleClass("hidden", !has_tabs);
    $("#player-completions-tab").toggleClass("hidden", !has_tabs);
    $("#player-packs-tab").toggleClass("hidden", completed_packs.length == 0);
    $("#player-creations-tab").toggleClass("hidden", created.length == 0); //this logic kinda ehhhhh
    show_player_tower_view("completions");

    add_badges(player, job);
}

$("#player-creation-filter").on("change", render_player_creations);


$("#game-filter").html("<option value=''>All</option><option value='Place'>Place</option>");
for (let game of games) {
    $("#game-filter").append(`<option value='${esc(game.abbr)}'>${esc(game.abbr)}</option>`);
}

window.addEventListener('popstate', event => restore(() => {
    if (!route(new URLSearchParams(window.location.search)) && event.state && event.state.page) {
        open_page(event.state.page);
    }
}));

show_range();
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

fetch("/get_scotw").then(res => res.json()).then(data => {
    scotw = data;
    render_scotw();
});
