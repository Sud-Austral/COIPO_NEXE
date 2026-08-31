# Guía 6 — Qué va en el GitHub Action de cada repo de app

Guía enfocada, solo en esto: qué archivo crear en el repo de **cada app** para que el push a `main` la despliegue, y qué NO tocar.

---

## El archivo

**Ruta**: `.github/workflows/deploy-prod.yml`, en la raíz del repo de la app (`coipo_prensa2`, `coipo_redes`, la que sea) — no en `infra-docker-base` ni en `app-template`.

**Contenido — idéntico en todas las apps, letra por letra**:

```yaml
name: Deploy prod

on:
  push:
    branches: [main]

jobs:
  deploy:
    uses: Sud-Austral/infra-docker-base/.github/workflows/deploy.yml@main
    with:
      app_name: ${{ github.event.repository.name }}
```

Eso es todo. Seis líneas, no hay nada más que agregar acá.

---

## Qué hace cada línea

| Línea | Qué hace |
|---|---|
| `on: push: branches: [main]` | Dispara el workflow en cada push a `main` (no a otras ramas ni por pull request). |
| `uses: Sud-Austral/infra-docker-base/.github/workflows/deploy.yml@main` | No define los pasos del deploy acá — los importa del workflow **reusable** que vive en el repo `infra-docker-base` (Guía 2 §5). Ese es el que hace el trabajo real: sincronizar el código al servidor, `docker compose build/up`, el smoke test. `@main` significa "la versión de ese workflow que esté en la rama `main` de `infra-docker-base` en este momento" — si se corrige algo ahí, todas las apps lo heredan automático en su próximo push, sin tocar este archivo. |
| `app_name: ${{ github.event.repository.name }}` | El único dato que este archivo le pasa al workflow reusable: el nombre del repo, leído automáticamente del evento de GitHub — nunca escrito a mano. Con eso, el workflow reusable arma la ruta `/opt/apps/<ese nombre>/` en el servidor. |

---

## Por qué es igual en las 10 (o 20) apps

Porque toda la lógica de "cómo desplegar" vive en un solo lugar (`infra-docker-base`), no repetida en cada repo. Este archivo es solo el "gancho" que conecta el repo de la app con esa lógica compartida — por diseño, **nunca se edita por app**: si sientes que necesitas cambiarlo para que una app en particular haga algo distinto, es señal de que el cambio va en el workflow reusable (con alguna condición por `app_name` si hace falta), no acá.

`app_name` se deriva solo porque el nombre del repo, la carpeta del servidor, el rol de BD y `APP_NAME` son, por convención, la misma cadena (Guía 1 §1) — de ahí que baste con leer el nombre del repo para que todo lo demás encaje.

---

## Requisito para que esto funcione (una sola vez, no por app)

`infra-docker-base` debe tener habilitado el acceso desde el resto de la organización — si no, el `uses:` de arriba falla con un error de permisos:

```bash
gh api --method PUT repos/Sud-Austral/infra-docker-base/actions/permissions/access -f access_level=organization
```

(O manual: repo `infra-docker-base` → Settings → Actions → General → Access → "Accessible from repositories in the organization". Guía 2 §5, Guía 3 B1.)

---

## Crearlo en una app nueva

```bash
cd tu-repo-clonado
mkdir -p .github/workflows
cat > .github/workflows/deploy-prod.yml <<'EOF'
name: Deploy prod

on:
  push:
    branches: [main]

jobs:
  deploy:
    uses: Sud-Austral/infra-docker-base/.github/workflows/deploy.yml@main
    with:
      app_name: ${{ github.event.repository.name }}
EOF
git add -A && git commit -m "agregar workflow de deploy" && git push origin main
```

Ese mismo push, si el `.env`/BD del servidor ya están listos (Guía 1 §4, Guía 3 C3-C4), ya despliega la app.

---

## Verificar que ya existe (sin clonar el repo)

```bash
gh api repos/Sud-Austral/<nombre-repo>/contents/.github/workflows/deploy-prod.yml 2>&1 | head -3
```

`404 Not Found` → falta crearlo (paso de arriba). Cualquier otra respuesta con contenido en base64 → ya existe.

---

## Errores típicos

| Síntoma | Causa |
|---|---|
| El job nunca aparece en la pestaña Actions tras el push | El archivo no está en `.github/workflows/` en la raíz, o tiene un error de sintaxis YAML (indentación) | 
| `Error: workflow was not accessible` o similar de permisos | Falta habilitar el acceso de organización en `infra-docker-base` (ver arriba) |
| El job corre pero busca `/opt/apps/<nombre-raro>/` | El repo tiene un nombre distinto al que esperabas (revisa mayúsculas — Guía 4, sección de nombres) |
| Quiero que esta app despliegue distinto a las demás | Señal de alarma: este archivo no es el lugar — el cambio va en `infra-docker-base/.github/workflows/deploy.yml` (Guía 2 §5), con lógica condicional si hace falta |
