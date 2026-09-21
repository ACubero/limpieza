#!/usr/bin/env bash
#
# limpieza-deploy.sh — Deploy Limpieza PWA (frontend + backend) to alexcuar.eu VPS
#
# Usage:
#   limpieza-deploy.sh [--frontend-only | --backend-only | --full | --status | --restart-backend | --verify | --help]
#
# Requirements:
#   - Repo cloned at ~/repos/limpieza
#   - Backend live at /home/hermes/limpieza-api (NOT the repo — this is the live one)
#   - systemd service: limpieza-api.service
#   - Data dir: /var/lib/limpieza/
#
# What this script does:
#   --frontend-only : rsync frontend/* to /var/www/alexcuar.eu/public/apps/limpieza/
#                     and chown www-data. NO restart needed (PWA reloads itself).
#   --backend-only  : rsync api/* to /home/hermes/limpieza-api/, then systemctl restart.
#   --full          : backend + frontend.
#   --status        : show what's deployed where + service status.
#   --verify        : hit the live endpoints and report HTTP codes.
#   --restart-backend : just restart the systemd service.
#
# Notes:
#   - The /home/hermes/limpieza-api/ directory is the LIVE backend. It is NOT
#     a git working tree (it's a deploy target). The repo is ~/repos/limpieza/.
#     Sync direction: repo → live. Never edit live files directly.
#   - Frontend files are static. No build step. Just rsync.
#   - Service Worker cache busting: if you changed JS/CSS, bumpear VERSION in
#     frontend/sw.js BEFORE running this. The script checks for the marker
#     and warns if VERSION matches the live copy.
#
set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
REPO_DIR="$HOME/repos/limpieza"
REPO_API="$REPO_DIR/api"
REPO_FRONTEND="$REPO_DIR/frontend"

LIVE_API="/home/hermes/limpieza-api"
LIVE_FRONTEND="/var/www/alexcuar.eu/public/apps/limpieza"

SERVICE_NAME="limpieza-api"
DATA_DIR="/var/lib/limpieza"
LOG_FILE="/var/log/limpieza/api.log"
NGINX_SITE="/etc/nginx/sites-available/alexcuar.eu"
PUBLIC_URL="https://alexcuar.eu/apps/limpieza/"
API_HEALTH="https://alexcuar.eu/api/limpieza/health"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[deploy]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC}  $*"; }
err()  { echo -e "${RED}[error]${NC} $*"; }
info() { echo -e "${BLUE}[info]${NC}  $*"; }

# ── Helpers ─────────────────────────────────────────────────────────────────
check_repo() {
    if [[ ! -d "$REPO_DIR/.git" ]]; then
        err "Repo not found at $REPO_DIR"
        err "Clone it: git clone https://ACubero@github.com/ACubero/limpieza.git ~/repos/limpieza"
        exit 1
    fi
    if [[ ! -d "$REPO_API" || ! -d "$REPO_FRONTEND" ]]; then
        err "Repo is missing api/ or frontend/ subdirs"
        err "Expected layout: $REPO_DIR/{api,frontend}/"
        exit 1
    fi
}

check_live() {
    if [[ ! -d "$LIVE_API" ]]; then
        err "Live backend not found at $LIVE_API"
        exit 1
    fi
    if [[ ! -d "$LIVE_FRONTEND" ]]; then
        err "Live frontend not found at $LIVE_FRONTEND"
        exit 1
    fi
}

# Check if VERSION in repo sw.js differs from live sw.js. If they match and
# you changed any JS/CSS, the browser will keep using stale SW-cached files.
warn_if_version_unchanged() {
    local repo_v live_v
    repo_v=$(grep -oP "VERSION\s*=\s*'v[0-9.]+'" "$REPO_FRONTEND/sw.js" 2>/dev/null | head -1 || echo "MISSING")
    live_v=$(grep -oP "VERSION\s*=\s*'v[0-9.]+'" "$LIVE_FRONTEND/sw.js" 2>/dev/null | head -1 || echo "MISSING")
    if [[ "$repo_v" == "MISSING" ]]; then
        warn "Could not find VERSION in $REPO_FRONTEND/sw.js"
    elif [[ "$repo_v" == "$live_v" ]]; then
        warn "SW VERSION unchanged ($repo_v) — browser will serve stale cache!"
        warn "If you changed any JS/CSS, edit frontend/sw.js and bump VERSION first."
        if [[ "${SKIP_SW_VERSION_CHECK:-0}" != "1" ]]; then
            read -rp "$(echo -e "${YELLOW}Continue anyway? [y/N]${NC} ") " ans
            [[ "$ans" =~ ^[Yy]$ ]] || exit 1
        fi
    else
        info "SW VERSION: $live_v → $repo_v (good — browser will refresh cache)"
    fi
}

# ── Frontend deploy ─────────────────────────────────────────────────────────
deploy_frontend() {
    check_repo
    check_live
    warn_if_version_unchanged

    log "Deploying frontend → $LIVE_FRONTEND"

    # Backup current live frontend (one-shot backup, not timestamped)
    if [[ -d "$LIVE_FRONTEND.bak" ]]; then
        sudo -n rm -rf "$LIVE_FRONTEND.bak"
    fi
    sudo -n cp -r "$LIVE_FRONTEND" "$LIVE_FRONTEND.bak"

    # Clean any old .bak / .v1bak leftovers in live (they shouldn't be there
    # but if they snuck in via earlier rsyncs, kill them before fresh sync)
    sudo -n find "$LIVE_FRONTEND" -maxdepth 2 -name '*.bak' -delete 2>/dev/null || true
    sudo -n find "$LIVE_FRONTEND" -maxdepth 2 -name '*.v1bak' -delete 2>/dev/null || true

    # Rsync with delete so removed files in repo also disappear in live
    sudo -n rsync -a --delete \
        --exclude='.htaccess' \
        "$REPO_FRONTEND/" "$LIVE_FRONTEND/"

    sudo -n chown -R www-data:www-data "$LIVE_FRONTEND"

    log "Frontend deployed ✓"
    log "URL: $PUBLIC_URL"
}

# ── Backend deploy ──────────────────────────────────────────────────────────
deploy_backend() {
    check_repo
    check_live

    log "Deploying backend → $LIVE_API"

    # Backup current live backend (one-shot)
    if [[ -d "$LIVE_API.bak" ]]; then
        sudo -n rm -rf "$LIVE_API.bak"
    fi
    sudo -n cp -r "$LIVE_API" "$LIVE_API.bak"

    # Clean live of stale .bak / __pycache__
    sudo -n find "$LIVE_API" -maxdepth 2 -name '*.bak' -delete 2>/dev/null || true
    sudo -n find "$LIVE_API" -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true

    # Sync python files + schema, preserve permissions
    sudo -n rsync -a \
        --include='*.py' --include='*.sql' --include='*/' --exclude='*' \
        "$REPO_API/" "$LIVE_API/"

    # The live backend may have files not in repo (venv markers, .env, etc.)
    # — that's OK, we only ADD what we have. We don't blow away unknowns.

    sudo -n chown -R hermes:hermes "$LIVE_API"

    # Restart service
    log "Restarting $SERVICE_NAME..."
    sudo -n systemctl restart "$SERVICE_NAME"

    # Wait for it to come up (max 10s)
    local i
    for i in 1 2 3 4 5 6 7 8 9 10; do
        if systemctl is-active --quiet "$SERVICE_NAME"; then
            break
        fi
        sleep 1
    done

    if systemctl is-active --quiet "$SERVICE_NAME"; then
        log "Backend running ✓"
    else
        err "Backend failed to start!"
        err "Check logs: tail -50 $LOG_FILE"
        sudo -n systemctl status "$SERVICE_NAME" --no-pager | head -20
        exit 1
    fi
}

# ── Status ──────────────────────────────────────────────────────────────────
show_status() {
    echo "=== Limpieza Deploy Status ==="
    echo ""

    # Backend service
    echo "Backend service ($SERVICE_NAME):"
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
        echo "  Status:   active"
        echo "  PID:      $(systemctl show -p MainPID --value $SERVICE_NAME 2>/dev/null)"
        echo "  Memory:   $(systemctl show -p MemoryCurrent --value $SERVICE_NAME 2>/dev/null | numfmt --to=iec 2>/dev/null || echo '?')"
    else
        echo "  Status:   INACTIVE"
    fi
    echo ""

    # Frontend live
    echo "Frontend live: $LIVE_FRONTEND"
    if [[ -f "$LIVE_FRONTEND/sw.js" ]]; then
        local v
        v=$(grep -oP "VERSION\s*=\s*'v[0-9.]+'" "$LIVE_FRONTEND/sw.js" | head -1)
        echo "  SW VERSION: $v"
    fi
    echo ""

    # Repo
    echo "Repo: $REPO_DIR"
    if [[ -d "$REPO_DIR/.git" ]]; then
        cd "$REPO_DIR"
        local branch
        branch=$(git branch --show-current 2>/dev/null || echo "?")
        local last
        last=$(git log -1 --format='%h %s' 2>/dev/null || echo "no commits")
        echo "  Branch:  $branch"
        echo "  Last:    $last"

        # Check if repo has uncommitted changes
        if ! git diff --quiet 2>/dev/null; then
            echo "  Status:  UNCOMMITTED CHANGES (git diff)"
        elif [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
            echo "  Status:  UNTRACKED FILES (git status)"
        else
            echo "  Status:  clean"
        fi
    fi
    echo ""

    # Data dir + DB
    echo "Data dir: $DATA_DIR"
    if [[ -d "$DATA_DIR" ]]; then
        echo "  Size: $(du -sh "$DATA_DIR" 2>/dev/null | cut -f1)"
        if [[ -f "$DATA_DIR/limpieza.db" ]]; then
            echo "  DB:   $(ls -lh "$DATA_DIR/limpieza.db" | awk '{print $5}')"
        fi
    else
        echo "  MISSING"
    fi
    echo ""

    # Last few log lines
    if [[ -f "$LOG_FILE" ]]; then
        echo "Recent logs (last 5 lines):"
        tail -5 "$LOG_FILE" 2>/dev/null | sed 's/^/  /'
    fi
}

# ── Verify ──────────────────────────────────────────────────────────────────
verify_production() {
    log "Verifying production endpoints..."

    local pass=0 fail=0

    # Frontend
    local fe
    fe=$(curl -s -o /dev/null -w "%{http_code}" "$PUBLIC_URL" 2>/dev/null || echo "000")
    if [[ "$fe" == "200" ]]; then
        log "  Frontend:  HTTP $fe ✓"
        ((pass++)) || true
    else
        err "  Frontend:  HTTP $fe ✗"
        ((fail++)) || true
    fi

    # SW no-cache header
    local sw_cc
    sw_cc=$(curl -s -I "$PUBLIC_URL"sw.js 2>/dev/null | grep -i "cache-control" | head -1 | tr -d '\r')
    if [[ "$sw_cc" == *"no-store"* ]]; then
        log "  SW cache:  $sw_cc ✓"
        ((pass++)) || true
    else
        warn "  SW cache:  missing no-store header (stale SW possible)"
        ((fail++)) || true
    fi

    # API health
    local api
    api=$(curl -s -o /dev/null -w "%{http_code}" "$API_HEALTH" 2>/dev/null || echo "000")
    if [[ "$api" == "200" ]]; then
        log "  API health: HTTP $api ✓"
        ((pass++)) || true
    else
        err "  API health: HTTP $api ✗"
        ((fail++)) || true
    fi

    # API auth (should be 401 without token)
    local api_auth
    api_auth=$(curl -s -o /dev/null -w "%{http_code}" "https://alexcuar.eu/api/limpieza/auth/me" 2>/dev/null || echo "000")
    if [[ "$api_auth" == "401" ]]; then
        log "  API auth:  HTTP $api_auth (no token, as expected) ✓"
        ((pass++)) || true
    else
        warn "  API auth:  HTTP $api_auth (expected 401)"
        ((fail++)) || true
    fi

    log "Result: $pass passed, $fail failed"
}

# ── Full deploy ─────────────────────────────────────────────────────────────
deploy_full() {
    log "=== FULL DEPLOY: Limpieza ==="
    deploy_backend
    deploy_frontend
    verify_production
    log "=== DEPLOY COMPLETE ✓ ==="
}

# ── Main ────────────────────────────────────────────────────────────────────
main() {
    local mode="${1:---full}"

    case "$mode" in
        --frontend-only|-f)
            deploy_frontend
            ;;
        --backend-only|-b)
            deploy_backend
            ;;
        --full)
            deploy_full
            ;;
        --status|-s)
            show_status
            ;;
        --restart-backend|-r)
            sudo -n systemctl restart "$SERVICE_NAME"
            sleep 2
            systemctl is-active --quiet "$SERVICE_NAME" \
                && log "Backend restarted ✓" \
                || err "Backend failed to restart"
            ;;
        --verify|-v)
            verify_production
            ;;
        --help|-h)
            cat <<'EOF'
Limpieza Deploy Script

Usage: limpieza-deploy.sh [OPTION]

Options:
  --full             Deploy backend + frontend (default)
  --frontend-only    Sync frontend/* to /var/www/alexcuar.eu/public/apps/limpieza/
  --backend-only     Sync api/* to /home/hermes/limpieza-api/ + restart service
  --status           Show deployment status, SW VERSION, repo state
  --verify           Verify production endpoints (frontend + API)
  --restart-backend  Just restart the systemd service
  --help             Show this help

Important:
  - Repo is ~/repos/limpieza/. Live backend is /home/hermes/limpieza-api/
    (NOT in git). Sync direction: repo → live. Don't edit live files.
  - If you change JS/CSS, bump VERSION in frontend/sw.js BEFORE running.
    The script warns if VERSION is unchanged and asks to confirm.
  - SKIP_SW_VERSION_CHECK=1 in env skips the VERSION warning.
EOF
            ;;
        *)
            err "Unknown option: $mode"
            echo "Run: limpieza-deploy.sh --help"
            exit 1
            ;;
    esac
}

main "$@"
