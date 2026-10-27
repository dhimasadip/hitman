# TLS material for local staging validation only

The compose proxy expects:

- `tls.crt`
- `tls.key`

Generate a short-lived self-signed pair for local staging validation:

```bash
cd infra/deployment/tls
openssl req -x509 -newkey rsa:2048 -nodes -days 7 \
  -keyout tls.key -out tls.crt \
  -subj "/CN=hitman-staging.local" \
  -addext "subjectAltName=DNS:hitman-staging.local,DNS:localhost,IP:127.0.0.1"
chmod 600 tls.key
```

Do **not** commit certificates or keys. Production/staging must use certificates
issued by the organization's PKI or ingress controller. The `.gitignore` excludes
`*.pem`, `*.key`, and this directory is deployment-local.
