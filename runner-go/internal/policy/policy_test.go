package policy

import (
	"strings"
	"testing"
)

func TestValidateURLAcceptsLoopbackDefault(t *testing.T) {
	policy := DefaultLocalPolicy()
	for _, raw := range []string{
		"http://127.0.0.1:3000/api/v1/bas",
		"http://localhost:8080/health",
		"https://127.0.0.1:8443/secure",
	} {
		if _, err := ValidateURL(raw, policy); err != nil {
			t.Fatalf("expected %q to be allowed, got %v", raw, err)
		}
	}
}

func TestValidateURLRejectsUnsafeShapes(t *testing.T) {
	policy := DefaultLocalPolicy()
	cases := []string{
		"file:///etc/passwd",
		"ftp://127.0.0.1/file",
		"http://user:password@127.0.0.1:3000/",
		"http://169.254.169.254/latest/meta-data",
		"http://metadata.google.internal/computeMetadata/v1/",
		"http://[::]:3000/",
	}
	for _, raw := range cases {
		if _, err := ValidateURL(raw, policy); err == nil {
			t.Fatalf("expected %q to be rejected", raw)
		}
	}
}

func TestValidateURLCustomAllowlist(t *testing.T) {
	policy := Policy{
		AllowedSchemes: []string{"https"},
		AllowedHosts:   []string{"api.internal.example"},
		AllowedPorts:   []int{443},
	}
	if _, err := ValidateURL("https://api.internal.example/v1/status", policy); err != nil {
		t.Fatalf("expected allowlisted target, got %v", err)
	}
	if _, err := ValidateURL("http://api.internal.example/v1/status", policy); err == nil {
		t.Fatal("expected scheme rejection")
	}
	if _, err := ValidateURL("https://api.internal.example:8443/v1/status", policy); err == nil {
		t.Fatal("expected port rejection")
	}
	if _, err := ValidateURL("https://other.internal.example/v1/status", policy); err == nil {
		t.Fatal("expected host rejection")
	}
}

func TestValidateResolvedDestination(t *testing.T) {
	policy := DefaultLocalPolicy()
	if err := ValidateResolvedDestination("127.0.0.1", policy); err != nil {
		t.Fatalf("loopback should be allowed: %v", err)
	}
	if err := ValidateResolvedDestination("10.0.0.5", policy); err == nil {
		t.Fatal("private address should be rejected by default")
	}
	policy.AllowPrivateLAN = true
	if err := ValidateResolvedDestination("10.0.0.5", policy); err != nil {
		t.Fatalf("private address should be allowed when policy permits: %v", err)
	}
}

func TestValidateResolvedDestinationRejectsMetadata(t *testing.T) {
	if err := ValidateResolvedDestination("169.254.169.254", DefaultLocalPolicy()); err == nil {
		t.Fatal("metadata address must be rejected")
	} else if !strings.Contains(err.Error(), "link-local") {
		t.Fatalf("expected link-local rejection, got %v", err)
	}
}
