//go:build !withsocks

package main

import "net"

// hasSocks tells the bot (and CNC via REGISTER) that the SOCKS module is absent.
const hasSocks = false

// dispatchSocks is a no-op stub — SOCKS code is not compiled in this build.
func dispatchSocks(_ net.Conn, _ string, _ []string) error { return nil }
