require('dotenv').config({ path: '.env.cloud' });
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const mqtt = require('mqtt');
const path = require('path');

const PORT = process.env.PORT || 3001;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'view.html')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let grillState   = { connected: false, power: null, actual: null, target: null, probeA: null, probeB: null, errors: [] };
let probesState  = { connected: false, probe1: { temp: null, battery: null, charging: false }, probe2: { temp: null, battery: null, charging: false } };
let history      = [];
let probeHistory = [];
let monitoring   = true;

const mqttClient = mqtt.connect(`mqtt://${process.env.MQTT_HOST || 'localhost'}`, {
  port: parseInt(process.env.MQTT_PORT || '1883'),
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS,
});

mqttClient.on('connect', () => {
  console.log('[mqtt] connected');
  mqttClient.subscribe('recteq/#');
});

mqttClient.on('error', (err) => console.error('[mqtt error]', err.message));

mqttClient.on('message', (topic, payload) => {
  try {
    const data = JSON.parse(payload.toString());
    switch (topic) {
      case 'recteq/grill':
        grillState = data;
        broadcast({ type: 'update', state: grillState });
        break;
      case 'recteq/probes':
        probesState = data;
        broadcast({ type: 'probes', state: probesState });
        break;
      case 'recteq/history':
        history      = data.history      || [];
        probeHistory = data.probeHistory || [];
        break;
      case 'recteq/monitoring':
        monitoring = data.monitoring;
        broadcast({ type: 'monitoring', monitoring });
        break;
    }
  } catch (e) {
    console.error('[mqtt parse error]', e.message);
  }
});

function broadcast(msg) {
  const payload = JSON.stringify(msg);
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({
    type: 'init',
    state: grillState,
    probes: probesState,
    history,
    probeHistory,
    monitoring,
  }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`recteq cloud dashboard → http://localhost:${PORT}`);
});
