# TOWER BREACH: hosting a dedicated co-op server

A dedicated server runs the game for your squad on a computer that stays on, such as your own PC, a spare laptop or a
cheap VPS. Nobody's game has to host. The server:

- runs the authoritative simulation (enemies, loot, damage, the objective) with no player of its own,
- keeps the run going when a player leaves; they rejoin with the same callsign,
- serves the browser version of the game, so a friend can just open `http://<address>:8787`,
- accepts the **desktop apps on Windows, macOS and Linux and the browser version at the same time** (cross-play).

Everyone must run the **same release** of the game as the server. A mismatch gets a clear "Version mismatch" message.

## Contents

1. [Download and run](#1-download-and-run)
2. [Settings](#2-settings)
3. [Let your friends in: port forwarding](#3-let-your-friends-in-port-forwarding)
4. [Firewall rules](#4-firewall-rules)
5. [What your friends type](#5-what-your-friends-type)
6. [Bandwidth](#6-bandwidth)
7. [Running on a VPS (Linux, systemd)](#7-running-on-a-vps-linux-systemd)
8. [Security](#8-security)
9. [Troubleshooting](#9-troubleshooting)

## 1. Download and run

Download the server for the computer that will run it from the **Releases** page. Each file is a single program
(about 80–100 MB) with the web version of the game built in. Nothing else needs to be installed.

| System | File |
|---|---|
| Windows 10/11 (64-bit) | `towerbreach-server-windows-x64.exe` |
| macOS, Apple Silicon (M1 and later) | `towerbreach-server-macos-arm64` |
| macOS, Intel | `towerbreach-server-macos-x64` |
| Linux x86-64 (Ubuntu, Debian, Fedora and so on) | `towerbreach-server-linux-x64` |

### Windows

Double-click the `.exe`, or run it from PowerShell for flags: `.\towerbreach-server-windows-x64.exe --password hunter2`.

- The file isn't code-signed. If **SmartScreen** says "Windows protected your PC", click **More info**, then **Run
  anyway**.
- The first time, **Windows Defender Firewall** asks whether to allow it on networks. Tick **Private networks** and
  click **Allow access**. See [Firewall rules](#4-firewall-rules) if you missed it.
- Close the console window or press **Ctrl+C** to stop the server.

### macOS

Open **Terminal** in the download folder (Finder: right-click the folder → Services → New Terminal at Folder) and run:

```bash
chmod +x towerbreach-server-macos-arm64            # or -x64 on Intel
xattr -d com.apple.quarantine towerbreach-server-macos-arm64   # Gatekeeper: it was downloaded and isn't notarised
./towerbreach-server-macos-arm64
```

Without the `xattr` step, macOS says the program "cannot be opened because the developer cannot be verified". You can
also allow it under System Settings → Privacy & Security → **Open Anyway**. If the macOS firewall is on, allow
incoming connections when asked.

### Linux

```bash
chmod +x towerbreach-server-linux-x64
./towerbreach-server-linux-x64 --name "Our squad" --password hunter2
```

### What you see

```
[2026-10-04 08:16:55] TOWER BREACH dedicated server "Tower Breach server" · protocol v2
[2026-10-04 08:16:55] difficulty normal · up to 5 players · friendly fire off · password off · holiday auto · ready timeout 90 s
[2026-10-04 08:16:55] listening on TCP port 8787. Players join with:
[2026-10-04 08:16:55]    localhost:8787   (browser: http://localhost:8787)
[2026-10-04 08:16:55]    192.168.1.37:8787   (browser: http://192.168.1.37:8787)
[2026-10-04 08:17:57] + Desk joined from ::ffff:192.168.1.20 (1/5)
[2026-10-04 08:18:10] Run started: Desk, Web · normal · seed 3375103590
[2026-10-04 08:31:02] Squad reached floor 12
```

The `192.168.x.x` line is your **local IP**: anyone on your home network can join with it right away. For friends
over the internet, read on.

**Stopping:** Ctrl+C (or `SIGTERM`, as systemd sends) tells the players and shuts down cleanly. Press it twice to
quit at once.

## 2. Settings

Pass flags on the command line, set environment variables, or put a `towerbreach-server.json` file in the folder you
start the server from. Flags beat environment variables, which beat the file. Run with `--help` for the list.

| Flag | Environment | JSON key | Default | Meaning |
|---|---|---|---|---|
| `-p`, `--port` | `TB_PORT` (or `PORT`) | `port` | `8787` | TCP port for the web page and the game traffic (one port does both) |
| `-d`, `--difficulty` | `TB_DIFFICULTY` | `difficulty` | `normal` | `normal`, `hard` or `insane` |
| `--max-players` | `TB_MAX_PLAYERS` | `maxPlayers` | `5` | 1 to 5 |
| `--friendly-fire` | `TB_FRIENDLY_FIRE=1` | `friendlyFire` | off | Team damage inside the tower |
| `--password` | `TB_PASSWORD` | `password` | none | Players must enter it to join |
| `--name` | `TB_NAME` | `name` | `Tower Breach server` | Shown on the co-op screen and in the armory |
| `--motd` | `TB_MOTD` | `motd` | none | Message of the day, shown in the armory |
| `--holiday` | `TB_HOLIDAY` | `holiday` | `auto` | `auto` (the server's date), `none`, `xmas`, `easter` or `halloween` |
| `--ready-timeout` | `TB_READY_TIMEOUT` | `readyTimeout` | `90` | Seconds after the first player is READY before everyone deploys, ready or not (`0` = wait for everyone) |
| `--web-root` | `TB_WEB_ROOT` | `webRoot` | built in | Serve the web game from this folder instead of the built-in copy |
| `-c`, `--config` | `TB_CONFIG` | | `./towerbreach-server.json` | Config file to read |

Example `towerbreach-server.json`:

```json
{
  "name": "Night shift",
  "motd": "Floor 50 or bust. Voice chat on the usual channel.",
  "difficulty": "hard",
  "password": "hunter2",
  "friendlyFire": true
}
```

**How a session flows:** players who join go straight into the squad armory. When everyone connected has pressed
**Deploy**, the squad starts on the street. If someone is idle, the ready timer deploys them with the starter kit. During
a run, new callsigns can't join, but anyone who dropped out can rejoin with the **same callsign** to get their operator
back. When the run is won or lost, or everyone leaves, the server goes back to the armory with a new tower for the
next run.

## 3. Let your friends in: port forwarding

Your router blocks connections from the internet by default. To let friends in, you **forward** one port to the
computer running the server.

- **Port:** `8787` (or whatever `--port` you chose)
- **Protocol:** **TCP** (UDP isn't used)
- **Forward to:** the server computer's **local IP**

### 1. Find the server's local IP

The server prints it at start-up (the `192.168.x.x` or `10.x.x.x` line). You can also look it up:

| System | How |
|---|---|
| Windows | Settings → Network & Internet → your connection → **IPv4 address**, or run `ipconfig` and read "IPv4 Address" |
| macOS | System Settings → Network → your connection → **IP address**, or run `ipconfig getifaddr en0` (`en1` on some Macs) |
| Linux | `hostname -I` or `ip -4 addr` |

The local IP can change when the computer restarts. In your router, give it a **DHCP reservation** (also called a
"static lease" or "fixed IP") so the forward keeps working.

### 2. Add the forward in your router

Every router is different, but the steps are similar:

1. Open the router's admin page in a browser. It is usually `http://192.168.1.1`, `http://192.168.0.1` or
   `http://10.0.0.1`, or printed on a sticker on the router. Many ISPs have an app instead.
2. Log in. The password is often on the same sticker.
3. Find **Port Forwarding**. It may be under *Advanced*, *NAT*, *Firewall*, *Virtual Server* or *Applications &
   Gaming*.
4. Add a rule: external port **8787**, internal port **8787**, protocol **TCP**, internal IP = the server's local IP.
   Name it "Tower Breach".
5. Save. Some routers need a restart.

Don't use the router's "DMZ" option for this: it exposes every port on the computer.

### 3. Find your public IP

Search the web for "what is my IP", or visit a site such as `https://ifconfig.me`. That address (for example
`203.0.113.7`) is what friends type, followed by the port: `203.0.113.7:8787`.

Test it from **outside** your network, for example with a phone on mobile data opening `http://203.0.113.7:8787`.
Many routers can't loop back to their own public IP, so testing from inside your home may fail even when it works
for everyone else. At home, use the local IP.

### Your public IP changes? Use dynamic DNS

Most home connections get a new public IP from time to time. A free **dynamic DNS** service (for example DuckDNS,
No-IP or your router's built-in DDNS feature) gives you a name like `oursquad.duckdns.org` that always points to your
current IP. Friends then type `oursquad.duckdns.org:8787`.

### CGNAT: when forwarding can't work

Some ISPs (most mobile and satellite connections, and some fibre and cable providers) put many customers behind one
shared public IP. This is called **CGNAT**. Port forwarding can't work behind it. Signs of CGNAT:

- the **WAN / Internet IP** shown in your router is different from what "what is my IP" shows, or
- the router's WAN IP starts with `100.64.` to `100.127.`, `10.`, `172.16.` to `172.31.` or `192.168.`.

What you can do instead:

- Ask your ISP for a public IPv4 address. Some give one for free or a small fee.
- Run the server on a **VPS** (see [section 7](#7-running-on-a-vps-linux-systemd)).
- Use a VPN overlay such as Tailscale or ZeroTier. Everyone installs it and joins with the server's VPN address.

## 4. Firewall rules

The computer running the server must also accept connections on the port.

**Windows (Defender Firewall).** Allow it when prompted on first run. If you clicked Cancel, open Windows Security →
Firewall & network protection → **Allow an app through firewall** → Change settings → Allow another app, and pick the
server exe. Or, in PowerShell **as administrator**:

```powershell
New-NetFirewallRule -DisplayName "Tower Breach server" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow
```

**macOS.** If the firewall is on (System Settings → Network → Firewall), allow incoming connections when macOS asks,
or add the server under Firewall → **Options…**. If the firewall is off, nothing is needed.

**Linux, ufw (Ubuntu, Debian):**

```bash
sudo ufw allow 8787/tcp
```

**Linux, firewalld (Fedora, RHEL, openSUSE):**

```bash
sudo firewall-cmd --permanent --add-port=8787/tcp && sudo firewall-cmd --reload
```

On a VPS, also open the port in the provider's own firewall or security group if it has one.

## 5. What your friends type

- **Desktop app (Windows, macOS, Linux):** Co-op → enter a callsign → **Server address** `203.0.113.7:8787` (or
  `oursquad.duckdns.org:8787`) → the password if there is one → **Join server**. The address is remembered next time.
- **Browser:** open `http://203.0.113.7:8787`. The game loads from the server itself. Co-op → callsign → **Join
  server** (the address is already filled in).

You can type the address with or without `ws://` or `http://`. Without a port, `8787` is used.

## 6. Bandwidth

Measured with this release, as WebSocket payload (add about 10% for TCP/IP overhead):

| | Per player, download | Per player, upload |
|---|---|---|
| Street, 2 players (real desktop + browser clients) | 15–19 KB/s | 11–12 KB/s |
| Street, 5 players | ~36 KB/s | ~13 KB/s |
| Floor 40, 5 players, 8 hostiles | ~60 KB/s | ~13 KB/s |
| Floor 160, 5 players, 25 hostiles | ~80 KB/s | ~13 KB/s |

- **Each player** needs roughly **1 Mbit/s down** and **0.15 Mbit/s up**.
- **The server** sends each player their own stream, so its **upload** adds up: about **3–3.5 Mbit/s for a full squad
  of 5** on busy floors (about 1.5 Mbit/s for 2–3 players). It receives about 0.5 Mbit/s.
- Most home connections are fine. On slow upload links (some ADSL), keep the squad small. A VPS has plenty.
- **Voice chat** (proximity, through the server) adds about **3 KB/s of payload per talking player, for each
  listener within 10 m on the same floor**. That is Opus at 24 kbit/s: 50 frames of about 55–60 bytes a second.
  On the wire, with TCP/IP headers, plan for about 50 kbit/s. Silence costs nothing (push-to-talk, or open mic only
  sends while you speak). Worst case, 5 players all talking in one room: each player downloads about 12 KB/s of voice
  and the server uploads about 60 KB/s (about 1 Mbit/s on the wire) on top of the game traffic.
- CPU and memory use are small: the server runs one simulation at 60 ticks per second. Any machine that can run the
  game can host it.

## 7. Running on a VPS (Linux, systemd)

Any small Linux VPS (1 vCPU, 512 MB–1 GB RAM) with a public IPv4 address works, and it avoids port forwarding and
CGNAT altogether.

```bash
# as root, on the VPS
useradd --system --home /opt/towerbreach --shell /usr/sbin/nologin towerbreach
mkdir -p /opt/towerbreach
cp towerbreach-server-linux-x64 /opt/towerbreach/ && chmod +x /opt/towerbreach/towerbreach-server-linux-x64
cat > /opt/towerbreach/towerbreach-server.json <<'EOF'
{ "name": "Night shift", "password": "change-me", "difficulty": "hard" }
EOF
chown -R towerbreach: /opt/towerbreach && chmod 600 /opt/towerbreach/towerbreach-server.json
```

`/etc/systemd/system/towerbreach.service`:

```ini
[Unit]
Description=TOWER BREACH dedicated co-op server
After=network-online.target
Wants=network-online.target

[Service]
User=towerbreach
WorkingDirectory=/opt/towerbreach
ExecStart=/opt/towerbreach/towerbreach-server-linux-x64
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now towerbreach
journalctl -u towerbreach -f        # the server log: joins, leaves, runs, floors
sudo ufw allow 8787/tcp             # and the provider's firewall, if any
```

To update, stop the service, replace the binary and start it again.

**HTTPS (optional).** Behind a reverse proxy with TLS (Caddy, nginx) that forwards WebSockets on `/ws`, players use
`https://your.domain` in the browser and `wss://your.domain` in the desktop app. All players then share the proxy's
IP for the server's per-address limits.

## 8. Security

The server is built to face the internet. It:

- accepts only small JSON messages (16 KB max) and drops clients that send more than 90 messages a second,
- accepts voice only as small binary frames (401 bytes max) with their own budget. It forwards at most 60 frames a
  second per speaker, only to players on the speaker's floor within 10 m. It disconnects anyone sending over 120 a
  second, oversized frames, or other binary data,
- checks and clamps every client message (inputs, callsigns, loadouts) and disconnects clients that send unknown ones,
- allows at most 32 connections, 8 per IP address, and drops connections that don't join within 10 seconds,
- refuses an IP address for a minute after 5 wrong passwords,
- serves only the files of the web game, read-only.

Still:

- **Set a password** (`--password`) unless you want strangers dropping in. Share it privately.
- **Keep it updated.** Run the latest release and players must match it anyway.
- Don't run it as root or administrator. On a VPS use a service user like the systemd example above.
- Forward only the one TCP port, never DMZ.
- Traffic is plain `ws://`/`http://` unless you put a TLS proxy in front. Don't reuse an important password as
  the server password.

## 9. Troubleshooting

**"Could not reach the server."** Check, in order: the server is running; the address and port are right; from home
use the local IP; the OS firewall allows the port (section 4); the router forward points to the right local IP
(section 3); you are not behind CGNAT.

**"Port 8787 is already in use."** Another program (or a second copy of the server) has the port. Stop it or use
`--port 8790`, and forward that port instead.

**"Version mismatch."** The player's game and the server are different releases. Update both to the same release.

**"Mission in progress: the squad has already entered the tower."** Players can join freely while the squad is in
the armory or still on the street. The log says `Run started: the squad entered the tower` when the first player
goes in, and from then on new callsigns wait for the next run. If you were in it, rejoin with your old callsign.

**Voice chat doesn't work for browser players.** Browsers only allow the microphone on `https://` pages or
`localhost`, so a friend opening `http://<your IP>:8787` can listen but not talk. The desktop app has no such limit.
Voice needs no extra ports: it uses the same WebSocket as the game.

**A friend can join at home but not from outside.** That is port forwarding, the firewall or CGNAT. Try
`http://<public IP>:8787` from a phone on mobile data to see whether the port is reachable.
