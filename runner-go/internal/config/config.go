// Package config parses runner configuration without ever echoing secrets.
package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

const (
	DefaultServerURL = "https://hitman.example.invalid"
	DefaultStateDir  = ".hitman-runner"
)

// Config is the local runner process configuration.
type Config struct {
	ServerURL  string
	DeviceName string
	StateDir   string
	LogLevel   string
}

// Load reads configuration from the environment. It validates shape only; it
// never logs or returns credential values.
func Load(environ []string) (Config, error) {
	values := make(map[string]string, len(environ))
	for _, entry := range environ {
		key, value, ok := strings.Cut(entry, "=")
		if !ok {
			continue
		}
		values[key] = value
	}

	cfg := Config{
		ServerURL:  valueOr(values, "HITMAN_SERVER_URL", DefaultServerURL),
		DeviceName: values["HITMAN_DEVICE_NAME"],
		StateDir:   valueOr(values, "HITMAN_STATE_DIR", DefaultStateDir),
		LogLevel:   valueOr(values, "HITMAN_LOG_LEVEL", "info"),
	}

	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// Validate checks URL shape, log level, and state directory safety.
func (c Config) Validate() error {
	if c.ServerURL == "" {
		return errors.New("HITMAN_SERVER_URL is required")
	}
	parsed, err := url.Parse(c.ServerURL)
	if err != nil {
		return fmt.Errorf("HITMAN_SERVER_URL is not a valid URL: %w", err)
	}
	if parsed.Scheme != "https" && parsed.Scheme != "wss" {
		return errors.New("HITMAN_SERVER_URL must use https or wss")
	}
	if parsed.Host == "" {
		return errors.New("HITMAN_SERVER_URL must include a host")
	}
	if parsed.User != nil {
		return errors.New("HITMAN_SERVER_URL must not contain credentials")
	}

	switch c.LogLevel {
	case "debug", "info", "warn", "error":
	default:
		return errors.New("HITMAN_LOG_LEVEL must be one of debug, info, warn, error")
	}

	cleanState := filepath.Clean(c.StateDir)
	if cleanState == "." || cleanState == string(filepath.Separator) {
		return errors.New("HITMAN_STATE_DIR must be a dedicated directory")
	}
	return nil
}

func valueOr(values map[string]string, key, fallback string) string {
	if value := values[key]; value != "" {
		return value
	}
	return fallback
}

// EnsureStateDir creates the per-user runner state directory with restrictive
// permissions. Callers must not place private keys in world-readable paths.
func EnsureStateDir(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("resolve state directory: %w", err)
	}
	if err := os.MkdirAll(absolute, 0o700); err != nil {
		return "", fmt.Errorf("create state directory: %w", err)
	}
	if err := os.Chmod(absolute, 0o700); err != nil {
		return "", fmt.Errorf("secure state directory: %w", err)
	}
	return absolute, nil
}
