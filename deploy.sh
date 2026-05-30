#!/bin/bash
# deploy.sh — Script de deploy para VPS com Nginx
# Uso: bash deploy.sh

set -e

REPO_URL="https://github.com/YutsuKito/Poe2_Planner_build.git"
SITE_DIR="/var/www/poe2-build-planner"
NGINX_CONF="/etc/nginx/sites-available/poe2-build-planner"

echo "=== PoE2 Build Planner — Deploy ==="

# 1. Instalar nginx e git se necessário
echo "[1/5] Verificando dependências..."
apt-get update -qq
apt-get install -y -qq nginx git

# 2. Clonar ou atualizar o repositório
if [ -d "$SITE_DIR/.git" ]; then
    echo "[2/5] Atualizando repositório existente..."
    cd "$SITE_DIR"
    git pull origin master
else
    echo "[2/5] Clonando repositório..."
    git clone "$REPO_URL" "$SITE_DIR"
fi

# 3. Ajustar permissões
echo "[3/5] Ajustando permissões..."
chown -R www-data:www-data "$SITE_DIR"
chmod -R 755 "$SITE_DIR"

# 4. Configurar Nginx
echo "[4/5] Configurando Nginx..."
cp "$SITE_DIR/nginx.conf" "$NGINX_CONF"

# Ativar o site
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/poe2-build-planner

# Remover o default se existir (opcional — comente se quiser manter)
# rm -f /etc/nginx/sites-enabled/default

# Testar configuração
nginx -t

# 5. Recarregar Nginx
echo "[5/5] Recarregando Nginx..."
systemctl reload nginx

echo ""
echo "✅ Deploy concluído!"
echo "   Site disponível em: http://$(curl -s ifconfig.me)"
echo ""
echo "   Para HTTPS com Let's Encrypt:"
echo "   apt install certbot python3-certbot-nginx"
echo "   certbot --nginx -d seu-dominio.com"
