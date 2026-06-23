require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const mqtt = require('mqtt');
const path = require('path');
const fs = require('fs');
const { Grill, ProbeHub } = require('./lib/grill');

const PORT = process.env.PORT || 3000;
const HISTORY_MAX = 8640; // 24 hours at 1 point/10s
const HISTORY_FILE = path.join(__dirname, 'history.json');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function loadHistory() {
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    const saved = JSON.parse(raw);
    return { history: saved.history || [], probeHistory: saved.probeHistory || [] };
  } catch (_) {
    return { history: [], probeHistory: [] };
  }
}

let _savePending = false;
function saveHistory() {
  if (_savePending) return;
  _savePending = true;
  setImmediate(() => {
    _savePending = false;
    fs.writeFile(HISTORY_FILE, JSON.stringify({ history, probeHistory }), () => {});
  });
}

const { history: _h, probeHistory: _ph } = loadHistory();
const history = _h;
const probeHistory = _ph;

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
    saveHistory();
    mqttPublish('recteq/history', { history, probeHistory });
  }
  broadcast({ type: 'update', state });
  mqttPublish('recteq/grill', state);
});

grill.on('connected', () => {
  broadcast({ type: 'connected' });
  mqttPublish('recteq/grill', grill.state);
});
grill.on('disconnected', () => {
  broadcast({ type: 'disconnected' });
  mqttPublish('recteq/grill', grill.state);
});
grill.on('error', (err) => console.error('[grill error]', err.message));

probeHub.on('update', (state) => {
  if (grill.state.power) {
    probeHistory.push({ time: Date.now(), probe1: state.probe1.temp, probe2: state.probe2.temp });
    if (probeHistory.length > HISTORY_MAX) probeHistory.shift();
    saveHistory();
    mqttPublish('recteq/history', { history, probeHistory });
  }
  broadcast({ type: 'probes', state });
  mqttPublish('recteq/probes', state);
});
probeHub.on('error', (err) => console.error('[probe error]', err.message));

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

function localOnly(req, res, next) {
  const ip = req.socket.remoteAddress || '';
  const local = ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.');
  if (!local) return res.status(403).json({ error: 'forbidden' });
  next();
}

app.post('/api/power', localOnly, async (req, res) => {
  try {
    await grill.setPower(req.body.on);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/target', localOnly, async (req, res) => {
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

app.delete('/api/history', localOnly, (_req, res) => {
  history.length = 0;
  probeHistory.length = 0;
  saveHistory();
  res.json({ ok: true });
});

app.post('/api/monitoring', localOnly, async (req, res) => {
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
  mqttPublish('recteq/monitoring', { monitoring });
  res.json({ ok: true, monitoring });
});

// --- MQTT publishing (optional) ---

let mqttClient = null;
if (process.env.MQTT_HOST) {
  mqttClient = mqtt.connect(`mqtts://${process.env.MQTT_HOST}`, {
    port: parseInt(process.env.MQTT_PORT || '8884'),
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASS,
  });
  mqttClient.on('connect', () => {
    console.log('[mqtt] connected');
    mqttPublish('recteq/grill', grill.state);
    mqttPublish('recteq/probes', probeHub.state);
    mqttPublish('recteq/history', { history, probeHistory });
    mqttPublish('recteq/monitoring', { monitoring });
  });
  mqttClient.on('error', (err) => console.error('[mqtt error]', err.message));
}

function mqttPublish(topic, payload) {
  if (mqttClient?.connected) {
    mqttClient.publish(topic, JSON.stringify(payload), { retain: true });
  }
}

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
