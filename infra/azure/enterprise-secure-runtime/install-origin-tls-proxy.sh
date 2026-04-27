#!/usr/bin/env bash
set -euo pipefail

ORIGIN_TLS_HOSTNAME="${ORIGIN_TLS_HOSTNAME:-origin.enterprise.vaultproof.dev}"
ENTERPRISE_HOSTNAME="${ENTERPRISE_HOSTNAME:-enterprise.vaultproof.dev}"
CONTROL_PLANE_UPSTREAM="${CONTROL_PLANE_UPSTREAM:-http://127.0.0.1:3001}"
TLS_CERT_PATH="${TLS_CERT_PATH:-/etc/vaultproof/tls/origin.crt}"
TLS_KEY_PATH="${TLS_KEY_PATH:-/etc/vaultproof/tls/origin.key}"
GENERATE_SELF_SIGNED="${GENERATE_SELF_SIGNED:-false}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash install-origin-tls-proxy.sh" >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates nginx openssl

mkdir -p /etc/vaultproof/tls
chmod 0750 /etc/vaultproof/tls

if [[ "${GENERATE_SELF_SIGNED}" == "true" && (! -f "${TLS_CERT_PATH}" || ! -f "${TLS_KEY_PATH}") ]]; then
  echo "Generating a temporary self-signed origin certificate for ${ORIGIN_TLS_HOSTNAME}." >&2
  echo "Do not enable Front Door certificate subject validation with this temporary certificate." >&2
  openssl req -x509 -newkey rsa:3072 -sha256 -days 30 -nodes \
    -keyout "${TLS_KEY_PATH}" \
    -out "${TLS_CERT_PATH}" \
    -subj "/CN=${ORIGIN_TLS_HOSTNAME}" \
    -addext "subjectAltName=DNS:${ORIGIN_TLS_HOSTNAME}"
fi

if [[ ! -f "${TLS_CERT_PATH}" || ! -f "${TLS_KEY_PATH}" ]]; then
  cat >&2 <<EOF
Missing TLS certificate material:
  ${TLS_CERT_PATH}
  ${TLS_KEY_PATH}

Install a publicly trusted certificate whose subject/SAN matches the Front Door origin host name.
For production, prefer an origin-only hostname such as origin.enterprise.vaultproof.dev that points to the Confidential VM public IP.
EOF
  exit 2
fi

chown root:root "${TLS_CERT_PATH}" "${TLS_KEY_PATH}"
chmod 0644 "${TLS_CERT_PATH}"
chmod 0600 "${TLS_KEY_PATH}"

cat > /etc/nginx/sites-available/vaultproof-origin-tls.conf <<EOF
server {
  listen 443 ssl http2;
  server_name ${ORIGIN_TLS_HOSTNAME};

  ssl_certificate ${TLS_CERT_PATH};
  ssl_certificate_key ${TLS_KEY_PATH};
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_prefer_server_ciphers off;
  ssl_session_timeout 10m;
  ssl_session_cache shared:vaultproof_origin_tls:10m;

  add_header X-Content-Type-Options nosniff always;
  add_header X-Frame-Options DENY always;
  add_header Referrer-Policy no-referrer always;

  location / {
    proxy_pass ${CONTROL_PLANE_UPSTREAM};
    proxy_http_version 1.1;
    proxy_set_header Host ${ENTERPRISE_HOSTNAME};
    proxy_set_header X-Forwarded-Host ${ENTERPRISE_HOSTNAME};
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header Connection "";
    proxy_read_timeout 30s;
    proxy_send_timeout 30s;
  }
}
EOF

ln -sf /etc/nginx/sites-available/vaultproof-origin-tls.conf /etc/nginx/sites-enabled/vaultproof-origin-tls.conf
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl enable nginx >/dev/null
systemctl restart nginx

ufw allow 443/tcp || true

echo "VaultProof origin TLS proxy is installed."
echo "  hostname: ${ORIGIN_TLS_HOSTNAME}"
echo "  app host: ${ENTERPRISE_HOSTNAME}"
echo "  upstream: ${CONTROL_PLANE_UPSTREAM}"
echo "  cert:     ${TLS_CERT_PATH}"
echo
echo "Local test:"
echo "  curl -sS --resolve ${ORIGIN_TLS_HOSTNAME}:443:127.0.0.1 https://${ORIGIN_TLS_HOSTNAME}/health"
