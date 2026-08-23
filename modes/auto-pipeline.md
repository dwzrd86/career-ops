# Modo: auto-pipeline — Pipeline Completo Automático

Cuando el usuario pega un JD (texto o URL) sin sub-comando explícito, ejecutar TODO el pipeline en secuencia:

## Límite de materiales y procedencia

Este pipeline solo puede preparar materiales locales para un rol que tenga un
registro explícito `approved-for-evaluation` de Dee. Todos los CVs, PDFs,
respuestas y mensajes son **[DRAFT]** hasta que el candidato los revise. Nunca
rellenar campos, cargar archivos, hacer clic en controles de aplicación ni
enviar una solicitud.

Conservar junto a cada Material Bundle el snapshot del JD normalizado
(`localPath` y `sha256`), la `targetProfileVersion` y el registro de
`evidenceReferences` recibido por el evaluador. Usar
`agent/templates/application-checklist.md` para el checklist local; no incluir
contenido de CV/JD ni rutas locales en proyecciones públicas.

## Paso 0 — Extraer JD

Si el input es una **URL** (no texto de JD pegado), seguir esta estrategia para extraer el contenido:

**Orden de prioridad:**

1. **Playwright (preferido):** La mayoría de portales de empleo (Lever, Ashby, Greenhouse, Workday) son SPAs. Usar `browser_navigate` + `browser_snapshot` para renderizar y leer el JD.
2. **WebFetch (fallback):** Para páginas estáticas (ZipRecruiter, WeLoveProduct, company career pages).
3. **WebSearch (último recurso):** Buscar título del rol + empresa en portales secundarios que indexan el JD en HTML estático.

**Si ningún método funciona:** Pedir al candidato que pegue el JD manualmente o comparta un screenshot.

**Si el input es texto de JD** (no URL): usar directamente, sin necesidad de fetch.

## Paso 1 — Evaluación A-G y registro de evidencia
Ejecutar exactamente igual que el modo `oferta` (leer `modes/oferta.md` para todos los bloques A-F + Block G Posting Legitimacy).

Antes de redactar materiales, crear un registro de procedencia que conserve la
versión del Target Profile, el snapshot del JD y las referencias de evidencia.
Cada requisito del JD, afirmación de match y cambio propuesto al CV debe citar
una o más referencias explícitas de ese registro. Si la evidencia no respalda
un claim, registrarlo como gap sin resolver; no inventar experiencia, métricas,
autorización ni disponibilidad.

## Paso 2 — Guardar Report .md
Guardar la evaluación completa en `reports/{###}-{company-slug}-{YYYY-MM-DD}.md` (ver formato en `modes/oferta.md`).
Include Block G in the saved report. Add `**Legitimacy:** {tier}` to the report header.

## Paso 3 — Generar borrador de CV/materiales
Read `config/profile.yml`. Check `cv.output_format`:

- If `"latex"`, execute the full pipeline from `modes/latex.md`
- Otherwise (default), execute the full pipeline from `modes/pdf.md`

Usar `generate-pdf.mjs` y, cuando corresponda, `batch/batch-runner.sh` como los
flujos ya existentes. Etiquetar el CV, PDF y cualquier mensaje como
**[DRAFT — revisión humana obligatoria]** en el report y checklist. Cada bullet
reordenado, keyword inyectada o texto de material debe conservar al menos una
referencia de evidencia explícita; reformular evidencia existente es válido,
inventar un claim no lo es.

## Paso 4 — Borradores de respuestas y checklist manual

Crear siempre un checklist local desde
`agent/templates/application-checklist.md`, con rutas de report/PDF/checklist y
la procedencia conservada. Si el score final es >= 4.5, incluir también
borradores de respuestas:

1. Usar solo preguntas que el candidato pegue o las preguntas genéricas de
   abajo; no navegar a formularios de aplicación para extraerlas.
2. Generar respuestas con referencias de evidencia explícitas y el tono de
   abajo.
3. Empezar cada respuesta con **[DRAFT]** y guardar su evidencia y cualquier
   incertidumbre en el checklist y en `## H) Draft Application Answers`.
4. Enumerar todas las respuestas pendientes, gaps y decisiones del candidato.
   No inferir ni completar datos faltantes.

### Preguntas genéricas (usar si el candidato no proporciona preguntas)

- Why are you interested in this role?
- Why do you want to work at [Company]?
- Tell us about a relevant project or achievement
- What makes you a good fit for this position?
- How did you hear about this role?

### Tono para Form Answers

**Posición: "I'm choosing you."** el candidato tiene opciones y está eligiendo esta empresa por razones concretas.

**Reglas de tono:**
- **Confiado sin arrogancia**: "I've spent the past year building production AI agent systems — your role is where I want to apply that experience next"
- **Selectivo sin soberbia**: "I've been intentional about finding a team where I can contribute meaningfully from day one"
- **Específico y concreto**: Siempre referenciar algo REAL del JD o de la empresa, y algo REAL de la experiencia del candidato
- **Directo, sin fluff**: 2-4 frases por respuesta. Sin "I'm passionate about..." ni "I would love the opportunity to..."
- **El hook es la prueba, no la afirmación**: En vez de "I'm great at X", decir "I built X that does Y"

**Framework por pregunta:**
- **Why this role?** → "Your [specific thing] maps directly to [specific thing I built]."
- **Why this company?** → Mencionar algo concreto sobre la empresa. "I've been using [product] for [time/purpose]."
- **Relevant experience?** → Un proof point cuantificado. "Built [X] that [metric]. Sold the company in 2025."
- **Good fit?** → "I sit at the intersection of [A] and [B], which is exactly where this role lives."
- **How did you hear?** → Honesto: "Found through [portal/scan], evaluated against my criteria, and it scored highest."

**Idioma**: Siempre en el idioma del JD (EN default). Aplicar `/tech-translate`.

## Paso 5 — Actualizar Tracker
Registrar en `data/applications.md` con todas las columnas incluyendo Report y PDF en ✅.

**Si algún paso falla**, continuar con los siguientes y marcar el paso fallido como pendiente en el tracker. El tracker y Material Bundle deben indicar que los materiales siguen siendo borradores pendientes de revisión humana; ningún estado de borrador equivale a una solicitud enviada.
