// Spike C: verify WSL2 loopback HTTP reachability and outbound WSS
// connectivity/reconnect behavior from the WSL2 network namespace.
//
// It intentionally does not test Windows-host localhost forwarding, VPN
// transitions, sleep/resume, or proxy behavior. Those require the Windows
// validation procedure in README.md.
package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"time"

	"github.com/coder/websocket"
)

type check struct {
	Name       string `json:"name"`
	Status     string `json:"status"`
	Detail     string `json:"detail"`
	DurationMs int64  `json:"durationMs"`
}

type report struct {
	GeneratedAt string  `json:"generatedAt"`
	Platform    string  `json:"platform"`
	Kernel      string  `json:"kernel,omitempty"`
	Checks      []check `json:"checks"`
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	report := report{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Platform:    "linux-wsl2",
	}
	report.Checks = append(report.Checks, checkLoopbackHTTP(ctx)...)
	report.Checks = append(report.Checks, checkOutboundWSS(ctx)...)

	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(report); err != nil {
		fmt.Fprintf(os.Stderr, "encode report: %v\n", err)
		os.Exit(1)
	}
}

func checkLoopbackHTTP(ctx context.Context) []check {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	defer server.Close()

	parsed, err := url.Parse(server.URL)
	if err != nil {
		return []check{{Name: "http.self-check", Status: "error", Detail: err.Error()}}
	}
	port := parsed.Port()
	client := &http.Client{Timeout: 5 * time.Second}

	checks := make([]check, 0, 4)
	for _, target := range []string{
		"http://127.0.0.1:" + port + "/health",
		"http://localhost:" + port + "/health",
	} {
		started := time.Now()
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
		if err != nil {
			checks = append(checks, check{Name: "http." + target, Status: "error", Detail: err.Error()})
			continue
		}
		response, err := client.Do(request)
		elapsed := time.Since(started).Milliseconds()
		if err != nil {
			checks = append(checks, check{
				Name:       "http." + target,
				Status:     "error",
				Detail:     err.Error(),
				DurationMs: elapsed,
			})
			continue
		}
		_, _ = io.Copy(io.Discard, response.Body)
		_ = response.Body.Close()
		status := "ok"
		if response.StatusCode != http.StatusOK {
			status = "error"
		}
		checks = append(checks, check{
			Name:       "http." + target,
			Status:     status,
			Detail:     fmt.Sprintf("HTTP %d", response.StatusCode),
			DurationMs: elapsed,
		})
	}
	return checks
}

func checkOutboundWSS(ctx context.Context) []check {
	cert, err := selfSignedCertificate()
	if err != nil {
		return []check{{Name: "wss.certificate", Status: "error", Detail: err.Error()}}
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return []check{{Name: "wss.listen", Status: "error", Detail: err.Error()}}
	}
	tlsListener := tls.NewListener(listener, &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS13,
	})

	mux := http.NewServeMux()
	mux.HandleFunc("/runner", func(w http.ResponseWriter, r *http.Request) {
		connection, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer connection.Close(websocket.StatusNormalClosure, "done")
		for {
			messageType, payload, err := connection.Read(r.Context())
			if err != nil {
				return
			}
			if err := connection.Write(r.Context(), messageType, payload); err != nil {
				return
			}
		}
	})

	server := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		_ = server.Serve(tlsListener)
	}()
	defer server.Close()

	pool := x509.NewCertPool()
	pool.AddCert(cert.Leaf)
	httpClient := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				RootCAs:    pool,
				ServerName: "localhost",
				MinVersion: tls.VersionTLS13,
			},
			ForceAttemptHTTP2: false,
		},
		Timeout: 10 * time.Second,
	}

	port := listener.Addr().(*net.TCPAddr).Port
	target := fmt.Sprintf("wss://127.0.0.1:%d/runner", port)

	checks := make([]check, 0, 4)
	checks = append(checks, wssRoundTrip(ctx, httpClient, target, "wss.hello", "runner.hello"))
	checks = append(checks, wssRoundTrip(ctx, httpClient, target, "wss.heartbeat", "runner.heartbeat"))

	// Prove a clean reconnection after the client closes its first socket.
	first, _, err := websocket.Dial(ctx, target, &websocket.DialOptions{HTTPClient: httpClient})
	if err != nil {
		checks = append(checks, check{Name: "wss.reconnect.first", Status: "error", Detail: err.Error()})
		return checks
	}
	_ = first.Close(websocket.StatusNormalClosure, "simulate client close")
	time.Sleep(150 * time.Millisecond)
	started := time.Now()
	second, _, err := websocket.Dial(ctx, target, &websocket.DialOptions{HTTPClient: httpClient})
	elapsed := time.Since(started).Milliseconds()
	if err != nil {
		checks = append(checks, check{
			Name:       "wss.reconnect",
			Status:     "error",
			Detail:     err.Error(),
			DurationMs: elapsed,
		})
	} else {
		_ = second.Close(websocket.StatusNormalClosure, "done")
		checks = append(checks, check{
			Name:       "wss.reconnect",
			Status:     "ok",
			Detail:     "reconnected after clean close",
			DurationMs: elapsed,
		})
	}

	return checks
}

func wssRoundTrip(
	ctx context.Context,
	client *http.Client,
	target string,
	name string,
	message string,
) check {
	started := time.Now()
	connection, _, err := websocket.Dial(ctx, target, &websocket.DialOptions{HTTPClient: client})
	if err != nil {
		return check{Name: name, Status: "error", Detail: err.Error(), DurationMs: time.Since(started).Milliseconds()}
	}
	defer connection.Close(websocket.StatusNormalClosure, "done")
	connection.SetReadLimit(32 * 1024)

	if err := connection.Write(ctx, websocket.MessageText, []byte(message)); err != nil {
		return check{Name: name, Status: "error", Detail: err.Error(), DurationMs: time.Since(started).Milliseconds()}
	}
	_, payload, err := connection.Read(ctx)
	if err != nil {
		return check{Name: name, Status: "error", Detail: err.Error(), DurationMs: time.Since(started).Milliseconds()}
	}
	if string(payload) != message {
		return check{Name: name, Status: "error", Detail: "echo mismatch", DurationMs: time.Since(started).Milliseconds()}
	}
	return check{
		Name:       name,
		Status:     "ok",
		Detail:     "WSS echo round trip",
		DurationMs: time.Since(started).Milliseconds(),
	}
}

func selfSignedCertificate() (tls.Certificate, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return tls.Certificate{}, err
	}
	template := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: "hitman-spike-local"},
		NotBefore:    time.Now().Add(-time.Minute),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:     []string{"localhost"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return tls.Certificate{}, err
	}
	leaf, err := x509.ParseCertificate(der)
	if err != nil {
		return tls.Certificate{}, err
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return tls.Certificate{}, err
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	certificate, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return tls.Certificate{}, err
	}
	certificate.Leaf = leaf
	return certificate, nil
}
