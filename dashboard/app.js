// Token Launch Radar — reads window.RADAR (data.js beside dashboard/), renders the board,
// live and excluded lanes, the model page and a per-protocol detail view. No network, no
// frameworks. All numbers come from data.js; the sandbox only recomputes client-side.
(function () {
  'use strict';
  var app = document.getElementById('app');
  var D = window.RADAR || null;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function num(x, d) { return (typeof x === 'number' && isFinite(x)) ? x : d; }
  function has(x) { return x !== null && x !== undefined; }

  var nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (!has(n) || !isFinite(n)) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + nf0.format(n);
  }
  function fmtPct(n) {
    if (!has(n) || !isFinite(n)) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(d) {
    if (!has(d)) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(d)) + 'd';
  }
  function fmtMult(n) { return has(n) && isFinite(n) ? '×' + n.toFixed(2) : '—'; }
  function fmtOdds(o) {
    if (!has(o) || !isFinite(o)) return '—';
    if (o >= 0 && o <= 1) return Math.round(o * 100) + '%';
    return '×' + o.toFixed(2);
  }
  function fmtDate(s) {
    if (!s) return '—';
    var d = new Date(s);
    return isNaN(d) ? esc(s) : d.toISOString().slice(0, 10);
  }
  function chainsOf(r) { return arr(r.chains).length ? arr(r.chains).join(', ') : '—'; }
  function verdictBadge(v) {
    var s = String(v || '').toLowerCase();
    var cls = s === 'farm' ? 'notoken' : s === 'watch' ? 'watch' : 'live';
    return '<span class="badge ' + cls + '">' + esc(v || '—') + '</span>';
  }

  // sandbox: re-weight the stored model, defaults reproduce the stored board ----
  // launch_value already carries the fitted growth (weight 0.5) and maturity factors, so the
  // sandbox swaps the growth factor for one at the user's weight, scales the launch value, and
  // optionally drops odds. At base 1, growth weight 0.5, odds on, sbx == stored implied value.
  var comps = (D && D.model && D.model.comps) || {};
  var DEF_BASE = 1;
  var DEF_GROWTH = 0.5;
  var state = {
    tab: 'board', q: '', category: 'all', chain: 'all', watchOnly: false, minTvl: '',
    sort: 'implied', dir: -1, selected: null,
    sbx: { base: DEF_BASE, growth: DEF_GROWTH, odds: true }
  };
  function sbxActive() {
    return state.sbx.base !== DEF_BASE || state.sbx.growth !== DEF_GROWTH || !state.sbx.odds;
  }
  function sbxImplied(r) {
    var launch = num(r.launch_value_usd, null);
    if (launch === null) return num(r.implied_value_usd, null);
    var chg = Math.max(-60, Math.min(120, num(r.change_7d, 0)));
    var oldGM = num(r.growth_multiplier, 1) || 1;
    var newGM = 1 + state.sbx.growth * chg / 100;
    var odds = state.sbx.odds ? num(r.odds, 1) : 1;
    return Math.max(1, Math.round(launch * (newGM / oldGM) * state.sbx.base * odds));
  }
  function effImplied(r) { return sbxActive() ? sbxImplied(r) : num(r.implied_value_usd, null); }

  // ---- filtering + sorting ----
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var minTvl = state.minTvl === '' ? 0 : parseFloat(state.minTvl) || 0;
    return arr(D.rows).filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && arr(r.chains).indexOf(state.chain) < 0) return false;
      if (state.watchOnly && !r.watchlist) return false;
      if (num(r.tvl_usd, 0) < minTvl) return false;
      if (q) {
        var hay = [r.name, r.slug, r.category, arr(r.chains).join(' ')].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function sortVal(r, key) {
    if (key === 'rank') return num(r.rank, 1e9);
    if (key === 'tvl') return num(r.tvl_usd, -1);
    if (key === 'growth') return has(r.change_7d) ? r.change_7d : -Infinity;
    if (key === 'age') return has(r.age_days) ? r.age_days : -Infinity;
    if (key === 'odds') return has(r.odds) ? r.odds : -Infinity;
    return num(effImplied(r), -1); // implied
  }
  function sortedRows(list) {
    var key = state.sort, dir = state.dir;
    var out = list.slice().sort(function (a, b) {
      var av = sortVal(a, key), bv = sortVal(b, key);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return String(a.slug) < String(b.slug) ? -1 : 1;
    });
    if (sbxActive()) {
      // live re-rank: positions come from the sandbox order, not the stored rank
      out.forEach(function (r, i) { r._pos = i + 1; });
    }
    return out;
  }
  function shownRank(r) { return sbxActive() ? (r._pos || r.rank) : r.rank; }

  // ---- shell: header, KPIs, tabs, sandbox (rebuilt on tab change / sandbox reset) ----
  function headerHtml() {
    var source = typeof D.source === 'string' && D.source.indexOf('http') !== 0
      ? D.source : 'DefiLlama protocols';
    return '<header class="top"><div class="brand"><span class="mark"></span><div><h1>Token Launch Radar</h1>' +
      '<span class="sub">Pre-token protocols, ranked by implied value</span></div></div>' +
      '<div class="top-meta"><span>Snapshot <b>' + esc(D.as_of || '—') + '</b></span>' +
      '<span>Source <b>' + esc(source) + '</b></span>' +
      '<span>Model <b>' + esc(D.model_version || '—') + '</b></span></div></header>';
  }
  function kpiHtml() {
    var rows = arr(D.rows);
    var watch = rows.filter(function (r) { return r.watchlist; }).length;
    var wl = num(D.watchlist_size, rows.length);
    var c = D.counts || {};
    var kpis = [
      ['Watchlist covered', watch + ' / ' + wl, 'protocols on the watchlist'],
      ['Ranked rows', String(num(c.ranked, num(D.board_size, rows.length))), 'pre-token protocols scored'],
      ['Live-token protocols', String(num(c.live, arr(D.live).length)), 'set aside, market caps shown'],
      ['Excluded', String(num(c.excluded, arr(D.excluded).length)), 'protocols not ranked'],
      ['Comps pool', String(num(comps.n, 0)), 'live tokens fitted'],
      ['Median mcap / TVL', has(comps.median_ratio) ? '×' + comps.median_ratio.toFixed(2) : '—', 'fitted comps ratio']
    ];
    return '<section class="kpis" aria-label="Snapshot summary">' + kpis.map(function (k) {
      return '<div class="kpi"><span>' + k[0] + '</span><b>' + esc(k[1]) + '</b><small>' + k[2] + '</small></div>';
    }).join('') + '</section>';
  }
  function tabsHtml() {
    var tabs = [
      ['board', 'Board', arr(D.rows).length],
      ['live', 'Live tokens', arr(D.live).length],
      ['excluded', 'Excluded lanes', arr(D.excluded).length],
      ['model', 'Model & methodology', null]
    ];
    return '<div class="tabs" role="tablist">' + tabs.map(function (t) {
      return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (state.tab === t[0]) + '">' +
        t[1] + (t[2] !== null ? ' <span class="n">' + t[2] + '</span>' : '') + '</button>';
    }).join('') + '</div>';
  }
  function sandboxHtml() {
    if (state.tab !== 'board') return '';
    var on = sbxActive();
    return '<section class="panel sandbox' + (on ? ' on' : '') + '" aria-label="Model sandbox">' +
      '<h3>Model sandbox — recompute the board live</h3>' +
      '<div class="field"><label for="sbx-base">Base multiple</label>' +
      '<input id="sbx-base" type="number" step="0.05" min="0" data-sbx="base" value="' + state.sbx.base + '"></div>' +
      '<div class="field"><label for="sbx-growth">Growth weight</label>' +
      '<input id="sbx-growth" type="number" step="0.05" data-sbx="growth" value="' + state.sbx.growth + '"></div>' +
      '<label class="check"><input type="checkbox" data-sbx="odds"' + (state.sbx.odds ? ' checked' : '') + '> Apply odds</label>' +
      '<button type="button" class="btn" data-action="sbx-reset">Reset</button>' +
      '<p class="note">implied = launch value × (new growth factor ÷ stored growth factor) × base multiple × odds' +
      (on ? ' — <b>sandbox values active, board re-ranked</b>' : ' — defaults reproduce the stored board (base ×1.00, growth weight 0.50, odds on)') +
      '. The stored ranking returns on reset.</p></section>';
  }

  // ---- views ----
  function controlsHtml() {
    var cats = [], chains = [];
    arr(D.rows).forEach(function (r) {
      if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
      arr(r.chains).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
    });
    cats.sort(); chains.sort();
    function opts(list, cur, allLabel) {
      return '<option value="all"' + (cur === 'all' ? ' selected' : '') + '>' + allLabel + '</option>' +
        list.map(function (v) {
          return '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(v) + '</option>';
        }).join('');
    }
    return '<div class="controls">' +
      '<div class="field"><label for="q">Search</label>' +
      '<input id="q" type="search" placeholder="Search name, slug or chain" value="' + esc(state.q) + '" aria-label="Search the board"></div>' +
      '<div class="field"><label for="category">Category</label><select id="category">' + opts(cats, state.category, 'All categories') + '</select></div>' +
      '<div class="field"><label for="chain">Chain</label><select id="chain">' + opts(chains, state.chain, 'All chains') + '</select></div>' +
      '<label class="check"><input type="checkbox" id="watch-only"' + (state.watchOnly ? ' checked' : '') + '> Watchlist only</label>' +
      '<div class="field"><label for="min-tvl">Min TVL (USD)</label>' +
      '<input id="min-tvl" type="number" min="0" step="1000000" placeholder="0" value="' + esc(state.minTvl) + '"></div>' +
      '</div>';
  }
  function filterLineHtml(shown, total) {
    var chips = [];
    if (state.q.trim()) chips.push('search “' + esc(state.q.trim()) + '”');
    if (state.category !== 'all') chips.push('category ' + esc(state.category));
    if (state.chain !== 'all') chips.push('chain ' + esc(state.chain));
    if (state.watchOnly) chips.push('watchlist only');
    if (state.minTvl !== '' && parseFloat(state.minTvl) > 0) chips.push('min TVL ' + fmtUsd(parseFloat(state.minTvl)));
    if (sbxActive()) chips.push('sandbox on');
    return '<div class="filters-line"><span class="num">' + shown + ' of ' + total + ' rows shown</span>' +
      (chips.length ? chips.map(function (c) { return '<span class="chip">' + c + '</span>'; }).join('') : '<span>No filters — full board</span>') +
      (chips.length ? '<button type="button" class="btn small" data-action="clear-filters">Clear filters</button>' : '') +
      '</div>';
  }
  function sortTh(key, label) {
    var arrow = state.sort === key ? (state.dir < 0 ? ' ▼' : ' ▲') : '';
    return '<th scope="col"><button type="button" data-sort="' + key + '">' + label + arrow + '</button></th>';
  }
  function boardHtml() {
    var list = sortedRows(filteredRows());
    var total = arr(D.rows).length;
    var max = 1;
    list.forEach(function (r) { var v = num(effImplied(r), 0); if (v > max) max = v; });
    var html = controlsHtml() + filterLineHtml(list.length, total);
    if (!list.length) {
      return html + '<div class="panel"><div class="empty"><h2>No protocol matches that filter</h2>' +
        '<p>Clear the search or pick another category to see the board again.</p>' +
        '<button type="button" class="btn primary" data-action="clear-filters">Clear filters</button></div></div>';
    }
    var rows = list.map(function (r) {
      var chg = r.change_7d;
      var chgCls = !has(chg) ? '' : chg >= 0 ? 'pos' : 'neg';
      var imp = effImplied(r);
      var bar = imp ? Math.max(3, Math.round((imp / max) * 100)) : 3;
      return '<tr data-slug="' + esc(r.slug) + '" tabindex="0" data-selected="' + (state.selected === r.slug) + '">' +
        '<td class="num">' + esc(shownRank(r)) + '</td>' +
        '<td><div class="name"><div class="name-row"><b>' + esc(r.name) + '</b>' +
        (r.watchlist ? '<span class="badge watch">Watchlist</span>' : '') + '</div><span class="sub">' + esc(r.category || 'Other') + ' · ' + esc(chainsOf(r)) + '</span></div></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + chgCls + '">' + fmtPct(chg) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num">' + fmtOdds(r.odds) + '</td>' +
        '<td><div class="implied"><div class="bar" aria-hidden="true"><i style="width:' + bar + '%"></i></div>' +
        '<span class="num">' + fmtUsd(imp) + '</span>' + (sbxActive() ? '<span class="sandbox-tag">sbx</span>' : '') + '</div></td>' +
        '<td>' + verdictBadge(r.verdict) + '</td>' +
        '</tr>';
    }).join('');
    return html + '<div class="panel"><div class="table-wrap"><table>' +
      '<caption>Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' +
      (sbxActive() ? ' Sandbox values shown; ranks are the live re-rank.' : '') + '</caption>' +
      '<thead><tr>' + sortTh('rank', 'Rank') + '<th scope="col">Protocol</th>' +
      sortTh('tvl', 'TVL') + sortTh('growth', '7d') + sortTh('age', 'Age') + sortTh('odds', 'Odds') +
      sortTh('implied', 'Implied value') + '<th scope="col">Farm verdict</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }
  function liveHtml() {
    var live = arr(D.live);
    var rows = live.map(function (r) {
      var chg = r.change_7d;
      return '<tr class="static"><td><span class="badge live">live</span></td>' +
        '<td><div class="name"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.category || 'Other') + ' · ' + esc(chainsOf(r)) + '</span></div></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + (!has(chg) ? '' : chg >= 0 ? 'pos' : 'neg') + '">' + fmtPct(chg) + '</td>' +
        '<td class="num">' + fmtUsd(r.mcap_usd) + '</td></tr>';
    }).join('');
    return '<p class="sub" style="padding:0 0 var(--s4)">These protocols already trade. Their market caps are the market’s own values — never model outputs, and never mixed into the pre-token ranking. They are also the comps pool the model is fitted on.</p>' +
      (live.length ? '<div class="panel"><div class="table-wrap"><table>' +
        '<caption>' + live.length + ' live-token protocols, set aside from the ranking.</caption>' +
        '<thead><tr><th scope="col">Status</th><th scope="col">Protocol</th><th scope="col">TVL</th><th scope="col">7d</th><th scope="col">Market cap</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div></div>'
        : '<div class="panel"><div class="empty"><h2>No live-token protocols in this snapshot</h2></div></div>');
  }
  function excludedHtml() {
    var ex = arr(D.excluded);
    var rows = ex.map(function (r) {
      return '<tr class="static"><td><div class="name"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.category || 'Other') + ' · ' + esc(chainsOf(r)) + '</span></div></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td><span class="badge excl">excluded</span></td><td>' + esc(r.reason || '—') + '</td></tr>';
    }).join('');
    return '<p class="sub" style="padding:0 0 var(--s4)">Every protocol the snapshot looked at but did not rank, with the reason. Nothing is silently dropped.</p>' +
      (ex.length ? '<div class="panel"><div class="table-wrap"><table>' +
        '<caption>' + ex.length + ' excluded protocols.</caption>' +
        '<thead><tr><th scope="col">Protocol</th><th scope="col">TVL</th><th scope="col">Lane</th><th scope="col">Reason</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div></div>'
        : '<div class="panel"><div class="empty"><h2>Nothing excluded in this snapshot</h2></div></div>');
  }
  function modelHtml() {
    var v = D.validation || {};
    var wf = v.walk_forward || {}, loo = v.loo || {};
    function valTable(t, title) {
      return '<div><h3>' + title + '</h3><table><thead><tr><th scope="col">Check</th><th scope="col">Model</th><th scope="col">Flat baseline</th></tr></thead><tbody>' +
        '<tr><td>Protocols</td><td class="num">' + (has(t.n) ? esc(t.n) : (has(t.n_test) ? esc(t.n_train) + ' train / ' + esc(t.n_test) + ' test' : '—')) + '</td><td class="num">same set</td></tr>' +
        '<tr><td>Median |log error|</td><td class="num">' + (has(t.median_abs_log_err) ? t.median_abs_log_err.toFixed(2) : '—') + '</td><td class="num">—</td></tr>' +
        '<tr><td>Within 3× of actual</td><td class="num">' + (has(t.within_3x) ? Math.round(t.within_3x * 100) + '%' : '—') + '</td><td class="num">' + (has(t.baseline_within_3x) ? Math.round(t.baseline_within_3x * 100) + '%' : '—') + '</td></tr>' +
        '</tbody></table></div>';
    }
    var floor = has(D.floor_usd) ? fmtUsd(D.floor_usd) : '—';
    return '<section class="panel pad model"><div><h2>How implied value is computed</h2>' +
      '<p class="sub">One fitted function scores every row. No protocol name is special-cased and no row is hand-picked.</p></div>' +
      '<div><h3>Fitted comps formula</h3>' +
      '<div class="formula">log(market cap) = <b>' + (has(comps.a) ? comps.a : '—') + '</b> + <b>' +
      (has(comps.b) ? comps.b : '—') + '</b> × log(TVL)<br>' +
      'fitted on <b>' + num(comps.n, 0) + '</b> live-token comps · median mcap / TVL = <b>×' +
      (has(comps.median_ratio) ? comps.median_ratio.toFixed(2) : '—') + '</b></div>' +
      '<div class="kv" style="margin-top:var(--s3)">' +
      '<div><span>Intercept (a)</span><b>' + (has(comps.a) ? comps.a : '—') + '</b></div>' +
      '<div><span>Slope (b)</span><b>' + (has(comps.b) ? comps.b : '—') + '</b></div>' +
      '<div><span>Comps fitted (n)</span><b>' + num(comps.n, 0) + '</b></div>' +
      '<div><span>Median mcap / TVL</span><b>' + (has(comps.median_ratio) ? '×' + comps.median_ratio.toFixed(2) : '—') + '</b></div>' +
      '</div></div>' +
      '<div><h3>Held-out validation vs the flat baseline</h3>' +
      '<p class="sub" style="margin-bottom:var(--s3)">The flat baseline predicts every token at the median mcap/TVL. The model must beat it out of sample, not just in sample.</p>' +
      valTable(wf, 'Walk-forward') + '<div style="height:var(--s4)"></div>' + valTable(loo, 'Leave-one-out') + '</div>' +
      '<div><h3>Watchlist rule</h3><p>The watchlist is every protocol with at least <b class="num">' + floor + '</b> of TVL that records no token. ' +
      'Protocols below the floor, or with a token on record, are not ranked; they appear in the live and excluded lanes instead.</p></div>' +
      '<div class="note"><b>Honesty note.</b> A protocol on this board <b>records no token</b> — never “has none”. ' +
      'Absence from the token lists is a record state, not a promise that no token exists. Implied value is a model estimate, not a price.</div>' +
      '</section>';
  }

  // ---- detail dialog ----
  var dialog = document.createElement('dialog');
  dialog.className = 'detail';
  dialog.setAttribute('aria-labelledby', 'detail-title');
  dialog.addEventListener('close', function () { state.selected = null; });
  function stepParts(s) {
    var action = s, tail = '';
    var ci = s.indexOf(' Cost: ');
    if (ci >= 0) { action = s.slice(0, ci); tail = s.slice(ci + 1); }
    return { action: action, tail: tail };
  }
  function openDetail(slug) {
    var r = arr(D.rows).filter(function (x) { return x.slug === slug; })[0];
    if (!r) return;
    state.selected = slug;
    var steps = arr(r.farm_steps);
    var stepsHtml = steps.length ? '<ol class="steps">' + steps.map(function (s) {
      var p = stepParts(String(s));
      return '<li><b>' + esc(p.action) + '</b>' + (p.tail ? '<span class="cost">' + esc(p.tail) + '</span>' : '') + '</li>';
    }).join('') + '</ol>' : '<p class="sub">No farm plan recorded for this protocol.</p>';
    var sbxRow = sbxActive() ? '<div><span>Sandbox implied</span><b>' + fmtUsd(sbxImplied(r)) + '</b></div>' : '';
    dialog.innerHTML =
      '<div class="detail-head"><div><span class="brand-name" style="font-family:var(--mono);font-size:13px;color:var(--muted)">Rank ' + esc(shownRank(r)) + ' of ' + num(D.board_size, arr(D.rows).length) + '</span>' +
      '<h2 id="detail-title">' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.category || 'Other') + ' · ' + esc(chainsOf(r)) + ' · listed ' + fmtDate(r.listed_at) + '</p>' +
      (r.watchlist ? '<p style="margin-top:var(--s2)"><span class="badge watch">On the watchlist</span></p>' : '') +
      '</div><button type="button" class="close" data-action="close-detail" aria-label="Close details">Close</button></div>' +
      '<section class="detail-section"><h3>Model breakdown</h3><div class="equation">' +
      '<div><span>TVL</span><b>' + fmtUsd(r.tvl_usd) + '</b></div>' +
      '<div><span>7-day change</span><b>' + fmtPct(r.change_7d) + '</b></div>' +
      '<div><span>Age</span><b>' + fmtAge(r.age_days) + '</b></div>' +
      '<div><span>Launch value</span><b>' + fmtUsd(r.launch_value_usd) + '</b></div>' +
      '<div><span>Odds of a token</span><b>' + fmtOdds(r.odds) + '</b></div>' +
      '<div><span>Growth multiplier</span><b>' + fmtMult(r.growth_multiplier) + '</b></div>' +
      '<div><span>Maturity multiplier</span><b>' + fmtMult(r.maturity_multiplier) + '</b></div>' +
      '<div><span>Implied value</span><b>' + fmtUsd(r.implied_value_usd) + '</b></div>' + sbxRow +
      '</div><p class="sub" style="margin-top:var(--s3)">Model ' + esc(D.model_version || '—') + ': the same function scores every protocol. This is an estimate, not a price.</p></section>' +
      '<section class="detail-section"><h3>Farm plan</h3>' + stepsHtml + '</section>' +
      '<section class="detail-section"><h3>Farm economics</h3><div class="econ">' +
      '<div><span>Farm cost</span><b>' + fmtUsd(r.farm_cost_usd) + '</b></div>' +
      '<div><span>Farm time</span><b>' + (has(r.farm_hours) ? r.farm_hours + ' h' : '—') + '</b></div>' +
      '<div><span>Net per hour</span><b>' + fmtUsd(r.net_per_hour_usd) + '</b></div>' +
      '<div><span>Verdict</span><b>' + esc(r.verdict || '—') + '</b></div></div>' +
      '<p class="verdict">Verdict: <b>' + esc(r.verdict || '—') + '</b></p></section>';
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else dialog.setAttribute('open', '');
  }

  // ---- render ----
  function renderShell() {
    app.innerHTML = '<div class="shell">' + headerHtml() + kpiHtml() + tabsHtml() + sandboxHtml() +
      '<div id="view" style="margin-top:var(--s4)"></div></div>';
    if (!dialog.isConnected) document.body.appendChild(dialog);
    renderView();
  }
  function renderView() {
    var view = document.getElementById('view');
    if (!view) return;
    view.innerHTML = state.tab === 'board' ? boardHtml()
      : state.tab === 'live' ? liveHtml()
      : state.tab === 'excluded' ? excludedHtml()
      : modelHtml();
    // restore focus to the input being typed in after a keystroke re-render
    if (state._focusId) {
      var inp = document.getElementById(state._focusId);
      if (inp) {
        inp.focus();
        if (typeof inp.setSelectionRange === 'function') {
          try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (err) { /* number inputs */ }
        }
      }
      state._focusId = null;
    }
  }

  // ---- events (delegated) ----
  app.addEventListener('click', function (e) {
    var tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) { state.tab = tabBtn.getAttribute('data-tab'); renderShell(); return; }
    var sortBtn = e.target.closest('[data-sort]');
    if (sortBtn) {
      var k = sortBtn.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = -1; }
      renderView(); return;
    }
    var act = e.target.closest('[data-action]');
    if (act) {
      var a = act.getAttribute('data-action');
      if (a === 'clear-filters') {
        state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; state.minTvl = '';
        renderShell();
      } else if (a === 'sbx-reset') {
        state.sbx = { base: DEF_BASE, growth: DEF_GROWTH, odds: true };
        renderShell();
      }
      return;
    }
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  app.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-slug]')) {
      e.preventDefault(); openDetail(e.target.getAttribute('data-slug'));
    }
  });
  app.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'q') { state.q = t.value; state._focusId = 'q'; renderView(); }
    else if (t.id === 'min-tvl') { state.minTvl = t.value; state._focusId = 'min-tvl'; renderView(); }
    else if (t.hasAttribute('data-sbx')) {
      var f = t.getAttribute('data-sbx');
      if (f === 'odds') state.sbx.odds = t.checked;
      else { var v = parseFloat(t.value); if (isFinite(v)) state.sbx[f] = v; }
      renderView();
      var sb = document.querySelector('.sandbox');
      if (sb) sb.classList.toggle('on', sbxActive());
    }
  });
  app.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'category') { state.category = t.value; renderView(); }
    else if (t.id === 'chain') { state.chain = t.value; renderView(); }
    else if (t.id === 'watch-only') { state.watchOnly = t.checked; renderView(); }
  });
  document.addEventListener('click', function (e) {
    var c = e.target.closest('[data-action="close-detail"]');
    if (c) dialog.close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });

  // ---- boot ----
  if (!D) {
    app.innerHTML = '<div class="shell"><div class="panel"><div class="empty">' +
      '<h2>No radar data loaded</h2><p>data.js did not provide window.RADAR. ' +
      'Open this page from the output folder, with data.js beside the dashboard folder.</p></div></div></div>';
    app.setAttribute('aria-busy', 'false');
    return;
  }
  renderShell();
  app.setAttribute('aria-busy', 'false');
})();
