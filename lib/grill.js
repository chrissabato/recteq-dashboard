const TuyAPI = require('tuyapi');
const { EventEmitter } = require('events');

const DPS = {
  POWER:   '1',
  TARGET:  '101',
  ACTUAL:  '102',
  PROBE_A: '103',
  PROBE_B: '104',
  ERROR:   '109',
};

class Grill extends EventEmitter {
  constructor({ deviceId, localKey, ip, protocol = '3.3' }) {
    super();
    this._ip = ip;
    this._reconnectTimer = null;
    this._connecting = false;

    this._device = new TuyAPI({
      id: deviceId,
      key: localKey,
      ip,
      version: parseFloat(protocol),
    });

    this.state = {
      connected: false,
      power: null,
      actual: null,
      target: null,
      probeA: null,
      probeB: null,
      errors: [],
    };

    this._pollTimer = null;

    this._device.on('connected', () => {
      this._connecting = false;
      this.state.connected = true;
      this.emit('connected');
      this._startPolling();
    });

    this._device.on('disconnected', () => {
      this.state.connected = false;
      this._stopPolling();
      this.emit('disconnected');
      this._scheduleReconnect();
    });

    this._device.on('error', (err) => {
      this._connecting = false;
      this.state.connected = false;
      this._stopPolling();
      this.emit('error', err);
      this._scheduleReconnect();
    });

    this._device.on('data', (data) => {
      if (!data?.dps) return;
      this._applyDps(data.dps);
      this.emit('update', this.state);
    });
  }

  _startPolling(intervalMs = 10000) {
    this._stopPolling();
    let failures = 0;
    this._pollTimer = setInterval(async () => {
      try {
        await this._device.get({ schema: true });
        failures = 0;
      } catch (_) {
        if (++failures >= 2) {
          this._stopPolling();
          this.state.connected = false;
          this.emit('disconnected');
          this._scheduleReconnect();
        }
      }
    }, intervalMs);
  }

  _stopPolling() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
  }

  _applyDps(dps) {
    if (DPS.POWER   in dps) this.state.power  = dps[DPS.POWER];
    if (DPS.TARGET  in dps) this.state.target = dps[DPS.TARGET];
    if (DPS.ACTUAL  in dps) this.state.actual = dps[DPS.ACTUAL];
    if (DPS.PROBE_A in dps) this.state.probeA = dps[DPS.PROBE_A];
    if (DPS.PROBE_B in dps) this.state.probeB = dps[DPS.PROBE_B];
    if (DPS.ERROR   in dps) this.state.errors = dps[DPS.ERROR] ? ['E1'] : [];
  }

  async connect() {
    if (this._connecting || this.state.connected) return;
    this._connecting = true;
    try {
      await this._device.connect();
    } catch (err) {
      this._connecting = false;
      this.emit('error', err);
      this._scheduleReconnect();
    }
  }

  async setPower(on) {
    return this._device.set({ dps: DPS.POWER, set: Boolean(on) });
  }

  // temp in °F, clamped to safe range
  async setTarget(temp) {
    const t = Math.max(180, Math.min(500, Math.round(temp)));
    return this._device.set({ dps: DPS.TARGET, set: t });
  }

  async pause() {
    this._paused = true;
    this._stopPolling();
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    try { await this._device.disconnect(); } catch (_) {}
    this.state.connected = false;
    this.emit('disconnected');
  }

  async resume() {
    this._paused = false;
    await this.connect();
  }

  _scheduleReconnect(delayMs = 15000) {
    if (this._reconnectTimer || this._paused) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  async disconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    await this._device.disconnect();
  }
}

const PROBE_DPS = {
  TEMP_1:     '101',
  TEMP_2:     '102',
  BATTERY_1:  '105',
  BATTERY_2:  '106',
  CHARGING_1: '107',
  CHARGING_2: '108',
};

class ProbeHub extends EventEmitter {
  constructor({ deviceId, localKey, ip, protocol = '3.4' }) {
    super();
    this._reconnectTimer = null;
    this._connecting = false;

    this._device = new TuyAPI({
      id: deviceId,
      key: localKey,
      ip,
      version: parseFloat(protocol),
    });

    this.state = {
      connected: false,
      probe1: { temp: null, battery: null, charging: false },
      probe2: { temp: null, battery: null, charging: false },
    };

    this._pollTimer = null;

    this._device.on('connected', () => {
      this._connecting = false;
      this.state.connected = true;
      this.emit('connected');
      this._startPolling();
    });

    this._device.on('disconnected', () => {
      this.state.connected = false;
      this._stopPolling();
      this.emit('disconnected');
      this._scheduleReconnect();
    });

    this._device.on('error', (err) => {
      this._connecting = false;
      this.state.connected = false;
      this._stopPolling();
      this.emit('error', err);
      this._scheduleReconnect();
    });

    this._device.on('data', (data) => {
      if (!data?.dps) return;
      const d = data.dps;
      if (PROBE_DPS.TEMP_1     in d) this.state.probe1.temp     = d[PROBE_DPS.TEMP_1];
      if (PROBE_DPS.TEMP_2     in d) this.state.probe2.temp     = d[PROBE_DPS.TEMP_2];
      if (PROBE_DPS.BATTERY_1  in d) this.state.probe1.battery  = d[PROBE_DPS.BATTERY_1];
      if (PROBE_DPS.BATTERY_2  in d) this.state.probe2.battery  = d[PROBE_DPS.BATTERY_2];
      if (PROBE_DPS.CHARGING_1 in d) this.state.probe1.charging = d[PROBE_DPS.CHARGING_1];
      if (PROBE_DPS.CHARGING_2 in d) this.state.probe2.charging = d[PROBE_DPS.CHARGING_2];
      this.emit('update', this.state);
    });
  }

  async connect() {
    if (this._connecting || this.state.connected) return;
    this._connecting = true;
    try {
      await this._device.connect();
    } catch (err) {
      this._connecting = false;
      this.emit('error', err);
      this._scheduleReconnect();
    }
  }

  _startPolling(intervalMs = 10000) {
    this._stopPolling();
    let failures = 0;
    this._pollTimer = setInterval(async () => {
      try {
        await this._device.get({ schema: true });
        failures = 0;
      } catch (_) {
        if (++failures >= 2) {
          this._stopPolling();
          this.state.connected = false;
          this.emit('disconnected');
          this._scheduleReconnect();
        }
      }
    }, intervalMs);
  }

  _stopPolling() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
  }

  _scheduleReconnect(delayMs = 15000) {
    if (this._reconnectTimer || this._paused) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  async pause() {
    this._paused = true;
    this._stopPolling();
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    try { await this._device.disconnect(); } catch (_) {}
    this.state.connected = false;
    this.emit('disconnected');
  }

  async resume() {
    this._paused = false;
    await this.connect();
  }

  async disconnect() {
    this._stopPolling();
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    await this._device.disconnect();
  }
}

module.exports = { Grill, ProbeHub };
