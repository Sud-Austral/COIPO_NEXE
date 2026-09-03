# Guía 6 — Qué va en el GitHub Action de cada repo de app

Guía enfocada, solo en esto: qué archivo crear en el repo de **cada app** para que el push la despliegue, y qué NO tocar.

> **Cambios respecto a la versión anterior** (verificados contra el servidor el 2026-08-20):
> ahora existe un segundo entorno, **UAT en vm3**, con su propio workflow reusable — la
> versión anterior de esta guía solo documentaba producción. Y los `--exclude` del `rsync`
> pasaron a estar **anclados a la raíz**, lo que cambia qué archivos de tu repo llegan al
> servidor (ver §"Qué se sincroniza y qué no").

---

## Los archivos

Son dos, uno por entorno. Ambos van en la raíz del repo de la app
(`coipo_prensa2`, `coipo_redes`, la que sea) — no en `infra-docker-base` ni en `app-template`.

### Producción — `.github/workflows/deploy-prod.yml`

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

### UAT — `.github/workflows/deploy-uat.yml`

```yaml
name: Deploy UAT

on:
  push:
    branches: [uat]

jobs:
  deploy:
    uses: Sud-Austral/infra-docker-base/.github/workflows/deploy-uat.yml@main
    with:
      app_name: ${{ github.event.repository.name }}
```

Eso es todo. No hay nada más que agregar en ninguno de los dos.

**UAT no es obligatorio**: hoy solo dos apps lo usan (`coipo_usuarios` y
`coipo_seguimiento_madera`, las únicas presentes en vm3). Si tu app no tiene rama `uat`
ni `.env` bootstrapeado en vm3, no crees el archivo — fallaría en el paso de verificación.

---

## Qué hace cada línea

| Línea | Qué hace |
|---|---|
| `on: push: branches: [main]` | Dispara el workflow en cada push a esa rama (no a otras ni por pull request). En UAT, la rama es `uat`. |
| `uses: Sud-Austral/infra-docker-base/.github/workflows/deploy.yml@main` | No define los pasos del deploy acá — los importa del workflow **reusable** que vive en `infra-docker-base`. Ese es el que hace el trabajo real: sincronizar el código al servidor, `docker compose build/up`, el smoke test. `@main` significa "la versión que esté en la rama `main` de `infra-docker-base` en este momento": si se corrige algo ahí, todas las apps lo heredan en su próximo push, sin tocar este archivo. |
| `app_name: ${{ github.event.repository.name }}` | El único dato que este archivo le pasa: el nombre del repo, leído del evento de GitHub, nunca escrito a mano. Con eso el workflow arma `/opt/apps/<ese nombre>/` en el servidor. |

**Consecuencia de `@main` que conviene tener presente:** un cambio en el workflow reusable
no se aplica de golpe a toda la flota — se aplica app por app, en el siguiente despliegue
de cada una. Durante días la flota queda en estado mixto, y revertir tampoco es
instantáneo: solo surte efecto en los despliegues posteriores al revert.

---

## Dónde despliega cada uno

| Workflow | Rama | Runner | VM | Directorio | Grupo de concurrencia |
|---|---|---|---|---|---|
| `deploy.yml` | `main` | `self-hosted`, `conaf-prod` | vm2 · 172.31.2.41 | `/opt/apps/<app>/` | `deploy-<app>` |
| `deploy-uat.yml` | `uat` | `self-hosted`, `conaf-uat` | vm3 · 172.31.2.42 | `/opt/apps/<app>/` | `deploy-uat-<app>` |

Los dos workflows son **gemelos deliberados**: los pasos son idénticos salvo el runner y
el grupo de concurrencia. Cada entorno necesita su propio bootstrap (`.env` en su VM):
desplegar a la rama `uat` con el `.env` creado solo en vm2 falla, y con razón.

Los grupos de concurrencia son distintos a propósito: un despliegue de UAT no bloquea uno
de producción de la misma app. Y ninguno cancela al anterior — se encolan, para no dejar
`/opt/apps/<app>/` a medio sincronizar.

---

## Qué se sincroniza y qué no

El despliegue hace un `rsync -a --delete` del repo al servidor con tres exclusiones
**ancladas a la raíz**:

```
--exclude='/.git'   --exclude='/.env'   --exclude='/data/'
```

Lo que hay que saber al escribir la app:

- **`--delete` hace del servidor un espejo del repo.** Lo que borres en git desaparece del
  servidor. El directorio de destino no admite ediciones manuales que sobrevivan.
- **Solo el `data/` y el `.env` de la raíz están protegidos.** Ahí va el estado persistente
  y ahí deben apuntar los bind-mounts.
- **Un `data/` anidado sí se sincroniza.** `frontend/src/data/`, `backend/app/data/` y
  similares viajan al servidor como cualquier otro directorio. Hasta agosto de 2026 no era
  así, y eso causó un incidente: el patrón iba sin anclar, casaba a cualquier profundidad, y
  como `--delete` tampoco borra lo excluido, un catálogo versionado bajo `frontend/src/data/`
  se quedó **congelado** meses en el servidor mientras el resto del repo se actualizaba.
- **Un `.env` anidado y versionado ahora llega al servidor.** Si commiteas `web/.env`,
  aterriza en `/opt/apps/<app>/web/.env`. Antes no llegaba. Revísalo antes del primer push.
- **Lo que commitees dentro del `data/` de la raíz nunca llega al servidor**: está excluido
  en los dos sentidos, ni se transfiere ni se borra.

---

## Por qué es igual en todas las apps

Porque toda la lógica de "cómo desplegar" vive en un solo lugar (`infra-docker-base`), no
repetida en cada repo. Este archivo es solo el gancho que conecta el repo con esa lógica
compartida — por diseño, **nunca se edita por app**: si sientes que necesitas cambiarlo para
que una app haga algo distinto, es señal de que el cambio va en el workflow reusable (con
alguna condición por `app_name` si hace falta), no acá.

`app_name` se deriva solo porque el nombre del repo, la carpeta del servidor, el rol de BD y
`APP_NAME` son, por convención, la misma cadena — de ahí que baste con leer el nombre del
repo para que lo demás encaje. (Excepción real y aceptada: `coipo_usuarios` usa el rol de BD
`iam`. La carpeta del servidor SIEMPRE es el nombre del repo, nunca el del rol.)

---

## Requisito para que esto funcione (una sola vez, no por app)

`infra-docker-base` debe tener habilitado el acceso desde el resto de la organización — si
no, el `uses:` falla con un error de permisos:

```bash
gh api --method PUT repos/Sud-Austral/infra-docker-base/actions/permissions/access -f access_level=organization
```

(O manual: repo `infra-docker-base` → Settings → Actions → General → Access →
"Accessible from repositories in the organization".)

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
git add .github/workflows/deploy-prod.yml
git commit -m "agregar workflow de deploy"
git push origin main
```

Ese mismo push, si el `.env` y la BD del servidor ya están listos, ya despliega la app.

Antes de hacerlo, pasa el checklist de la Guía 8: varios de sus puntos son exactamente lo
que ya rompió un despliegue real.

---

## Verificar que ya existe (sin clonar el repo)

```bash
gh api repos/Sud-Austral/<nombre-repo>/contents/.github/workflows/deploy-prod.yml 2>&1 | head -3
```

`404 Not Found` → falta crearlo. Cualquier otra respuesta con contenido en base64 → ya existe.

---

## Errores típicos

| Síntoma | Causa |
|---|---|
| El job nunca aparece en la pestaña Actions tras el push | El archivo no está en `.github/workflows/` en la raíz, o tiene un error de indentación YAML |
| `Error: workflow was not accessible` o similar de permisos | Falta habilitar el acceso de organización en `infra-docker-base` (ver arriba) |
| El job queda en cola indefinidamente | No hay runner con **ambas** etiquetas (`self-hosted` + `conaf-prod`, o `conaf-uat`). Comprobar en Settings → Actions → Runners que esté *Idle* y no *Offline* |
| `ERROR: falta /opt/apps/<app>/.env` | No se hizo el bootstrap en **esa** VM. Cada entorno necesita el suyo: bootstrap en vm2 no sirve para un push a `uat` |
| El job corre pero busca `/opt/apps/<nombre-raro>/` | El repo tiene otro nombre del que esperabas (revisa mayúsculas) |
| El deploy sale verde pero un archivo del repo no cambia en el servidor | Ver `docs/RUNBOOK.md` de `infra-docker-base`, paso 3, síntoma "un archivo del repo no se actualiza nunca" |
| Quiero que esta app despliegue distinto a las demás | Señal de alarma: este archivo no es el lugar — el cambio va en `infra-docker-base`, con lógica condicional si hace falta |
