#!/bin/bash
set -euo pipefail

echo "=== Custom Journal Server Installer ==="

NODE_VERSION=$(node -v 2>/dev/null | sed 's/v//' | cut -d'.' -f1)
if [ -z "$NODE_VERSION" ] || [ "$NODE_VERSION" -lt 20 ]; then
  echo "ERROR: Node.js 20+ is required. Current: $(node -v 2>/dev/null || echo 'not installed')"
  echo "Install with: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
  exit 1
fi
echo "Node.js $(node -v) detected"

if ! id "journal" &>/dev/null; then
  echo "Creating 'journal' system user..."
  sudo useradd --system --no-create-home --shell /bin/false journal
  echo "User 'journal' created"
else
  echo "User 'journal' already exists"
fi

INSTALL_DIR="/opt/custom-journal"
echo "Installing to ${INSTALL_DIR}..."

sudo mkdir -p "${INSTALL_DIR}"
sudo cp -r . "${INSTALL_DIR}/"
cd "${INSTALL_DIR}"

echo "Installing npm dependencies..."
sudo npm install --omit=dev
sudo npm run build

sudo mkdir -p "${INSTALL_DIR}/data"
sudo mkdir -p "${INSTALL_DIR}/logs"

if [ ! -f "${INSTALL_DIR}/.env" ]; then
  echo "Creating .env from template..."
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sudo cp .env.example .env
  sudo sed -i "s/change-me-to-random-64-char-string/${JWT_SECRET}/" .env
  echo "Generated random JWT_SECRET"
fi

sudo chown -R journal:journal "${INSTALL_DIR}"

echo "Installing systemd service..."
sudo cp scripts/custom-journal.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable custom-journal
sudo systemctl start custom-journal

echo ""
echo "=== Installation Complete ==="
echo "Service status: $(sudo systemctl is-active custom-journal)"
echo "Server URL: http://$(hostname -I | awk '{print $1}'):3377"
echo ""
echo "Useful commands:"
echo "  sudo systemctl status custom-journal"
echo "  sudo systemctl restart custom-journal"
echo "  sudo journalctl -u custom-journal -f"
