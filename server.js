require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const { Grill, ProbeHub } = require('./lib/grill');

const PORT = process.env.PORT || 3000;
const HISTORY_MAX = 360; // 6 hours at ~1 point/min

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const history = [];
const probeHistory = [];

const grill = new Grill({
  deviceId: process.env.GRILL_DEVICE_ID,
  localKey:  process.env.GRILL_LOCAL_KEY,
  ip:        process.env.GRILL_IP,
  protocol:  process.env.GRILL_PROTOCOL || '3.4',
});

const probeHub = new ProbeHub({
  deviceId: process.env.PROBE_DEVICE_ID,
  localKey:  process.env.PROBE_LOCAL_KEY,
  ip:        process.env.PROBE_IP,
  protocol:  process.env.PROBE_PROTOCOL || '3.4',
});

function broadcast(msg) {
  const payload = JSON.stringify(msg);
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

grill.on('update', (state) => {
  if (state.power) {
    history.push({ time: Date.now(), ...state });
    if (history.length > HISTORY_MAX) history.shift();
  }
  broadcast({ type: 'update', state });
});

grill.on('connected',    ()    => broadcast({ type: 'connected' }));
grill.on('disconnected', ()    => broadcast({ type: 'disconnected' }));
grill.on('error',        (err) => console.error('[grill error]', err.message));

probeHub.on('update', (state) => {
  if (grill.state.power) {
    probeHistory.push({ time: Date.now(), probe1: state.probe1.temp, probe2: state.probe2.temp });
    if (probeHistory.length > HISTORY_MAX) probeHistory.shift();
  }
  broadcast({ type: 'probes', state });
});
probeHub.on('error',  (err)   => console.error('[probe error]', err.message));

let monitoring = true;

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({
    type: 'init',
    state: grill.state,
    probes: probeHub.state,
    history,
    probeHistory,
    monitoring,
  }));
});

// --- REST API ---

app.post('/api/power', async (req, res) => {
  try {
    await grill.setPower(req.body.on);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/target', async (req, res) => {
  const temp = parseInt(req.body.temp, 10);
  if (isNaN(temp) || temp < 180 || temp > 500) {
    return res.status(400).json({ error: 'temp must be 180–500°F' });
  }
  try {
    await grill.setTarget(temp);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/state', (_req, res) => res.json({ grill: grill.state, probes: probeHub.state, monitoring }));

app.post('/api/monitoring', async (req, res) => {
  const active = Boolean(req.body.active);
  if (active === monitoring) return res.json({ ok: true, monitoring });
  monitoring = active;
  if (active) {
    await Promise.all([grill.resume(), probeHub.resume()]);
  } else {
    await Promise.all([grill.pause(), probeHub.pause()]);
    // Explicitly broadcast disconnected — tuyapi doesn't always fire the event on manual disconnect
    broadcast({ type: 'disconnected' });
  }
  broadcast({ type: 'monitoring', monitoring });
  res.json({ ok: true, monitoring });
});

// --- Start ---

server.listen(PORT, '0.0.0.0', () => {
  console.log(`recteq dashboard → http://localhost:${PORT}`);
  grill.connect();
  probeHub.connect();
});

process.on('SIGINT', async () => {
  await Promise.all([grill.disconnect(), probeHub.disconnect()]);
  process.exit(0);
});
