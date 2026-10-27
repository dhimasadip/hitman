package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadDefaults(t *testing.T) {
	cfg, err := Load(nil)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.ServerURL != DefaultServerURL {
		t.Fatalf("ServerURL = %q", cfg.ServerURL)
	}
	if cfg.LogLevel != "info" {
		t.Fatalf("LogLevel = %q", cfg.LogLevel)
	}
}

func TestLoadRejectsInsecureServerURL(t *testing.T) {
	for _, raw := range []string{
		"HITMAN_SERVER_URL=http://hitman.example.com",
		"HITMAN_SERVER_URL=https://user:pass@hitman.example.com",
		"HITMAN_SERVER_URL=not-a-url",
	} {
		if _, err := Load([]string{raw}); err == nil {
			t.Fatalf("expected %q to fail validation", raw)
		}
	}
}

func TestEnsureStateDir(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "runner-state")
	absolute, err := EnsureStateDir(dir)
	if err != nil {
		t.Fatalf("EnsureStateDir() error = %v", err)
	}
	info, err := os.Stat(absolute)
	if err != nil {
		t.Fatalf("stat state dir: %v", err)
	}
	if info.Mode().Perm() != 0o700 {
		t.Fatalf("state dir permissions = %o", info.Mode().Perm())
	}
}
