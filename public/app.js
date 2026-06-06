const statusBadge  = document.getElementById('status-badge');
const monitorBtn   = document.getElementById('monitor-btn');
let monitoring = true;
let lastState = {};
const actualEl     = document.getElementById('actual');
const targetEl     = document.getElementById('target');
const probeAEl     = document.getElementById('probe-a');
const probeBEl     = document.getElementById('probe-b');
const errorBar     = document.getElementById('error-bar');
const wp1Temp      = document.getElementById('wp1-temp');
const wp2Temp      = document.getElementById('wp2-temp');
const wp1Status    = document.getElementById('wp1-status');
const wp2Status    = document.getElementById('wp2-status');
const wp1Battery   = document.getElementById('wp1-battery');
const wp2Battery   = document.getElementById('wp2-battery');

// Chart setup
const ctx = document.getElementById('tempChart').getContext('2d');
const chart = new Chart(ctx, {
  type: 'line',
  data: {
    datasets: [
      { label: 'Grill',      borderColor: '#f06a00', backgroundColor: 'rgba(240,106,0,0.08)',  data: [], tension: 0.3, pointRadius: 0 },
      { label: 'Target',     borderColor: '#888',    backgroundColor: 'transparent',            data: [], tension: 0,  pointRadius: 0, borderDash: [4,4] },
      { label: 'Probe A',    borderColor: '#5bc0eb', backgroundColor: 'rgba(91,192,235,0.06)', data: [], tension: 0.3, pointRadius: 0 },
      { label: 'Probe B',    borderColor: '#c3b1e1', backgroundColor: 'rgba(195,177,225,0.06)',data: [], tension: 0.3, pointRadius: 0 },
      { label: 'Wireless 1', borderColor: '#4caf7d', backgroundColor: 'rgba(76,175,125,0.06)', data: [], tension: 0.3, pointRadius: 0 },
      { label: 'Wireless 2', borderColor: '#f9c74f', backgroundColor: 'rgba(249,199,79,0.06)', data: [], tension: 0.3, pointRadius: 0 },
    ],
  },
  options: {
    animation: false,
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: {
        type: 'time',
        time: { unit: 'minute', displayFormats: { minute: 'h:mm a' } },
        ticks: { color: '#666', maxTicksLimit: 8 },
        grid:  { color: '#222' },
      },
      y: {
        min: 50,
        ticks: { color: '#666', callback: (v) => v + '°' },
        grid:  { color: '#222' },
      },
    },
    plugins: {
      legend: { labels: { color: '#888', boxWidth: 12 } },
      tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y}°F` } },
    },
  },
});

function fmt(val) {
  return val != null ? Math.round(val) : '--';
}

function applyState(state) {
  const on = state.connected && state.power;
  actualEl.textContent = on ? fmt(state.actual) : '--';
  targetEl.textContent = on ? fmt(state.target) : '--';
  probeAEl.textContent = on ? fmt(state.probeA) : '--';
  probeBEl.textContent = on ? fmt(state.probeB) : '--';

  if (on && state.errors?.length) {
    errorBar.textContent = 'Grill error: ' + state.errors.join(', ');
    errorBar.classList.remove('hidden');
  } else {
    errorBar.classList.add('hidden');
  }
}

function pushHistory(points) {
  const [grillDs, targetDs, probeADs, probeBDs] = chart.data.datasets;
  for (const p of points) {
    const t = p.time;
    if (p.actual != null) grillDs.data.push({ x: t, y: p.actual });
    if (p.target != null) targetDs.data.push({ x: t, y: p.target });
    if (p.probeA != null) probeADs.data.push({ x: t, y: p.probeA });
    if (p.probeB != null) probeBDs.data.push({ x: t, y: p.probeB });
  }
  chart.update('none');
}

function pushProbeHistory(points) {
  const [,,,,w1Ds, w2Ds] = chart.data.datasets;
  for (const p of points) {
    if (p.probe1 != null) w1Ds.data.push({ x: p.time, y: p.probe1 });
    if (p.probe2 != null) w2Ds.data.push({ x: p.time, y: p.probe2 });
  }
  chart.update('none');
}

function applyProbes(state) {
  const on = lastState.connected && lastState.power;

  wp1Temp.textContent = on ? fmt(state.probe1.temp) : '--';
  wp2Temp.textContent = on ? fmt(state.probe2.temp) : '--';

  wp1Status.textContent = on && state.probe1.charging ? 'charging' : '';
  wp1Status.className   = 'probe-status' + (on && state.probe1.charging ? ' charging' : '');
  wp2Status.textContent = on && state.probe2.charging ? 'charging' : '';
  wp2Status.className   = 'probe-status' + (on && state.probe2.charging ? ' charging' : '');

  wp1Battery.textContent = state.probe1.battery != null ? `Battery ${state.probe1.battery}%` : '';
  wp2Battery.textContent = state.probe2.battery != null ? `Battery ${state.probe2.battery}%` : '';
}

function setStatus(state) {
  if (!state.connected) {
    statusBadge.className = 'badge disconnected';
    statusBadge.textContent = 'Disconnected';
  } else if (state.power) {
    statusBadge.className = 'badge on';
    statusBadge.textContent = 'On';
  } else {
    statusBadge.className = 'badge standby';
    statusBadge.textContent = 'Standby';
  }
}

function setConnected(connected) {
  if (!connected) {
    statusBadge.className = 'badge disconnected';
    statusBadge.textContent = 'Disconnected';
  }
}

function setMonitoring(active) {
  monitoring = active;
  monitorBtn.className = 'btn ' + (active ? 'monitor-on' : 'monitor-off');
  monitorBtn.textContent = active ? 'Pause' : 'Resume';
}

// WebSocket
const proto = location.protocol === 'https:' ? 'wss' : 'ws';
const base  = location.pathname.replace(/\/$/, '');
const ws    = new WebSocket(`${proto}://${location.host}${base}`);

ws.addEventListener('message', (evt) => {
  const msg = JSON.parse(evt.data);
  switch (msg.type) {
    case 'init':
      lastState = msg.state;
      setStatus(msg.state);
      applyState(msg.state);
      if (msg.probes) applyProbes(msg.probes);
      pushHistory(msg.history);
      if (msg.probeHistory) pushProbeHistory(msg.probeHistory);
      setMonitoring(msg.monitoring ?? true);
      break;
    case 'update':
      lastState = msg.state;
      setStatus(msg.state);
      applyState(msg.state);
      if (msg.state.connected && msg.state.power) {
        pushHistory([{ time: Date.now(), ...msg.state }]);
      }
      break;
    case 'connected':
      setStatus({ ...lastState, connected: true });
      break;
    case 'disconnected':
      setConnected(false);
      break;
    case 'probes':
      applyProbes(msg.state);
      if (lastState.connected && lastState.power) {
        pushProbeHistory([{ time: Date.now(), probe1: msg.state.probe1.temp, probe2: msg.state.probe2.temp }]);
      }
      break;
    case 'monitoring':
      setMonitoring(msg.monitoring);
      break;
    case 'error':
      statusBadge.className = 'badge error';
      statusBadge.textContent = 'Error';
      break;
  }
});

ws.addEventListener('close', () => setConnected(false));

monitorBtn.addEventListener('click', () => {
  fetch('/api/monitoring', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: !monitoring }),
  });
});

