// Package version carries build metadata injected with -ldflags.
package version

import "runtime"

var (
	// Version is the semantic runner version.
	Version = "0.1.0-dev"
	// Commit is the git commit the binary was built from.
	Commit = "unknown"
	// BuildTime is an RFC3339 timestamp set by the build pipeline.
	BuildTime = "unknown"
)

// Info is the public version payload printed by `hitman-runner version`.
type Info struct {
	Name         string `json:"name"`
	Version      string `json:"version"`
	Commit       string `json:"commit"`
	BuildTime    string `json:"buildTime"`
	GoVersion    string `json:"goVersion"`
	Platform     string `json:"platform"`
	Architecture string `json:"architecture"`
}

// Get returns the compiled build metadata.
func Get() Info {
	return Info{
		Name:         "hitman-runner",
		Version:      Version,
		Commit:       Commit,
		BuildTime:    BuildTime,
		GoVersion:    runtime.Version(),
		Platform:     runtime.GOOS,
		Architecture: runtime.GOARCH,
	}
}
