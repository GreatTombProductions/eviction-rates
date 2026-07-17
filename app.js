// Eviction Rates by County — client app
// MD5-sharded detail data with yearly trend charts
// Three search modes: county name, state browse, proximity

(function () {
  'use strict';

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => [...(ctx || document).querySelectorAll(sel)];

  const DATA_BASE = 'data';
  const DETAIL_SHARDS = 256;

  // ── State ──
  let meta = null;
  let searchCache = {};       // letter → index data
  let detailCache = {};       // fips → detail data
  let stateCache = {};        // state → state file
  let proxCache = {};         // state → proximity data
  let lastResults = [];
  let currentDetail = null;

  // ── Init ──
  async function init() {
    try {
      const resp = await fetch(`${DATA_BASE}/meta.json`);
      meta = await resp.json();
      renderIntro();
      populateStates();
    } catch (e) {
      console.error('Failed to load meta:', e);
      $('#intro-stats').innerHTML = '<p>Loading data…</p>';
    }
  }

  function renderIntro() {
    if (!meta) return;
    const rateStr = meta.national_median != null ? `${meta.national_median}%` : '—';
    const filingsStr = meta.total_filings ? (meta.total_filings / 1e6).toFixed(1) + 'M' : '—';
    $('#intro-stats').innerHTML = `
      <div class="stat"><span class="stat-value">${meta.total_counties ? meta.total_counties.toLocaleString() : '—'}</span> counties</div>
      <div class="stat"><span class="stat-value">${rateStr}</span> national median rate</div>
      <div class="stat"><span class="stat-value">${filingsStr}</span> eviction filings</div>
      <p class="intro-text">The Eviction Lab at Princeton University is the definitive source for US eviction data. Filing rates show court-issued eviction filings per 100 renting households, 2000–2018. Search by county name, browse by state, or find eviction risk near any address.</p>
    `;
  }

  function populateStates() {
    if (!meta) return;
    fetch(`${DATA_BASE}/counties.json`)
      .then(r => r.json())
      .then(counties => {
        const states = [...new Set(counties.map(c => c.state).filter(Boolean))].sort();
        const sel = $('#state-select');
        states.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s;
          opt.textContent = s;
          sel.appendChild(opt);
        });
      });
  }

  // ── Tab switching ──
  $$('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $$('.search-panel').forEach(p => p.classList.remove('active'));
      $(`#${btn.dataset.tab}-search`).classList.add('active');
    });
  });

  // ── Name search ──
  let searchTimeout = null;
  $('#search-input').addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = $('#search-input').value.trim();
    if (q.length < 1) {
      $('#search-results').innerHTML = '';
      return;
    }
    searchTimeout = setTimeout(() => doNameSearch(q), 150);
  });

  async function doNameSearch(q) {
    const first = q[0].toLowerCase();
    if (!/[a-z]/.test(first)) return;

    // Load letter index if needed
    if (!searchCache[first]) {
      try {
        const resp = await fetch(`${DATA_BASE}/search/${first}.json`);
        searchCache[first] = await resp.json();
      } catch (e) {
        $('#search-results').innerHTML = '<p class="no-results">No results.</p>';
        return;
      }
    }

    const data = searchCache[first];
    const qLower = q.toLowerCase();
    let matches = data.counties.filter(c =>
      c.name.toLowerCase().includes(qLower)
    );

    // Sort by best match (starts-with first)
    matches.sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(qLower);
      const bStarts = b.name.toLowerCase().startsWith(qLower);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return a.name.localeCompare(b.name);
    });

    lastResults = matches.slice(0, 50);
    renderSearchResults(lastResults);
  }

  function renderSearchResults(results) {
    if (!results.length) {
      $('#search-results').innerHTML = '<p class="no-results">No counties found.</p>';
      return;
    }
    let html = '';
    results.forEach(c => {
      const rate = c.latest_rate != null ? c.latest_rate.toFixed(1) + '%' : '—';
      const yoy = c.yoy_change != null
        ? (c.yoy_change > 0 ? '↑' : c.yoy_change < 0 ? '↓' : '→') + ' ' + Math.abs(c.yoy_change).toFixed(1) + 'pp'
        : '';
      html += `<div class="result-card" data-fips="${c.fips}">
        <div class="result-name">${c.name}, ${c.state}</div>
        <div class="result-meta">Filing rate: <strong>${rate}</strong> ${yoy ? '<span class="yoy">' + yoy + '</span>' : ''} · ${c.num_years} years of data</div>
      </div>`;
    });
    $('#search-results').innerHTML = html;

    $$('.result-card', $('#search-results')).forEach(card => {
      card.addEventListener('click', () => loadDetail(card.dataset.fips));
    });
  }

  // ── State browse ──
  $('#state-select').addEventListener('change', async () => {
    const state = $('#state-select').value;
    if (!state) {
      $('#state-results').innerHTML = '';
      return;
    }

    if (!stateCache[state]) {
      try {
        const resp = await fetch(`${DATA_BASE}/states/${state.toLowerCase()}.json`);
        stateCache[state] = await resp.json();
      } catch (e) {
        $('#state-results').innerHTML = '<p class="no-results">No data for this state.</p>';
        return;
      }
    }

    const data = stateCache[state];
    lastResults = data.counties;
    renderStateResults(data);
  });

  function renderStateResults(data) {
    let html = `<h3>${data.state_name} — ${data.count} counties, ranked by eviction filing rate</h3>`;
    if (!data.counties.length) {
      html += '<p class="no-results">No counties found.</p>';
      $('#state-results').innerHTML = html;
      return;
    }
    data.counties.forEach((c, i) => {
      const rate = c.latest_rate != null ? c.latest_rate.toFixed(1) + '%' : '—';
      const yoy = c.yoy_change != null
        ? (c.yoy_change > 0 ? '↑' : c.yoy_change < 0 ? '↓' : '→') + ' ' + Math.abs(c.yoy_change).toFixed(1) + 'pp'
        : '';
      html += `<div class="result-card" data-fips="${c.fips}">
        <div class="result-rank">${i + 1}.</div>
        <div class="result-info">
          <div class="result-name">${c.name}</div>
          <div class="result-meta">Rate: <strong>${rate}</strong> ${yoy ? '<span class="yoy">' + yoy + '</span>' : ''} · ${c.renting_hh ? c.renting_hh.toLocaleString() : '—'} renting HH</div>
        </div>
      </div>`;
    });
    $('#state-results').innerHTML = html;

    $$('.result-card', $('#state-results')).forEach(card => {
      card.addEventListener('click', () => loadDetail(card.dataset.fips));
    });
  }

  // ── Proximity search ──
  $('#nearby-btn').addEventListener('click', doNearbySearch);
  $('#addr-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doNearbySearch();
  });

  async function doNearbySearch() {
    const addr = $('#addr-input').value.trim();
    if (!addr) return;

    $('#nearby-results').innerHTML = '<p class="loading">Geocoding address…</p>';

    try {
      const geoResp = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}&limit=1&countrycodes=us`
      );
      const geoData = await geoResp.json();
      if (!geoData.length) {
        $('#nearby-results').innerHTML = '<p class="no-results">Address not found. Try a city name or ZIP code.</p>';
        return;
      }

      const lat = parseFloat(geoData[0].lat);
      const lon = parseFloat(geoData[0].lon);
      const displayName = geoData[0].display_name;

      const radius = parseFloat($('#radius-select').value);

      $('#nearby-results').innerHTML = `<p class="loading">Searching within ${radius} miles of ${displayName.split(',')[0]}…</p>`;

      // Load all state proximity files and filter
      const allCounties = [];
      for (const state of (meta ? [...new Set((await fetch(`${DATA_BASE}/counties.json`).then(r => r.json())).map(c => c.state).filter(Boolean))] : [])) {
        if (!proxCache[state]) {
          try {
            const resp = await fetch(`${DATA_BASE}/proximity/${state.toLowerCase()}.json`);
            proxCache[state] = await resp.json();
          } catch (e) {
            continue;
          }
        }
        for (const c of proxCache[state]) {
          const d = haversineKm(lat, lon, c.lat, c.lon);
          const dMi = d * 0.621371;
          if (dMi <= radius) {
            allCounties.push({ ...c, distance: dMi });
          }
        }
      }

      allCounties.sort((a, b) => a.distance - b.distance);
      lastResults = allCounties.slice(0, 50);
      renderProxResults(allCounties.slice(0, 50), displayName);
    } catch (e) {
      console.error(e);
      $('#nearby-results').innerHTML = '<p class="no-results">Search failed. Try again.</p>';
    }
  }

  function renderProxResults(results, addr) {
    if (!results.length) {
      $('#nearby-results').innerHTML = '<p class="no-results">No counties found within this radius.</p>';
      return;
    }
    let html = `<p class="prox-label">Counties near ${addr.split(',')[0]}:</p>`;
    results.forEach(c => {
      const rate = c.latest_rate != null ? c.latest_rate.toFixed(1) + '%' : '—';
      html += `<div class="result-card" data-fips="${c.fips}">
        <div class="result-name">${c.name}, ${c.state} <span class="distance">${c.distance.toFixed(1)} mi</span></div>
        <div class="result-meta">Filing rate: <strong>${rate}</strong></div>
      </div>`;
    });
    $('#nearby-results').innerHTML = html;

    $$('.result-card', $('#nearby-results')).forEach(card => {
      card.addEventListener('click', () => loadDetail(card.dataset.fips));
    });
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ── Detail loading ──
  async function loadDetail(fips) {
    // Load from MD5 shard
    const shard = md5Shard(fips);
    if (!detailCache[fips]) {
      if (!detailCache._shards) detailCache._shards = {};
      if (!detailCache._shards[shard]) {
        try {
          const resp = await fetch(`${DATA_BASE}/details/${shard}.json`);
          detailCache._shards[shard] = await resp.json();
        } catch (e) {
          console.error('Failed to load detail shard:', e);
          return;
        }
      }
      detailCache[fips] = detailCache._shards[shard][fips];
    }

    const d = detailCache[fips];
    if (!d) return;
    currentDetail = d;

    renderDetail(d);
    $('#intro').classList.add('hidden');
    $$('.search-panel').forEach(p => p.classList.add('hidden'));
    $('#detail').classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  function md5Shard(key) {
    // Simple MD5 first-2-hex shard — matches Python pipeline
    // Use SubtleCrypto for proper MD5, or fall back to a simple hash
    // We use an inline implementation to match Python hashlib.md5
    return md5hex(key).substring(0, 2);
  }

  // ── MD5 implementation (matches Python hashlib.md5) ──
  function md5hex(str) {
    // Rotate functions
    function rotl(x, n) { return (x << n) | (x >>> (32 - n)); }
    function add32(a, b) { return ((a + b) & 0xFFFFFFFF) >>> 0; }

    // Convert string to bytes (UTF-8)
    const bytes = new TextEncoder().encode(str);
    const len = bytes.length;

    // Padding
    const padded = new Uint8Array(((len + 8) >>> 6 << 6) + 64);
    padded.set(bytes);
    padded[len] = 0x80;
    // Append bit length (in bits) as 64-bit little-endian
    const bitLen = len * 8;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, bitLen % 0x100000000, true);
    view.setUint32(padded.length - 4, Math.floor(bitLen / 0x100000000), true);

    // Initial values
    let a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;

    // Constants
    const K = [];
    for (let i = 0; i < 64; i++) {
      K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
    }
    const S = [7,12,17,22, 7,12,17,22, 7,12,17,22, 7,12,17,22,
               5,9,14,20, 5,9,14,20, 5,9,14,20, 5,9,14,20,
               4,11,16,23, 4,11,16,23, 4,11,16,23, 4,11,16,23,
               6,10,15,21, 6,10,15,21, 6,10,15,21, 6,10,15,21];

    // Process each 64-byte chunk
    const words = new Uint32Array(padded.buffer);
    for (let i = 0; i < words.length; i += 16) {
      let A = a, B = b, C = c, D = d;
      for (let j = 0; j < 64; j++) {
        let F, g;
        if (j < 16) { F = (B & C) | (~B & D); g = j; }
        else if (j < 32) { F = (D & B) | (~D & C); g = (5 * j + 1) % 16; }
        else if (j < 48) { F = B ^ C ^ D; g = (3 * j + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * j) % 16; }
        F = (F + A + K[j] + words[i + g]) >>> 0;
        A = D; D = C; C = B;
        B = (B + rotl(F, S[j])) >>> 0;
      }
      a = (a + A) >>> 0;
      b = (b + B) >>> 0;
      c = (c + C) >>> 0;
      d = (d + D) >>> 0;
    }

    // Convert to hex
    function hex(v) { return ('00' + v.toString(16)).slice(-2); }
    const harr = new Uint8Array(16);
    const hview = new DataView(harr.buffer);
    hview.setUint32(0, a, true);
    hview.setUint32(4, b, true);
    hview.setUint32(8, c, true);
    hview.setUint32(12, d, true);
    return [...harr].map(b => hex(b)).join('');
  }

  // ── Detail rendering ──
  function renderDetail(d) {
    const rate = d.latest_rate != null ? d.latest_rate.toFixed(1) + '%' : 'No data';
    const avgRate = d.avg_rate != null ? d.avg_rate.toFixed(1) + '%' : '—';
    const peakRate = d.peak_rate != null ? d.peak_rate.toFixed(1) + '%' : '—';
    const yoyStr = d.yoy_change != null
      ? (d.yoy_change > 0 ? '+' : '') + d.yoy_change.toFixed(1) + ' pp'
      : '—';
    const yoyClass = d.yoy_change != null
      ? (d.yoy_change > 0.5 ? 'up' : d.yoy_change < -0.5 ? 'down' : 'flat')
      : '';

    // National median comparison
    let medianHTML = '';
    if (d.latest_rate != null && meta && meta.national_median != null) {
      const diff = d.latest_rate - meta.national_median;
      const pctAbove = meta.national_median > 0 ? Math.round(diff / meta.national_median * 100) : 0;
      const arrow = diff > 0.5 ? '↑' : diff < -0.5 ? '↓' : '';
      const cls = diff > 0.5 ? 'above' : diff < -0.5 ? 'below' : 'at';
      medianHTML = `<p>National median: <strong>${meta.national_median}%</strong> — this county is <span class="comp-${cls}"><strong>${arrow} ${Math.abs(pctAbove)}% ${cls}</strong></span> the national median</p>`;
    }

    let html = `
      <h2>${d.name}, ${d.state_name}</h2>
      <div class="detail-stats">
        <div class="big-stat">
          <span class="big-num">${rate}</span>
          <span class="big-label">eviction filing rate</span>
        </div>
        ${d.yoy_change != null ? `<div class="big-stat sub">
          <span class="big-num yoy-${yoyClass}">${yoyStr}</span>
          <span class="big-label">year-over-year</span>
        </div>` : ''}
        ${d.peak_rate != null ? `<div class="big-stat sub">
          <span class="big-num">${peakRate}</span>
          <span class="big-label">peak rate${d.peak_year ? ' (' + d.peak_year + ')' : ''}</span>
        </div>` : ''}
      </div>

      <div class="detail-grid">
        <div class="detail-cell">
          <span class="cell-label">Average rate</span>
          <span class="cell-value">${avgRate}</span>
        </div>
        <div class="detail-cell">
          <span class="cell-label">Total filings</span>
          <span class="cell-value">${d.total_filings ? d.total_filings.toLocaleString() : '—'}</span>
        </div>
        <div class="detail-cell">
          <span class="cell-label">Renting households</span>
          <span class="cell-value">${d.renting_hh ? d.renting_hh.toLocaleString() : '—'}</span>
        </div>
        <div class="detail-cell">
          <span class="cell-label">Years of data</span>
          <span class="cell-value">${d.num_years}</span>
        </div>
      </div>

      ${medianHTML}

      <h3>Eviction Filing Rate Trend (2000–2018)</h3>
      ${d.yearly && d.yearly.length > 1 ? `<div class="chart-container"><canvas id="trend-chart"></canvas></div>` : '<p>Not enough yearly data for trend chart.</p>'}

      <p class="data-note">Data: Eviction Lab at Princeton University. Filing rate = court-issued eviction filings per 100 renting households. Most recent data is from 2018.</p>
    `;

    $('#detail-content').innerHTML = html;

    // Draw chart
    if (d.yearly && d.yearly.length > 1) {
      setTimeout(() => drawChart(d), 100);
    }
  }

  // ── Chart drawing ──
  function drawChart(detail) {
    const canvas = $('#trend-chart');
    if (!canvas) return;

    const container = canvas.parentElement;
    const width = container.clientWidth;
    const height = Math.max(300, Math.min(width * 0.5, 400));

    canvas.width = width * 2;
    canvas.height = height * 2;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);

    const padding = { top: 20, right: 30, bottom: 50, left: 50 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const yearly = detail.yearly.filter(y => y.rate != null);
    if (yearly.length < 2) return;

    const rates = yearly.map(y => y.rate);
    const minVal = Math.floor(Math.min(...rates) / 2) * 2;
    const maxVal = Math.ceil(Math.max(...rates) / 2) * 2;
    const range = maxVal - minVal || 1;

    const xScale = i => padding.left + (i / (yearly.length - 1)) * chartW;
    const yScale = v => padding.top + chartH - ((v - minVal) / range) * chartH;

    // Background
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);

    // Horizontal grid lines
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 0.5;
    for (let v = minVal; v <= maxVal; v += 2) {
      const y = yScale(v);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartW, y);
      ctx.stroke();
      // Label
      ctx.fillStyle = '#888';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(v + '%', padding.left - 6, y + 4);
    }

    // National median line
    if (meta && meta.national_median != null) {
      const my = yScale(meta.national_median);
      ctx.strokeStyle = '#e63946';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padding.left, my);
      ctx.lineTo(padding.left + chartW, my);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#e63946';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`US median (${meta.national_median}%)`, padding.left + chartW + 4, my + 4);
    }

    // Data line
    ctx.strokeStyle = '#2a6496';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    yearly.forEach((y, i) => {
      const x = xScale(i);
      const py = yScale(y.rate);
      if (i === 0) ctx.moveTo(x, py);
      else ctx.lineTo(x, py);
    });
    ctx.stroke();

    // Data points
    yearly.forEach((y, i) => {
      const x = xScale(i);
      const py = yScale(y.rate);
      ctx.fillStyle = '#2a6496';
      ctx.beginPath();
      ctx.arc(x, py, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // X-axis labels (show every 3rd year)
    ctx.fillStyle = '#666';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    yearly.forEach((y, i) => {
      if (i % 3 === 0 || i === yearly.length - 1) {
        const x = xScale(i);
        ctx.fillText(y.year, x, padding.top + chartH + 16);
      }
    });

    // Axis labels
    ctx.fillStyle = '#888';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Year', padding.left + chartW / 2, padding.top + chartH + 38);
    ctx.save();
    ctx.translate(14, padding.top + chartH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Filing Rate (%)', 0, 0);
    ctx.restore();
  }

  // ── Back button ──
  $('#back-btn').addEventListener('click', () => {
    $('#detail').classList.add('hidden');
    $('#intro').classList.remove('hidden');
    $$('.search-panel').forEach(p => {
      if (p.classList.contains('active') || p.id === 'name-search') {
        p.classList.add('active');
      }
    });
    // Re-show the active tab panel
    const activeTab = $('.tab.active');
    if (activeTab) {
      $$('.search-panel').forEach(p => p.classList.remove('active'));
      const panelId = activeTab.dataset.tab + '-search';
      const panel = $('#' + panelId);
      if (panel) panel.classList.add('active');
    }
    window.scrollTo(0, 0);
  });

  // ── Start ──
  init();
})();
