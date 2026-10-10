# QR Studio

Generador de códigos QR **estáticos** (100 % en tu navegador, sin servidor) y **dinámicos** (con redirección administrable).
Interfaz en español rioplatense, responsive, modo claro/oscuro y PWA instalable.

> **Estado honesto en una línea:** los QR estáticos están completos y probados en un navegador real. Los QR dinámicos tienen backend completo (SQL + función de redirección) probado con PostgreSQL real y con pruebas del manejador, **pero todavía no se conectó ni se probó contra un proyecto de Supabase real**: eso lo tenés que hacer vos con las credenciales (ver "Qué falta verificar").

---

## 1. Instalar y ejecutar

Requisitos: Node 20 o superior.

```bash
npm install
npm run dev        # desarrollo en http://localhost:5173
npm test           # 99 pruebas automáticas
npm run build      # compila a dist/ (revisa tipos antes)
npm run preview    # sirve dist/ para probar la versión final
```

Sin configurar nada, funcionan todos los QR estáticos, la biblioteca, las plantillas y los lotes. La sección de dinámicos avisa que falta conectar el servicio y no muestra datos de ejemplo.

## 2. Publicar el frontend

`dist/` es un sitio estático: sirve Netlify, Vercel, Cloudflare Pages, GitHub Pages (en la raíz del dominio) o cualquier hosting estático.
Recomendado agregar estos encabezados en el hosting (la CSP ya viene en el HTML, pero estos no se pueden poner por `<meta>`):

```
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Las variables `VITE_*` se leen **al compilar**; si las cambiás, recompilá.

## 3. QR estáticos (sin servidor)

| Tipo | Estándar usado |
|---|---|
| Enlace, texto, personalizado | texto (UTF-8) |
| Wi-Fi | `WIFI:T:…;S:…;P:…;;` con escape de `\ ; , : "` |
| Contacto | vCard 3.0 (RFC 2426), sin inyección de propiedades |
| Email | `mailto:` (RFC 6068) |
| Teléfono / SMS | `tel:` / `sms:` |
| WhatsApp | `https://wa.me/<número>?text=` |
| Ubicación | enlace de Google Maps o `geo:` (RFC 5870) |
| Evento | iCalendar VEVENT (RFC 5545) o enlace de Google Calendar |
| Redes sociales | enlace al perfil o URL completa |

- **Editor:** paletas, degradados, 6 estilos de módulos, 4 marcos y 4 centros de esquina, logo (se reduce a 256 px en tu dispositivo), margen, marco exterior y título, fondo transparente, vista previa sobre fondo claro/oscuro/transparente.
- **Exportación:** PNG, JPG, SVG y PDF (A4, A5, Carta, Legal), resolución y tamaño impreso configurables, y hoja imprimible con varios QR por página (desde Lotes).
- **Control de calidad:** contraste (WCAG), margen, densidad frente al tamaño impreso, logo vs. corrección de errores, colores invertidos, con botones para aplicar la corrección sugerida.
- **Prueba de escaneo:** rasteriza el diseño final y lo decodifica con jsQR. Es una prueba real del diseño, pero **no reemplaza probar con tu celular**; el mensaje lo dice.
- **Biblioteca:** IndexedDB local. Buscar, favoritos, duplicar, renombrar, editar, re-descargar, eliminar, limpiar, plantillas de estilo.
- **Lotes:** pegar lista o subir CSV (`nombre,contenido`), validación por fila, ZIP de PNG/SVG con `errores.txt`, hasta 500 filas.
- **Asistente de uso:** recomendaciones para fotocopia escolar, presentación, cartel, publicación digital y tarjeta.

### Formato JSON de exportación/importación

```json
{
  "format": "qr-studio-project",
  "version": 1,
  "exportedAt": "2026-10-10T18:00:00.000Z",
  "projects": [
    { "title": "Sitio", "description": "", "favorite": false, "type": "url",
      "values": { "url": "https://ejemplo.com.ar" },
      "style": { "ecc": "M", "fg": "#000000", "bg": "#ffffff", "moduleShape": "square", "margin": 4 },
      "createdAt": 1760000000000 }
  ],
  "templates": [ { "name": "Mi estilo", "style": { } } ]
}
```

Al importar **nunca se confía en el archivo**: se revalida el contenido con las mismas reglas que al crear (una URL `javascript:` se descarta), los estilos se sanean (solo colores hex, formas conocidas, imágenes `data:image/png|jpeg|webp|gif`) y los proyectos reciben IDs nuevos, así que importar no pisa nada.

## 4. QR dinámicos

### Arquitectura

```
Navegador (React) ──► Supabase Auth + PostgREST ──► tabla qr_links  (RLS: cada usuario ve solo lo suyo)
                                                   tabla qr_hits   (solo la función escribe)
Visitante escanea ──► Edge Function  /r/<código> ──► 302 al destino  (+ visita opcional)
```

- El QR contiene `…/r/<código>` y **nunca** el destino final. Cambiar el destino no cambia el QR.
- El código (8 caracteres, alfabeto sin confusiones 0/o, 1/l) es **inmutable**: lo garantiza un trigger en la base.
- **Seguridad aplicada en el servidor** (no solo en la interfaz):
  - RLS en todas las tablas; el rol anónimo no tiene ningún permiso.
  - Trigger que exige destinos `https://` públicos (rechaza `localhost`, IPs privadas, credenciales en la URL) y limita la cantidad de enlaces por usuario (`app_settings.max_links_per_user`, configurable, 50 por defecto).
  - La función **vuelve a validar el destino al redirigir**, aunque la base tenga un valor viejo o manipulado.
  - Límite de solicitudes por IP (en memoria, configurable en `handler.ts`; no se guarda la IP).
  - Páginas informativas para código pausado, inexistente, destino rechazado, límite excedido y error técnico.
  - La `service_role` key vive solo en la función; el frontend usa únicamente la clave pública.
- **Estadísticas (opcionales, por QR):** se guarda `fecha`, `tipo de dispositivo` y `es robot`. No hay IP, ni user-agent, ni país (no hay una fuente fiable sin guardar la IP, así que **no se ofrece**). Plazo de retención configurable por QR (1–365 días) y botón para borrar todo.
  - Lo que se cuenta son **solicitudes HTTP, no personas**. Los robots, previsualizadores de enlaces, prefetch y HEAD se separan con una heurística que no es perfecta.

### Puesta en marcha (paso a paso)

1. Creá un proyecto en [Supabase](https://supabase.com).
2. En **SQL Editor** ejecutá `supabase/migrations/001_init.sql`. Activá la extensión `pg_cron` (Database → Extensions) para que la retención se aplique sola; si no, ejecutá `select purge_old_hits();` periódicamente.
3. Instalá la CLI de Supabase, iniciá sesión y vinculá el proyecto: `supabase login` y `supabase link --project-ref TU-REF`.
4. Desplegá la función **sin verificación de JWT** (es pública a propósito): `supabase functions deploy r --no-verify-jwt`.
5. Copiá `.env.example` a `.env.local` y completá `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (Settings → API → clave *anon*, nunca la *service_role*).
6. Recompilá (`npm run build`) y publicá.
7. En Authentication → Providers dejá habilitado Email. Decidí si querés exigir confirmación de correo.

### Páginas informativas (importante)

Según mi conocimiento, en el dominio por defecto de Supabase las funciones **no muestran HTML renderizado** (verificalo en su documentación vigente). Para que el visitante vea un aviso claro cuando un código está pausado o no existe:

- Definí el secreto `INFO_PAGE_URL` con la dirección de `aviso.html` de tu sitio publicado
  (`supabase secrets set INFO_PAGE_URL=https://TU-SITIO/aviso.html`). La función redirige ahí con `?s=<motivo>`.
- O usá un dominio propio para la función (ver abajo), donde sí se muestra el HTML de respaldo.

### Dominio propio (ej. `qr.midominio.com/r/código`)

No presupongo que tengas uno. Opciones, de más simple a más flexible:

1. **Dominio personalizado de Supabase** (complemento de pago, verificá condiciones vigentes en su documentación). Después definí `VITE_REDIRECT_BASE=https://qr.midominio.com/functions/v1/r` o la ruta que corresponda.
2. **Proxy propio** (Cloudflare Workers, Netlify/Vercel rewrites) que reenvíe `qr.midominio.com/r/*` a `https://TU-PROYECTO.supabase.co/functions/v1/r/*`. Con eso `VITE_REDIRECT_BASE=https://qr.midominio.com/r`. Esta variante **no está probada** en este proyecto.

⚠️ **Los QR impresos quedan atados a esa dirección para siempre.** Si perdés el dominio o cambiás de proveedor, hay que poder seguir sirviendo la misma URL. Elegí el dominio con calma antes de imprimir nada.

### Costos, límites y continuidad

No cito precios ni cuotas de ningún proveedor porque cambian: revisá los planes vigentes antes de decidir. Lo que sí conviene saber:

| Componente | Qué cuesta o qué riesgo tiene |
|---|---|
| QR estáticos | Nada: corren en el navegador. |
| Hosting del frontend | Hay opciones gratuitas para sitios estáticos. |
| Base de datos + Auth + función | Es lo que sostiene los dinámicos. **Verificá si el plan gratuito pausa proyectos inactivos**: un proyecto pausado significa QR impresos que dejan de redirigir. |
| Estadísticas | Cada visita es una fila: más almacenamiento y consultas. La retención (por defecto 90 días) lo acota. |
| Dominio propio | Costo anual del dominio, más el del proxy o complemento si aplica. |

- El máximo de QR por usuario (`max_links_per_user`) y el límite de solicitudes por IP son **configurables** (SQL y `handler.ts`); no son límites de ningún proveedor.
- **Copias de seguridad:** el plan gratuito puede no incluirlas. Hasta que tengas un plan que las incluya, exportá tus datos periódicamente (`pg_dump` o el export de tablas del panel). No se promete disponibilidad permanente sin una infraestructura y un acuerdo de servicio que la respalden.

## 5. Pruebas

`npm test` ejecuta 99 pruebas:

| Archivo | Qué prueba |
|---|---|
| `tests/payloads.test.ts` | Los 12 tipos de contenido y su validación; los ejemplos se codifican y **decodifican igual** con los 4 niveles de corrección; UTF-8; posiciones de alineación según la norma. |
| `tests/storage.test.ts` | Importación/exportación JSON, saneamiento de estilos maliciosos, CSV por lotes. |
| `tests/dynamic-server.test.ts` | Manejador de redirección con base en memoria: redirección, cambio de destino, pausa, errores, robots, límites, paridad de validación cliente/servidor. |
| `tests/dynamic-client.test.ts` | Capa cliente: códigos, errores, agregación de estadísticas. |
| `tests/sql.test.ts` | La **migración real** sobre PostgreSQL (PGlite): RLS entre usuarios, anónimos, triggers, límite por usuario, retención, cascada, persistencia tras reabrir la base. Verificado con *mutaciones* (al debilitar una política, las pruebas fallan). |

Además, durante el desarrollo se corrió una batería en Chromium real: descargas de PNG/SVG/JPG/PDF (el PNG descargado se decodificó con jsQR), todos los estilos, logo, biblioteca con recarga, importación maliciosa, ZIP de lotes, y auditoría de accesibilidad con axe (WCAG 2.1 AA, sin violaciones en las 5 pantallas en claro y oscuro).

## 6. Qué falta verificar (honestamente)

Las **pruebas de aceptación de QR dinámicos** quedaron así:

| # | Prueba | Estado |
|---|---|---|
| 1 | Escanear un dinámico desde otro dispositivo | ❌ No verificado: requiere el servicio desplegado y un celular. |
| 2 | El enlace redirige al primer destino | ✅ Manejador probado · ⏳ falta contra el servicio real. |
| 3–4 | Cambiar el destino y que el mismo QR lleve al nuevo | ✅ Manejador y base probados · ⏳ falta contra el servicio real. |
| 5 | Un usuario no puede modificar códigos ajenos | ✅ Probado en PostgreSQL real con RLS. |
| 6 | Pausado muestra página informativa | ✅ Manejador probado · ⏳ ver nota de `INFO_PAGE_URL`. |
| 7 | Estadísticas reflejan solicitudes reales | ✅ Lógica probada · ⏳ falta con tráfico real. |
| 8 | Los cambios sobreviven a un reinicio | ✅ Probado reabriendo la base · ⏳ falta en Supabase. |
| 9 | Errores de red/servidor sin resultados falsos | ✅ Probado en servidor y en la capa cliente. |

**No declaro operativa la función dinámica hasta que la despliegues y recorras esta lista contra el servicio real.**

Otros límites conocidos:

- El PDF contiene una imagen de 300 ppp; no es vectorial. Para impresión vectorial usá SVG.
- La prueba de escaneo usa jsQR; algunos lectores de celular son más o menos tolerantes.
- Con estilos de módulos que no son cuadrados, los patrones de alineación se dibujan siempre cuadrados (si no, los decodificadores no los encuentran); es una decisión de fiabilidad sobre el efecto visual.
- Los QR dinámicos solo admiten destinos `https://` (no teléfono, WhatsApp con otros esquemas, etc.).
- No hay recuperación de contraseña personalizada ni sincronización de la biblioteca local entre dispositivos (usá exportar/importar JSON).
- La accesibilidad se auditó solo con herramienta automática (axe); faltan una revisión completa de navegación por teclado y una prueba con lector de pantalla.
- El límite de solicitudes de la función es en memoria por instancia: frena abusos simples, no ataques distribuidos.
