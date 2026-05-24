//go:build !withattacks

package main

import "net"

// hasAttacks tells the bot (and CNC via REGISTER) that attack modules are absent.
const hasAttacks = false

// dispatchAttack is a no-op stub — attack code is not compiled in this build.
func dispatchAttack(_ net.Conn, _ string, _ []string) error { return nil }

// dispatchAttackStop is a no-op stub — nothing to stop.
func dispatchAttackStop() {}
