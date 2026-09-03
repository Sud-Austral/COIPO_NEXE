# 0 — Estado real del servidor y hallazgos

Documento nuevo, no existía en `INSUMO_PRODUCCION`. Todo lo de aquí está
**verificado por SSH contra vm2 y vm3 el 2026-08-20**, no deducido de la
documentación. Donde algo no se pudo comprobar, se dice.

Sirve para dos cosas: como inventario al que apuntan los otros documentos (para
que ninguno repita datos que envejecen), y como lista de lo que está desalineado.

---

## 1. Versiones reales

| | vm2 (`conaf-prod`, 172.31.2.41) | vm3 (`conaf-uat`, 172.31.2.42) |
|---|---|---|
| SO | Ubuntu 24.04.2 LTS | Ubuntu 24.04.2 LTS |
| Docker | **29.6.2** (`dfc4efb`) | **29.7.2** (`a7dcaa6`) |
| Docker Compose | **v5.3.1** | **v5.4.0** |
| Nginx | 1.24.0 (Ubuntu) | 1.24.0 (Ubuntu) |
| Disco `/` | 96 GB, 56 % usado (41 GB libres) | 98 GB, 19 % usado (76 GB libres) |
| Caché de build | **19,31 GB** (15,44 recuperables) | 2,73 GB (2,297 recuperables) |
| Runner de Actions | activo | activo |

PostgreSQL compartido: **17.10** en `172.31.2.40:5432` (resultado real de
`select version()`, no el número que decía la documentación). Ojo: el cliente
`psql` instalado en vm2 es **16.14**, un mayor por detrás del servidor.

---

## 2. Registro de puertos (`APP_PORT`)

`APP_PORT` debe ser único por host: si dos apps coinciden, el smoke test de una
puede dar verde contra el `/health` de la otra. Esta es la asignación real:

| Puerto | vm2 | vm3 |
|---|---|---|
| 8101 | `coipo_prensa2` | — |
| 8103 | `coipo_dendroenergia` | — |
| 8111 | `coipo_usuarios` | `coipo_usuarios` |
| 8112 | `coipo_apptest` | — |
| 8113 | `coipo_entrega_planta` | — |
| 8114 | `coipo_cabania` | — |
| 8115 | `coipo_moodle` | — |
| 8116 | `coipo_archivo` | — |
| 8117 | `coipo_seguimiento_madera` | `coipo_seguimiento_madera` |

Libres y contiguos: 8102, 8104-8110, 8118 en adelante. Antes de asignar uno
nuevo, comprobar en la VM: `sudo ss -tlnp | grep :<puerto>`.

---

## 3. Mapa dominio → puerto → app (vm2)

Comprobado pidiendo cada dominio al propio Nginx con `curl -H "Host: ..."`.

| Dominio | Puerto | App | Respuesta medida |
|---|---|---|---|
| `academia.conaf.cl` | 8115 | `coipo_moodle` | 303 |
| `prensa.conaf.cl` | 8101 | `coipo_prensa2` | 200 |
| `dendroenergia.conaf.cl` | 8103 | `coipo_dendroenergia` | 200 |
| `iam.conaf.cl` | 8111 | `coipo_usuarios` | 200 |
| `usuario.conaf.cl` | 8112 | `coipo_apptest` | 200 |
| `reserva-bienestar.conaf.cl` | 8114 | `coipo_cabania` | 200 |
| `archivo.conaf.cl` | **9001** | MinIO de `coipo_archivo` | 200 |
| `tv.conaf.cl` | 8117 | `coipo_seguimiento_madera` | 200 |
| `programa-arborizacion.conaf.cl` | 8113 | `coipo_entrega_planta` | 200 |
| `entre-planta.conaf.cl` | 8113 | `coipo_entrega_planta` | 200 |
| cualquier otro | — | — | 444 (catch-all `00-default.conf`) |

En vm3 solo hay dos vhosts: `dev-iam.conaf.cl` y `tv-uat.conaf.cl`. Sus bases de
datos son `iam_dev` y `transporte_madera_uat`, en el mismo Postgres compartido.

**Sigue sin haber SSL**: no existe `/etc/nginx/ssl/`, ningún vhost escucha en 443
y ninguno redirige a HTTPS. La nota de "pendiente el certificado `*.conaf.cl`"
del documento original sigue vigente.

---

## 4. Hallazgos

Ordenados por lo que costaría más caro descubrir tarde. Cada uno trae cómo se
comprobó y qué habría que hacer.

### H1 — Nginx descarta un `server_name` duplicado: entrar por IP no lleva a donde crees

`nginx -t` no falla, pero avisa:

```
[warn] conflicting server name "172.31.2.41" on 0.0.0.0:80, ignored
```

`academia.conaf.cl.conf` y `dendroenergia.conaf.cl.conf` declaran **los dos** la
IP `172.31.2.41` en su `server_name`. Nginx se queda con el primero que carga
—`academia`, por orden alfabético— e **ignora** el de dendroenergia. Comprobado:
`curl -H "Host: 172.31.2.41"` devuelve lo mismo que `academia.conaf.cl` (un 303
de Moodle), no dendroenergia.

Efecto: quien use `http://172.31.2.41/` esperando dendroenergia aterriza en
Moodle, sin ningún error visible. **Arreglo:** dejar la IP en un solo vhost, o en
ninguno y usar el archivo `hosts` local como ya recomienda la guía de Moodle.

### H2 — `nexe.conaf.cl.conf` sirve un dominio con una errata, y `nexe.conaf.cl` no responde

El archivo se llama `nexe.conaf.cl.conf`, pero su `server_name` activo es
**`entre-planta.conaf.cl`** — le falta la sílaba a "entre**ga**-planta". Justo
encima está comentada la línea `server_name nexe.conaf.cl;`.

Comprobado: `curl -H "Host: nexe.conaf.cl"` devuelve **000** (conexión cerrada
sin respuesta), es decir que cae en el catch-all `return 444`. El dominio que da
nombre al archivo no lo sirve nadie.

### H3 — Dos vhosts para la misma app, ambos marcados "NO APLICAR TODAVÍA" y ambos activos

`coipo_entrega_planta` (8113) tiene dos archivos en `sites-enabled`:
`entrega-planta.conaf.cl.conf` (sirve `programa-arborizacion.conaf.cl`) y
`nexe.conaf.cl.conf` (sirve `entre-planta.conaf.cl`, ver H2). Los dos llevan en
la cabecera el aviso "NO APLICAR TODAVÍA — dominio sin confirmar", y sin embargo
los dos están enlazados y sirviendo.

Hay tres dominios en circulación para una sola app (`nexe`, `entre-planta`,
`programa-arborizacion`) y el registro maestro (`app_master.xlsx`) dice un cuarto,
`entrega_planta.conaf.cl`, inválido como hostname por el guion bajo.
**Decidir el canónico, dejar un solo vhost y corregir el registro maestro.**

### H4 — `usuario.conaf.cl` apunta a `coipo_apptest`, no a `coipo_usuarios`

`usuario.conaf.cl` → 8112 = `coipo_apptest`. La app de usuarios
(`coipo_usuarios`, 8111) se sirve por `iam.conaf.cl`. Puede ser deliberado, pero
por el nombre parece un cruce: conviene confirmarlo antes de que alguien lo
"arregle" en la dirección equivocada.

### H5 — `archivo.conaf.cl` no pasa por el `APP_PORT` de su app

El vhost proxea a `127.0.0.1:9001` (consola de MinIO), mientras el `APP_PORT`
declarado en su `.env` es 8116, que es donde escucha
`coipo_archivo-health-proxy-1`. El tráfico real no atraviesa el puerto que el
smoke test del despliegue comprueba: funciona, pero el smoke test no está
midiendo lo que ven los usuarios.

### H6 — vm3 va por delante de vm2 en Docker y Compose

vm3 (UAT) tiene Docker 29.7.2 / Compose v5.4.0; vm2 (producción), 29.6.2 /
v5.3.1. La premisa de los workflows gemelos es que UAT valide un despliegue
**real**, y hoy no valida el mismo runtime. La diferencia es menor, pero es
exactamente el tipo de deriva que produce el "en UAT funcionaba".
**Alinear versiones y anotar la política**: ¿UAT se actualiza antes a propósito,
o simplemente nadie mira?

### H7 — La caché de build no se limpia nunca: 19,31 GB en vm2

El paso `Construir y levantar` del workflow hace `docker image prune -f`, que
borra imágenes *dangling* pero **no toca la caché de BuildKit**. Estado real de
vm2: 19,31 GB de caché, 15,44 GB recuperables, con el disco al 56 %.

No es urgente hoy, pero crece sin techo. **Arreglo:** `docker builder prune -f`
periódico (cron mensual o tarea manual documentada), y *no* dentro del workflow:
ahí penalizaría cada despliegue reconstruyendo capas desde cero.

### H8 — Ninguna app usa `profiles:`, así que `--profile batch` hoy no hace nada

El contrato documenta el perfil `batch` para los servicios que solo se construyen,
y el workflow ejecuta `docker compose --profile batch build --pull`. Revisados los
nueve `docker-compose.yml` de vm2: **ninguno declara `profiles:`**. El flag no
sobra —es lo correcto para cuando alguien lo use— pero conviene saber que hoy es
inocuo y que ese camino no lo ha ejercitado nadie todavía.

### H9 — `coipo_cabania` lleva 8 días `unhealthy` para Docker, pero su `/health` responde 200

`docker ps` la marca `Up 8 days (unhealthy)` mientras `curl 127.0.0.1:8114/health`
devuelve 200. El healthcheck del contenedor y el endpoint no coinciden: lo más
probable es que el `test:` del compose apunte a otra ruta o a otro puerto, o que
falte la herramienta dentro de la imagen. Como el smoke test del despliegue solo
mira el `curl`, hoy no rompe nada; pero deja un `unhealthy` permanente que
enmascarará un problema real el día que lo haya.

### H10 — Dos apps se salen del patrón documentado

- `coipo_archivo`: **sin ningún `healthcheck:`** en su compose (2 servicios).
- `coipo_prensa2`: **tres bloques `ports:`**, cuando la guía dice que solo el
  servicio `app` publica puerto.

Ninguna de las dos está rota; simplemente el patrón que describe `DOCKER.md` no
es el de la flota real. O se ajustan las apps, o se documenta la excepción.

### H11 — Ningún `docker-compose.yml` de la flota declara `version:`

Va aquí para que no se reintroduzca: la clave `version:` está obsoleta en Compose
v2+ y ya no aparece en ninguno de los nueve archivos del servidor. El único sitio
donde sobrevivía era el ejemplo de `fastapi-postgresql-conexion.md`, corregido en
esta versión del documento.

---

## 5. Cambio reciente que afecta a todo lo anterior

Los tres `--exclude` del `rsync` de despliegue pasaron a estar **anclados**
(`/.git`, `/.env`, `/data/`). Antes, sin la barra inicial, el patrón casaba a
cualquier profundidad y —como `--delete` no borra lo excluido— congelaba en el
servidor cualquier archivo versionado bajo un directorio llamado `data`. Eso dejó
a `coipo_entrega_planta` con un catálogo de agosto y la base sin sembrar, mientras
`/health` respondía 200.

Consecuencias para quien escriba una app:

- Un `data/` anidado (`frontend/src/data/`, `backend/app/data/`) **ahora se
  sincroniza y se borra** como cualquier otro directorio del repo.
- Un `.env` anidado y versionado (por ejemplo `web/.env`) **ahora llega al
  servidor**. Antes no llegaba.
- Solo el `data/` y el `.env` **de la raíz** siguen protegidos de `--delete`.
- Lo que se commitee **dentro** del `data/` de la raíz sigue sin llegar nunca al
  servidor: ese directorio está excluido en los dos sentidos.

El detalle completo está en el `README.md` y en `docs/RUNBOOK.md` de
`infra-docker-base`.
