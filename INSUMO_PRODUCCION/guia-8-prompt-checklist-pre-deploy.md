# Guía 8 — Prompt: checklist final antes de hacer push (listo para desplegar)

La Guía 5 transforma un proyecto genérico en la **estructura** correcta (3 contenedores, `.env.example`, workflow). Esta guía es el paso siguiente, con dos apps reales ya desplegadas de por medio (`coipo_prensa2`, `coipo_usuarios`) y varios errores concretos documentados en la Guía 7 — es un **checklist de auditoría**, no de estructura: revisa una app que ya tiene más o menos la forma correcta y encuentra lo que va a tumbar el deploy o dejar un hueco de seguridad, antes de hacer `git push`.

Es un **prompt**, no una explicación: pégalo al inicio de una sesión de un asistente de IA parado sobre el repo de la app que vas a desplegar (nueva o ya coded). Le da el checklist completo sin que necesite leer las otras guías.

---

## El prompt (copiar desde acá)

```
Tu tarea: auditar este repo contra el checklist de abajo, ANTES de hacer push a main,
para que el despliegue automático (self-hosted, servidor 172.31.2.41 + Postgres compartido
en vm1) no falle por algo ya conocido. No es revisar la lógica de negocio — es revisar
específicamente los puntos que ya rompieron un deploy real en el pasado. Al final, entregá
un checklist con cada punto en [OK] / [FALTA] / [N/A], y arreglá lo que puedas arreglar
directamente en el repo; lo que requiera una decisión del usuario (nombres, dominios,
alcance de CORS), preguntalo en vez de asumirlo.

## 1. Nombre del repo

- ¿El nombre del repo en GitHub está en minúsculas? El deploy usa
  ${{ github.event.repository.name }} para armar /opt/apps/<nombre>/ en el servidor —
  si el repo quedó en mayúsculas (común: se crea así por defecto y se olvida renombrar),
  hay que renombrarlo ANTES del primer push a main:
      gh repo rename <nombre-en-minusculas> --repo <org>/<NOMBRE-ACTUAL>
  Esto no lo hagas tú solo/a sin avisar — confirmá el nombre final con el usuario primero.

- ¿El nombre del repo coincide con el nombre del rol/base de datos que va a usar? NO TIENE
  que coincidir (es común que no — ej. repo "coipo_usuarios" con rol de BD "iam", por
  convención de una planilla de asignación externa al repo). Si no coinciden, no es un
  error: solo dejalo anotado explícitamente en el resumen final para que no se confunda
  con la carpeta del servidor (que SIEMPRE es el nombre del repo, nunca el del rol de BD).

## 2. .env.example — variables completas, no solo las genéricas

Las variables base de infraestructura son siempre estas 6:
    DATABASE_HOST, DATABASE_PORT, DATABASE_USER, DATABASE_PASSWORD, DATABASE_NAME, APP_PORT

PERO: leé el código real de configuración del backend (ej. backend/core/config.py si usa
Pydantic Settings, o el equivalente en el framework que sea) y listá TODAS las variables
que el proceso exige sin default. Si hay alguna que no está en .env.example, agregala ahí
— si falta en el .env real del servidor, el contenedor arranca, falla el healthcheck, y
todo el "docker compose up" se cae con "dependency failed to start" (ya pasó con
JWT_SECRET en coipo_usuarios). No asumas que las 6 genéricas alcanzan para ninguna app.

## 3. Secretos — placeholders que no inviten a copiar-pegar tal cual

Para cualquier variable tipo JWT_SECRET, API_KEY, SESSION_SECRET, etc.: el placeholder en
.env.example debe decir explícitamente cómo generarlo (ej. "openssl rand -hex 32") y NO
puede ser un valor corto o memorable tipo "cambiar123" — igual va a terminar copiado tal
cual alguna vez. Si encontrás un secreto real (no placeholder) commiteado en el repo,
avisalo de inmediato, es un incidente, no un estilo a corregir en silencio.

## 4. CORS — por dominio, nunca por IP ni wildcard

Si el proyecto expone una API que otras apps CONAF van a consumir (no solo su propio
frontend), CORS_ORIGINS debe ser una lista explícita de dominios
(ej. http://otraapp.conaf.cl), NUNCA "*" y NUNCA una IP. Motivo (dejalo anotado si el
usuario pregunta por qué): el navegador arma el header Origin con el dominio que aparece
en la barra de direcciones, nunca con la IP del servidor — así que un origin por IP nunca
va a calzar con una petición real, y "*" abre el servicio a cualquier origen de internet,
no solo a las apps CONAF. Los dominios NO necesitan existir en DNS todavía para
configurarlos ya — es forward-compatible y no tiene costo hoy.

Si no es evidente si esta app va a ser consumida por otras (ej. es un servicio de
identidad/auth, un backend compartido), PREGUNTALO — no asumas ni "*" ni una lista vacía.

## 5. Variables de entorno "de ambiente" con valor de riesgo

Buscá específicamente estas dos, si existen en el proyecto:
  - APP_ENV (o similar): el .env.example puede traer "development" por defecto (normal en
    el template), pero confirmá con el usuario que el valor real para este despliegue va
    a ser "production" antes de dar por cerrado el .env real del servidor.
  - Cualquier flag tipo SESSION_HTTPS_ONLY=true (o "secure cookies" a la fuerza): si hoy
    el servidor todavía sirve por HTTP plano (sin certificado *.conaf.cl instalado), un
    flag así en true rompe el login (las cookies "Secure" nunca se mandan por HTTP). Si lo
    encontrás en true, avisale al usuario — probablemente debe quedar en false hasta que
    el certificado esté instalado, y es fácil olvidarlo prendido de un ambiente anterior.

## 6. Estructura docker-compose.yml (repaso rápido, ya cubierto en Guía 5)

- "backend": sin ports, healthcheck contra su propio /health, env_file: .env.
- "app": el ÚNICO servicio con ports ("${APP_PORT:-8080}:8000"), depends_on backend con
  condition: service_healthy.
- "collector" (si existe): sin ports, cron empaquetado con supercronic en la imagen, nunca
  cron del host. restart: unless-stopped.
- Todos los "build:" usan context: . (raíz del repo), nunca el subdirectorio del servicio
  — los Dockerfiles suelen necesitar copiar archivos de fuera de su propia carpeta
  (ej. db/schema.sql).

## 7. .github/workflows/deploy-prod.yml — exacto, letra por letra

    name: Deploy prod
    on:
      push:
        branches: [main]
    jobs:
      deploy:
        uses: Sud-Austral/infra-docker-base/.github/workflows/deploy.yml@main
        with:
          app_name: ${{ github.event.repository.name }}

Nada más en este archivo — si "sientes" que esta app necesita un paso distinto acá, es
señal de que el cambio va en el workflow reusable (infra-docker-base), no en este repo.

## 8. .gitignore

- .env DEBE estar ignorado (el real lo crea el bootstrap del servidor, nunca se commitea).
- data/ (o cualquier carpeta de datos persistentes/volúmenes locales) ignorada.
- Si hay carpetas de un proveedor cloud anterior (railway.toml, Procfile, vercel.json,
  Dockerfile.heroku, etc.) que ya no aplican a este despliegue: NO las borres sin avisar,
  pero señalalas en el resumen final — pueden confundir a alguien que llegue después.

## 9. Verificación de que /health existe y responde bien

Confirmá (leyendo el código, no asumiendo) que el backend expone GET /health devolviendo
200 con JSON simple, y que si depende de la base de datos, refleja ahí si la conexión está
caída en vez de hacer crash-loop del proceso completo.

## Al terminar

Entregá el checklist completo (los 9 puntos de arriba) en formato [OK] / [FALTA] / [N/A],
qué arreglaste directo, y qué preguntas quedan abiertas para el usuario antes de hacer el
push. Si todo quedó [OK] o [N/A], decilo explícitamente: "listo para push" — no lo dejes
implícito.
```

---

## Cuándo usar esto

Justo antes del primer `git push` a `main` de una app nueva (o al re-auditar una que ya lleva tiempo sin desplegarse) — después de que la Guía 5 ya dejó la estructura correcta, o cuando el repo ya nació con la estructura pero nadie lo revisó contra los errores reales que ya pasaron en producción (Guía 7). Úsalo también como segunda opinión si un deploy falla y no es obvio por qué: varios de estos puntos son exactamente lo que rompió `coipo_usuarios` la primera vez.
