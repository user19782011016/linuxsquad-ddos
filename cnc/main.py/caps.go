package main

// botCaps returns the capability string reported to the CNC in the REGISTER message.
// "A" = attack module compiled in, "S" = SOCKS module compiled in.
// hasAttacks and hasSocks are defined in attacks.go / attacks_stub.go
// and socks.go / socks_stub.go respectively via build tags.
func botCaps() string {
	caps := ""
	if hasAttacks {
		caps += "A"
	}
	if hasSocks {
		caps += "S"
	}
	return caps
}
