# Guía 8 — Prompt: checklist final antes de hacer push (listo para desplegar)

La Guía 5 transforma un proyecto genérico en la **estructura** correcta (3 contenedores, `.env.example`, workflow). Esta guía es el paso siguiente: un **checklist de auditoría**, no de estructura. Revisa una app que ya tiene más o menos la forma correcta y encuentra lo que va a tumbar el deploy o dejar un hueco de seguridad, antes de hacer `git push`.

Es un **prompt**, no una explicación: pégalo al inicio de una sesión de un asistente de IA parado sobre el repo de la app que vas a desplegar.

> **Cambios respecto a la versión anterior** (verificados contra el servidor el 2026-08-20):
> el punto de `.gitignore` cambió —`data/` sin barra inicial es ahora un error real, no un
> detalle—, hay dos puntos nuevos (el 10 sobre lo que el `rsync` sincroniza y el 11 sobre
> `/health`), y el checklist pasa de 9 a 11 puntos. Ver `00-HALLAZGOS-Y-ESTADO-REAL.md`.

---

## El prompt (copiar desde acá)

```
Tu tarea: auditar este repo contra el checklist de abajo, ANTES de hacer push a main,
para que el despliegue automático (self-hosted, vm2 172.31.2.41 para producción / vm3
172.31.2.42 para UAT, con PostgreSQL 17.10 compartido en 172.31.2.40) no falle por algo
ya conocido. No es revisar la lógica de negocio — es revisar específicamente los puntos
que ya rompieron un deploy real. Al final, entregá un checklist con cada punto en
[OK] / [FALTA] / [N/A], y arreglá lo que puedas arreglar directamente en el repo; lo que
requiera una decisión del usuario (nombres, dominios, puertos, alcance de CORS),
preguntalo en vez de asumirlo.

## 1. Nombre del repo

- ¿El nombre del repo en GitHub está en minúsculas? El deploy usa
  ${{ github.event.repository.name }} para armar /opt/apps/<nombre>/ en el servidor —
  si el repo quedó en mayúsculas (común: se crea así por defecto y se olvida renombrar),
  hay que renombrarlo ANTES del primer push a main:
      gh repo rename <nombre-en-minusculas> --repo <org>/<NOMBRE-ACTUAL>
  Esto no lo hagas solo/a sin avisar — confirmá el nombre final con el usuario primero.

- ¿El nombre del repo coincide con el nombre del rol/base de datos que va a usar? NO TIENE
  que coincidir (caso real: repo "coipo_usuarios" con rol de BD "iam"). Si no coinciden,
  no es un error: dejalo anotado en el resumen para que no se confunda con la carpeta del
  servidor, que SIEMPRE es el nombre del repo, nunca el del rol de BD.

## 2. APP_PORT único en el host

APP_PORT tiene que ser único por VM: si dos apps comparten puerto, el smoke test de una
puede dar VERDE contra el /health de la otra, y el despliegue parece correcto estando roto.
Asignación real hoy en vm2: 8101 prensa2, 8103 dendroenergia, 8111 usuarios, 8112 apptest,
8113 entrega_planta, 8114 cabania, 8115 moodle, 8116 archivo, 8117 seguimiento_madera.
Libres: 8102, 8104-8110, 8118+. Confirmá el puerto elegido con el usuario y, si tenés
acceso a la VM, verificá:  sudo ss -tlnp | grep :<puerto>

## 3. .env.example — variables completas, no solo las genéricas

Las variables base de infraestructura son siempre estas 6:
    DATABASE_HOST, DATABASE_PORT, DATABASE_USER, DATABASE_PASSWORD, DATABASE_NAME, APP_PORT

PERO: leé el código real de configuración del backend (ej. backend/core/config.py si usa
Pydantic Settings, o el equivalente) y listá TODAS las variables que el proceso exige sin
default. Si alguna no está en .env.example y falta en el .env real del servidor, el
contenedor arranca, falla el healthcheck, y todo el "docker compose up" se cae con
"dependency failed to start" (ya pasó con JWT_SECRET en coipo_usuarios). No asumas que las
6 genéricas alcanzan para ninguna app.

## 4. Secretos — placeholders que no inviten a copiar-pegar tal cual

Para cualquier variable tipo JWT_SECRET, API_KEY, SESSION_SECRET: el placeholder en
.env.example debe decir cómo generarlo (ej. "openssl rand -hex 32") y NO puede ser un valor
corto o memorable tipo "cambiar123" — igual va a terminar copiado tal cual alguna vez. Si
encontrás un secreto real (no placeholder) commiteado en el repo, avisalo de inmediato: es
un incidente, no un estilo a corregir en silencio.

## 5. CORS — por dominio, nunca por IP ni wildcard

Si el proyecto expone una API que otras apps CONAF van a consumir (no solo su propio
frontend), CORS_ORIGINS debe ser una lista explícita de dominios (ej. http://iam.conaf.cl),
NUNCA "*" y NUNCA una IP. Motivo: el navegador arma el header Origin con el dominio de la
barra de direcciones, nunca con la IP del servidor — así que un origin por IP nunca calza
con una petición real, y "*" abre el servicio a cualquier origen de internet. Los dominios
NO necesitan existir en DNS todavía para configurarlos ya.

Si no es evidente si esta app va a ser consumida por otras (ej. un servicio de
identidad/auth, un backend compartido), PREGUNTALO — no asumas ni "*" ni una lista vacía.

## 6. Variables de entorno "de ambiente" con valor de riesgo

  - APP_ENV (o similar): el .env.example puede traer "development" por defecto, pero
    confirmá con el usuario que el valor real para este despliegue va a ser "production".
  - Cualquier flag tipo SESSION_HTTPS_ONLY=true o "secure cookies" obligatorias: HOY EL
    SERVIDOR SIGUE SIRVIENDO HTTP PLANO (comprobado: no existe /etc/nginx/ssl/ y ningún
    vhost escucha en 443). Un flag así en true rompe el login, porque las cookies "Secure"
    no se mandan por HTTP. Debe quedar en false hasta que el certificado *.conaf.cl esté
    instalado — y anotarlo como pendiente para el día que llegue.

## 7. Estructura docker-compose.yml

- "backend": sin ports, healthcheck contra su propio /health, env_file: .env.
- "app": el ÚNICO servicio con ports ("${APP_PORT:-8080}:8000"), depends_on backend con
  condition: service_healthy.
- "collector" (si existe): sin ports, cron empaquetado con supercronic en la imagen, nunca
  cron del host. restart: unless-stopped.
- Todos los "build:" usan context: . (raíz del repo), nunca el subdirectorio del servicio.
- NO pongas la clave "version:" — está obsoleta en Compose v2+ y ninguna app de la flota
  la usa ya.
- Si usás "profiles: [batch]" para servicios que solo se construyen: el workflow hace
  "build --profile batch" pero el "up -d" NO lleva el perfil, así que quedan construidos y
  sin arrancar. Es intencional. (Dato: hoy ninguna app de la flota usa profiles, así que
  serías la primera en ejercitar ese camino — probalo en UAT.)

## 8. .gitignore — con las rutas ANCLADAS

- .env DEBE estar ignorado (el real lo crea el bootstrap del servidor, nunca se commitea).
- El directorio de datos persistentes se ignora como "/data/", CON BARRA INICIAL, no
  "data/". Sin la barra, git ignora CUALQUIER carpeta llamada data a cualquier profundidad,
  incluida frontend/src/data/ — y ahí es donde suele vivir un catálogo generado que sí
  querés versionar. Este error exacto ya ocurrió y hubo que corregirlo.
- Revisá que no estés ignorando por accidente archivos generados que el build necesita.
- Si hay restos de un proveedor cloud anterior (railway.toml, Procfile, vercel.json,
  Dockerfile.heroku): NO los borres sin avisar, pero señalalos en el resumen.

## 9. Verificación de que /health existe

Confirmá leyendo el código (no asumiendo) que el backend expone GET /health devolviendo
200 con JSON simple, sin autenticación y sin redirecciones: el smoke test usa "curl -sf",
que falla con cualquier código >= 400 y NO sigue 3xx. Un 302 a login también falla.

## 10. Qué llega al servidor y qué no (rsync anclado)

El despliegue sincroniza con: rsync -a --delete --exclude='/.git' --exclude='/.env'
--exclude='/data/'. Los tres patrones están ANCLADOS a la raíz. Revisá en este repo:

  - ¿Hay algún .env versionado en un subdirectorio (web/.env, backend/.env)? AHORA LLEGA
    AL SERVIDOR. Antes no llegaba. Si contiene algo que no debería salir del repo, es un
    hallazgo que hay que reportar ya. (Caso real detectado en la flota: un repo versiona
    web/.env con tokens VITE_*.)
  - ¿Hay archivos versionados DENTRO del data/ de la raíz? No llegan nunca al servidor:
    ese directorio está excluido en los dos sentidos. Si la app los necesita en runtime,
    hay que moverlos fuera de data/ o copiarlos en el bootstrap.
  - ¿Hay un data/ anidado (frontend/src/data/) con archivos generados? Ahora SÍ se
    sincroniza y se borra como cualquier otro. Bien — pero si el repo se escribió asumiendo
    lo contrario, revisá que no dependiera de que esa copia quedara "congelada".
  - Cualquier archivo que la app genere en runtime fuera del data/ de la raíz se pierde en
    el siguiente despliegue, porque --delete deja el servidor como espejo del repo.

## 11. Que un fallo de datos NO se vea como una app sana

Este es el punto que más caro salió. Caso real: el seed de catálogo moría con
KeyError: 'comunas', el código atrapaba la excepción para no dejar el contenedor en
crash-loop, y la app arrancaba con /health respondiendo 200 y la base VACÍA. El deploy salió
verde, el smoke test también, y nadie se enteró.

Revisá en este repo:
  - ¿Hay algún "except Exception" que se trague un fallo de arranque (seed, migración,
    carga de configuración) y siga? Si lo hay, está bien no hacer crash-loop, PERO ese
    estado tiene que ser visible: o /health lo refleja, o hay un /ready aparte que el
    operador pueda mirar, o el arranque valida y falla el BUILD (un RUN en el Dockerfile
    que valide el dato es la forma más barata: build roto = contenedores viejos siguen
    sirviendo).
  - Si /health toca la base, ¿devuelve 200 aunque la consulta falle? Si el handler hace
    try/except y devuelve {"status":"error"} con código 200, el smoke test NUNCA lo va a
    detectar. Debe devolver 503.
  - Si usás SQLAlchemy 2.x, db.execute("SELECT 1") con un string crudo ya no funciona:
    tiene que ser db.execute(text("SELECT 1")). Un /health escrito con la forma vieja falla
    siempre, o peor, "pasa" por el except.

## Al terminar

Entregá el checklist completo (los 11 puntos) en formato [OK] / [FALTA] / [N/A], qué
arreglaste directo, y qué preguntas quedan abiertas antes del push. Si todo quedó [OK] o
[N/A], decilo explícitamente: "listo para push" — no lo dejes implícito.
```

---

## Cuándo usar esto

Justo antes del primer `git push` a `main` de una app nueva (o al re-auditar una que lleva tiempo sin desplegarse), después de que la Guía 5 dejó la estructura correcta. Úsalo también como segunda opinión si un deploy falla y no es obvio por qué.

Si la app va a tener UAT, corre el checklist igual y despliega primero a la rama `uat`: es la única forma de probar un despliegue real sin tocar producción. Ten presente que hoy vm3 tiene versiones de Docker y Compose ligeramente **más nuevas** que vm2, así que UAT no valida un runtime idéntico (H6 de `00-HALLAZGOS-Y-ESTADO-REAL.md`).
