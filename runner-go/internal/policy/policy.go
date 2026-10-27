// Package policy implements the runner-side destination guard. The hosted
// application validates targets too; the runner repeats checks immediately
// before connecting because URLs and DNS answers can change.
package policy

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
)

// Policy describes the destinations a runner may reach.
type Policy struct {
	AllowedSchemes  []string
	AllowedHosts    []string
	AllowedPorts    []int
	AllowLoopback   bool
	AllowPrivateLAN bool
	AllowLinkLocal  bool
}

// DefaultLocalPolicy permits only loopback HTTP(S) targets on any port. This
// is the least-privilege default for a developer machine runner.
func DefaultLocalPolicy() Policy {
	return Policy{
		AllowedSchemes: []string{"http", "https"},
		AllowLoopback:  true,
	}
}

var blockedHostnames = map[string]struct{}{
	"metadata.google.internal": {},
	"metadata":                 {},
	"instance-data":            {},
	"169.254.169.254":          {},
	"fd00:ec2::254":            {},
}

// ValidateURL checks scheme, credentials, hostname allowlists, and ports.
func ValidateURL(raw string, policy Policy) (*url.URL, error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid URL: %w", err)
	}
	if parsed.User != nil {
		return nil, errors.New("URL credentials are not allowed")
	}
	if parsed.Hostname() == "" {
		return nil, errors.New("URL must include a host")
	}
	if !schemeAllowed(parsed.Scheme, policy.AllowedSchemes) {
		return nil, fmt.Errorf("scheme %q is not allowed", parsed.Scheme)
	}
	if err := checkPort(parsed, policy); err != nil {
		return nil, err
	}
	if err := checkHostname(parsed.Hostname(), policy.AllowedHosts); err != nil {
		return nil, err
	}
	if ip := net.ParseIP(strings.Trim(parsed.Hostname(), "[]")); ip != nil {
		if err := checkIP(ip, policy); err != nil {
			return nil, err
		}
	}
	if _, blocked := blockedHostnames[strings.ToLower(parsed.Hostname())]; blocked {
		return nil, errors.New("metadata service destinations are blocked")
	}
	return parsed, nil
}

// ValidateResolvedDestination resolves the hostname and rejects any answer
// that falls outside the policy. Call this immediately before dialing; callers
// should pin the validated IP to avoid DNS rebinding between check and use.
func ValidateResolvedDestination(host string, policy Policy) error {
	if ip := net.ParseIP(host); ip != nil {
		return checkIP(ip, policy)
	}
	addresses, err := net.LookupIP(host)
	if err != nil {
		return fmt.Errorf("resolve destination: %w", err)
	}
	if len(addresses) == 0 {
		return errors.New("destination resolved to no addresses")
	}
	for _, address := range addresses {
		if err := checkIP(address, policy); err != nil {
			return err
		}
	}
	return nil
}

func schemeAllowed(scheme string, allowed []string) bool {
	if len(allowed) == 0 {
		return scheme == "http" || scheme == "https"
	}
	for _, candidate := range allowed {
		if strings.EqualFold(candidate, scheme) {
			return true
		}
	}
	return false
}

func checkPort(parsed *url.URL, policy Policy) error {
	portText := parsed.Port()
	if portText == "" {
		switch parsed.Scheme {
		case "http":
			return nil
		case "https":
			return nil
		default:
			return errors.New("URL must include an explicit port")
		}
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 1 || port > 65535 {
		return errors.New("URL port is invalid")
	}
	if len(policy.AllowedPorts) == 0 {
		return nil
	}
	for _, allowed := range policy.AllowedPorts {
		if allowed == port {
			return nil
		}
	}
	return fmt.Errorf("port %d is not allowed", port)
}

func checkHostname(host string, allowed []string) error {
	if len(allowed) == 0 {
		return nil
	}
	normalized := strings.ToLower(strings.TrimSuffix(host, "."))
	for _, candidate := range allowed {
		if strings.EqualFold(strings.TrimSuffix(candidate, "."), normalized) {
			return nil
		}
	}
	return fmt.Errorf("host %q is not in the allowlist", host)
}

func checkIP(ip net.IP, policy Policy) error {
	if ip.IsUnspecified() || ip.IsMulticast() {
		return fmt.Errorf("destination %s is not a unicast address", ip)
	}
	if ip.IsLoopback() {
		if policy.AllowLoopback {
			return nil
		}
		return fmt.Errorf("loopback destination %s is not allowed", ip)
	}
	if ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		if policy.AllowLinkLocal {
			return nil
		}
		return fmt.Errorf("link-local destination %s is not allowed", ip)
	}
	if ip.IsPrivate() {
		if policy.AllowPrivateLAN {
			return nil
		}
		return fmt.Errorf("private destination %s is not allowed", ip)
	}
	return nil
}
