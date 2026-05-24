package main

import (
	"encoding/binary"
	"fmt"
	"math/rand"
	"strings"
)

// encodeDNSName encodes a domain name into DNS wire format.
func encodeDNSName(domain string) []byte {
	var buf []byte
	for _, label := range strings.Split(strings.TrimSuffix(domain, "."), ".") {
		if len(label) > 63 {
			label = label[:63]
		}
		buf = append(buf, byte(len(label)))
		buf = append(buf, []byte(label)...)
	}
	buf = append(buf, 0) // root label
	return buf
}

// encodeDNSQuery builds a raw DNS query packet with optional EDNS0 OPT record.
func encodeDNSQuery(domain string, qtype uint16, edns bool) []byte {
	arcount := uint16(0)
	if edns {
		arcount = 1
	}
	hdr := make([]byte, 12)
	binary.BigEndian.PutUint16(hdr[0:2], uint16(rand.Intn(65536)))
	binary.BigEndian.PutUint16(hdr[2:4], 0x0100)
	binary.BigEndian.PutUint16(hdr[4:6], 1)
	binary.BigEndian.PutUint16(hdr[10:12], arcount)
	name := encodeDNSName(domain)
	q := make([]byte, 4)
	binary.BigEndian.PutUint16(q[0:2], qtype)
	binary.BigEndian.PutUint16(q[2:4], 1)
	pkt := append(hdr, name...)
	pkt = append(pkt, q...)
	if edns {
		opt := []byte{
			0x00,
			0x00, 0x29,
			0x10, 0x00,
			0x00,
			0x00,
			0x00, 0x00,
			0x00, 0x00,
		}
		pkt = append(pkt, opt...)
	}
	return pkt
}

// parseDNSTXTResponse extracts TXT record strings from a raw DNS response.
func parseDNSTXTResponse(data []byte) ([]string, error) {
	if len(data) < 12 {
		return nil, fmt.Errorf("response too short")
	}
	ancount := binary.BigEndian.Uint16(data[6:8])
	rcode := data[3] & 0x0F
	if rcode != 0 {
		return nil, fmt.Errorf("DNS rcode %d", rcode)
	}
	off := 12
	qdcount := binary.BigEndian.Uint16(data[4:6])
	for i := 0; i < int(qdcount); i++ {
		off = skipDNSName(data, off)
		off += 4
	}
	var txts []string
	for i := 0; i < int(ancount); i++ {
		if off >= len(data) {
			break
		}
		off = skipDNSName(data, off)
		if off+10 > len(data) {
			break
		}
		rrtype := binary.BigEndian.Uint16(data[off : off+2])
		rdlength := binary.BigEndian.Uint16(data[off+8 : off+10])
		off += 10
		if off+int(rdlength) > len(data) {
			break
		}
		if rrtype == 16 {
			rdEnd := off + int(rdlength)
			for off < rdEnd {
				tlen := int(data[off])
				off++
				if off+tlen > rdEnd {
					break
				}
				txts = append(txts, string(data[off:off+tlen]))
				off += tlen
			}
		} else {
			off += int(rdlength)
		}
	}
	return txts, nil
}

// skipDNSName advances past a DNS name (handling compression pointers).
func skipDNSName(data []byte, off int) int {
	for off < len(data) {
		if data[off] == 0 {
			return off + 1
		}
		if data[off]&0xC0 == 0xC0 {
			return off + 2
		}
		off += int(data[off]) + 1
	}
	return off
}
