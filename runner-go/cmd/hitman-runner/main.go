// Command hitman-runner is the Hitman local execution agent.
//
// Phase 3 ships the build/version/configuration foundation. Enrollment, the
// outbound WSS control channel, job claiming, and HTTP execution arrive in
// Phases 11-14.
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/hitman-api-hub/hitman/runner-go/internal/config"
	"github.com/hitman-api-hub/hitman/runner-go/internal/logging"
	"github.com/hitman-api-hub/hitman/runner-go/internal/version"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "hitman-runner: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	command := "help"
	if len(args) > 0 {
		command = args[0]
	}

	switch command {
	case "version", "--version", "-v":
		payload, err := json.MarshalIndent(version.Get(), "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(payload))
		return nil
	case "doctor":
		return runDoctor()
	case "run":
		return fmt.Errorf("runner protocol is not implemented until Phase 11")
	case "help", "--help", "-h":
		printHelp()
		return nil
	default:
		return fmt.Errorf("unknown command %q (run 'hitman-runner help')", command)
	}
}

func runDoctor() error {
	cfg, err := config.Load(os.Environ())
	if err != nil {
		fmt.Fprintf(os.Stderr, "configuration: %v\n", err)
		return err
	}
	stateDir, err := config.EnsureStateDir(cfg.StateDir)
	if err != nil {
		return err
	}
	logger := logging.New(cfg.LogLevel)
	logger.Info("runner diagnostics",
		"version", version.Get().Version,
		"commit", version.Get().Commit,
		"platform", version.Get().Platform,
		"architecture", version.Get().Architecture,
		"serverUrl", cfg.ServerURL,
		"stateDir", stateDir,
	)
	fmt.Println("Configuration is valid. No inbound listener is opened by this command.")
	return nil
}

func printHelp() {
	fmt.Print(`hitman-runner — Hitman local execution agent

Usage:
  hitman-runner version    Print build metadata
  hitman-runner doctor     Validate local configuration and state directory
  hitman-runner run        Start the background runner (Phase 11+)

Environment:
  HITMAN_SERVER_URL        Hitman HTTPS base URL (https/wss only)
  HITMAN_DEVICE_NAME       Human-readable device name
  HITMAN_STATE_DIR         Per-user state directory (default .hitman-runner)
  HITMAN_LOG_LEVEL         debug|info|warn|error (default info)

The runner never exposes an inbound listener and never executes shell commands.
`)
}
