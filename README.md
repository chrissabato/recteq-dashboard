# recteq Dashboard

A self-hosted web dashboard for monitoring recteq pellet smokers in real time. Connects directly to the grill on your local network using the Tuya local protocol — no cloud dependency.

![Dashboard showing grill temp, target, probe temps, and a temperature history chart](https://github.com/chrissabato/recteq-dashboard/raw/main/screenshot.png)

## Features

- Live grill temp, target temp, and wired probe temps (A/B)
- Optional wireless probe support (recteq Wireless Probe Set)
- Temperature history chart — up to 6 hours
- Status badge: On / Standby / Disconnected
- Pause and resume monitoring from the browser
- Dark theme, responsive layout — designed for 1080p

## Requirements

- Node.js 18 or later
- recteq grill on your local network
- Tuya Device ID and Local Key (see below)

## Getting Your Device Credentials

recteq grills use the Tuya platform underneath. To get the credentials needed to talk to your grill locally:

1. Create a free account at [iot.tuya.com](https://iot.tuya.com)
2. Create a Cloud project (select "Smart Home" as the industry)
3. Under your project, go to **Devices → Link Tuya App Account** and scan the QR code with the recteq app (or Tuya Smart app)
4. Your grill will appear in the device list — copy the **Device ID** and **Local Key**
5. Find the grill's IP address from your router's DHCP table. Set a static lease so it doesn't change.

> **Protocol version:** Most current recteq grills (Flagship series) use protocol `3.4`. Older models (RT-700 Bull, etc.) may use `3.1` or `3.3`. If you get connection errors, try the other versions.

If you have the **recteq Wireless Probe Set**, repeat the process to get its Device ID and Local Key — it registers as a separate device.

## Installation

```bash
git clone https://github.com/chrissabato/recteq-dashboard.git
cd recteq-dashboard
npm install
```

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

```env
GRILL_DEVICE_ID=your_grill_device_id
GRILL_LOCAL_KEY=your_grill_local_key
GRILL_IP=192.168.1.xxx
GRILL_PROTOCOL=3.4

# Optional: wireless probe hub
PROBE_DEVICE_ID=your_probe_device_id
PROBE_LOCAL_KEY=your_probe_local_key
PROBE_IP=192.168.1.yyy
PROBE_PROTOCOL=3.4

PORT=8080
```

If you don't have a wireless probe set, leave the `PROBE_*` fields blank or remove them.

## Running

```bash
npm start
```

Open `http://<your-server-ip>:8080` in a browser.

For development with auto-restart on file changes:

```bash
npm run dev
```

## Apache Reverse Proxy (optional)

To serve the dashboard at `/recteq` instead of a port, enable the required Apache modules and add this to your virtual host config:

```bash
sudo a2enmod proxy proxy_http proxy_wstunnel rewrite
```

```apache
RedirectMatch ^/recteq$ /recteq/
<Location /recteq/>
    ProxyPass        http://localhost:8080/
    ProxyPassReverse http://localhost:8080/
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteRule ^/recteq/(.*) ws://localhost:8080/$1 [P,L]
</Location>
```

Then reload Apache:

```bash
sudo systemctl reload apache2
```

The dashboard will be available at `http://<your-server-ip>/recteq`.

## Running as a Service

To keep the dashboard running in the background and restart it automatically, create a systemd service:

```ini
# /etc/systemd/system/recteq.service
[Unit]
Description=recteq Dashboard
After=network.target

[Service]
WorkingDirectory=/path/to/recteq-dashboard
ExecStart=/usr/bin/node server.js
Restart=on-failure
EnvironmentFile=/path/to/recteq-dashboard/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now recteq
```

## How It Works

The server connects to your grill over TCP port 6668 using the [tuyapi](https://github.com/codetheweb/tuyapi) library. It polls for state every 10 seconds and pushes updates to the browser via WebSocket. If the connection drops (e.g. the grill loses power), it reconnects automatically every 15 seconds.

The grill's Wi-Fi module stays active even when the grill is off but still plugged in. The dashboard reflects this with a **Standby** status rather than Disconnected — temperatures clear but the connection stays open.

Temperature history is kept in memory (up to 360 points, roughly 6 hours at one point per minute) and replayed to any new browser tab that connects.
