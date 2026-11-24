#!/bin/bash
# סקריפט ההפעלה של שרת הגשר ב-Google Cloud (e2-micro, Debian 12).
#
# רץ בכל הדלקה של השרת, ולכן כל שלב בו בטוח להרצה חוזרת. הקוד והסודות לא
# יושבים בתוך הסקריפט אלא ב-metadata של המכונה, תחת המפתחות:
#   bridge-js        — תוכן whatsapp-bridge/bridge.mjs
#   bridge-package   — תוכן whatsapp-bridge/package.json
#   bridge-secret    — הסוד המשותף עם ה-CRM (WHATSAPP_BRIDGE_SECRET בוורסל)
#   crm-webhook-url  — https://<crm>/api/webhooks/whatsapp
#
# עדכון קוד = מחליפים את bridge-js ב-metadata ומפעילים מחדש את המכונה (Reset).
# החיבור לוואטסאפ נשמר ב-/opt/bridge/auth ושורד הפעלות מחדש.
#
# HTTPS: Caddy מנפיק תעודה אוטומטית לשם <ip-עם-מקפים>.sslip.io — שם שמצביע
# על ה-IP בלי שום הגדרת DNS. ורסל מדברת עם הגשר רק דרכו.
set -euo pipefail
exec > >(tee -a /var/log/bridge-startup.log) 2>&1
echo "=== $(date -Is) startup ==="

MD=http://metadata.google.internal/computeMetadata/v1/instance
get() { curl -sf -H 'Metadata-Flavor: Google' "$MD/$1"; }

# 1GB זיכרון בלבד — swap מונע קריסה בזמן npm install.
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v node >/dev/null || ! node -v | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

id bridge >/dev/null 2>&1 || useradd -r -m -d /opt/bridge -s /usr/sbin/nologin bridge
mkdir -p /opt/bridge/app /opt/bridge/auth
get attributes/bridge-js > /opt/bridge/app/bridge.mjs
get attributes/bridge-package > /opt/bridge/app/package.json
(cd /opt/bridge/app && npm install --omit=dev --no-audit --no-fund)
chown -R bridge:bridge /opt/bridge

umask 077
cat > /etc/bridge.env <<EOF
BRIDGE_SECRET=$(get attributes/bridge-secret)
CRM_WEBHOOK_URL=$(get attributes/crm-webhook-url)
PORT=3100
AUTH_DIR=/opt/bridge/auth
EOF
umask 022

cat > /etc/systemd/system/whatsapp-bridge.service <<'EOF'
[Unit]
Description=WhatsApp bridge for the CRM
After=network-online.target
Wants=network-online.target

[Service]
User=bridge
WorkingDirectory=/opt/bridge/app
EnvironmentFile=/etc/bridge.env
ExecStart=/usr/bin/node bridge.mjs
Restart=always
RestartSec=5
MemoryMax=600M

[Install]
WantedBy=multi-user.target
EOF

IP=$(get network-interfaces/0/access-configs/0/external-ip)
HOST="${IP//./-}.sslip.io"
cat > /etc/caddy/Caddyfile <<EOF
$HOST {
  reverse_proxy 127.0.0.1:3100
}
EOF
echo "bridge host: https://$HOST"

systemctl daemon-reload
systemctl enable whatsapp-bridge caddy
systemctl restart whatsapp-bridge caddy
echo "=== done ==="
