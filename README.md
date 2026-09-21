# Limpieza — PWA de gestión de plannings de limpieza con voluntarios

Monorepo con dos componentes:

- **`api/`** — Backend Flask + SQLite + bcrypt. Sirve la API REST bajo `/api/limpieza/*`. Autenticación por tokens (1 año, sliding session).
- **`frontend/`** — PWA vanilla JS (sin build step). Funciona offline con localStorage como caché y sincroniza con el backend cuando hay red.

## Características

- Login con sesión deslizante (1 año, rota automáticamente)
- Gestión de voluntarios con género y disponibilidad por días
- 12 tareas de limpieza predefinidas (editables)
- Planning semanal con auto-asignación de voluntarios a tareas
- Export a WhatsApp / PDF / imagen para enviar al grupo

## Estructura

```
limpieza/
├── api/
│   ├── app.py              # Endpoints Flask
│   ├── db.py               # Helpers SQLite + seed
│   ├── schema.sql          # Schema de la BD
│   └── test_e2e.py         # Tests end-to-end
├── frontend/
│   ├── index.html
│   ├── sw.js               # Service Worker (VERSION bump en cada deploy)
│   ├── manifest.webmanifest
│   ├── css/styles.css
│   ├── js/{app,store,ui,icons,autoassign,export}.js
│   ├── js/views/{plannings,tasks,volunteers,settings}.js
│   └── icons/
└── README.md
```

## Deploy (resumen)

### Backend

```bash
# 1. Instalar deps
pip install flask gunicorn bcrypt

# 2. Crear BD
sudo mkdir -p /var/lib/limpieza
sudo chown hermes:hermes /var/lib/limpieza

# 3. Crear usuario inicial (interactivamente)
python3 -c "
import sys; sys.path.insert(0, 'api')
import bcrypt, db
db.init_db()
pw = input('Password: ').encode()
db.create_user('alex', bcrypt.hashpw(pw, bcrypt.gensalt()).decode(), 'Alex', 'editor')
"

# 4. systemd unit (ejemplo: /etc/systemd/system/limpieza-api.service)
# ExecStart=/path/to/venv/bin/python3 -m gunicorn --bind 127.0.0.1:8765 \
#           --workers 2 --access-logfile - --error-logfile - app:app
```

### Frontend

```bash
# Copiar al path del nginx vhost
sudo cp -r frontend/* /var/www/<domain>/public/apps/limpieza/
sudo chown -R www-data:www-data /var/www/<domain>/public/apps/limpieza/

# IMPORTANTE: bumpear VERSION en sw.js tras cada deploy
# (sino el navegador sirve código viejo del cache del SW)
```

### nginx (fragmento)

```nginx
location /api/limpieza/ {
    proxy_pass http://127.0.0.1:8765/api/limpieza/;
}

# Cache control crítico para el SW
location = /apps/limpieza/sw.js {
    add_header Cache-Control "no-cache, no-store, must-revalidate";
}
```

## Desarrollo local

```bash
# API
cd api && python3 -m gunicorn --bind 127.0.0.1:8765 app:app

# Frontend (cualquier static server)
cd frontend && python3 -m http.server 8080
# Abrir http://localhost:8080 (con API_BASE apuntando al backend)
```

## Licencia

Privado. Uso interno.
