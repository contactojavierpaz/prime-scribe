# Prime Scribe

Notas clínicas asistidas para Prime Advanced Dentistry.
Graba la consulta, la transcribe y redacta la nota. Todo queda en el expediente del paciente.

---

## Cómo se conecta con la Historia Clínica

Prime Scribe **no tiene su propia lista de pacientes**. Esa es la decisión que sostiene toda la arquitectura: si ambos sistemas mantuvieran su lista, el equipo capturaría cada paciente dos veces y en semanas dejarían de coincidir.

El flujo real es este. En la Historia Clínica entras al módulo **Scribe**, ves la lista de pacientes y eliges uno. Se abre Prime Scribe con ese paciente ya cargado. Grabas, se transcribe, se redacta la nota, la firmas. La nota aparece de inmediato en el expediente del paciente — en el panel del Doctor, en el del Manager y en el expediente impreso.

Ambos sistemas comparten la misma base de datos Supabase y las mismas cuentas de usuario.

---

## Instalación

### 1 · Subir a GitHub

```bash
cd prime-scribe
git init
git add .
git commit -m "Prime Scribe v1"
git remote add origin https://github.com/contactojavierpaz/prime-scribe.git
git push -u origin main
```

### 2 · Desplegar en Vercel

En **vercel.com** → Add New → Project → importa el repositorio. Vercel detecta Next.js solo; no cambies nada de la configuración.

Antes de darle Deploy, agrega las variables de entorno.

### 3 · Variables de entorno

En Vercel → Settings → Environment Variables:

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://vdcumakbewvrffiaxlpj.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Tu anon key (empieza con `eyJ`) |
| `OPENAI_API_KEY` | Tu llave de OpenAI (`sk-...`) |
| `ANTHROPIC_API_KEY` | Tu llave de Anthropic (`sk-ant-...`) |
| `NEXT_PUBLIC_EHR_URL` | `https://luminous-kelpie-7e295b.netlify.app` |

**Detalle importante.** Solo las variables con prefijo `NEXT_PUBLIC_` llegan al navegador. `OPENAI_API_KEY` y `ANTHROPIC_API_KEY` no lo llevan a propósito: viven únicamente en el servidor y el navegador nunca las ve. Por eso Scribe es una app Next.js y no un archivo HTML — un HTML no puede guardar secretos.

### 4 · Actualizar la URL en la Historia Clínica

Si Vercel te da un dominio distinto al actual, abre `index.html` de la Historia Clínica y busca:

```js
const SCRIBE_URL = 'https://prime-clinical-notes.vercel.app';
```

Cámbialo por tu dominio y vuelve a subir a Netlify.

### 5 · Desarrollo local (opcional)

```bash
npm install
cp .env.local.example .env.local   # y llena las llaves
npm run dev
```

Abre `http://localhost:3000/?patient_id=ID_DE_UN_PACIENTE`

---

## Qué hace

**Grabación.** Pausa y reanudación, cronómetro. El audio se comprime a 24 kbps en opus, así que media hora de consulta pesa unos 5 MB — cómodamente dentro del límite de 25 MB de Whisper.

**Transcripción con Whisper.** Detecta el idioma solo, sin configurar nada. Esto importa en Prime: los pacientes vienen de Estados Unidos y Canadá, el equipo habla español, y en la misma consulta se cambia de idioma. Whisper lo maneja; la API de voz del navegador no.

El modelo recibe además un vocabulario de referencia con terminología dental y nombres de fármacos, lo que mejora bastante el reconocimiento de palabras como *oseointegración*, *alveoloplastia* o *alendronato*.

**Redacción de la nota con Claude.** Cuatro plantillas: consulta inicial, procedimiento, seguimiento y evolución. El modelo recibe el contexto real del paciente — motivo de consulta, plan de tratamiento, alergias, padecimientos y medicación — porque una nota redactada con ese contexto es de otra calidad que una redactada a ciegas.

La instrucción al modelo es explícita en un punto: redacta solo sobre lo que consta en la transcripción. Si un apartado no se trató, lo marca como no consignado en lugar de inventarlo. El contexto del paciente sirve para interpretar correctamente lo que oye, no para rellenar la nota.

**Chat clínico.** Dos usos: consultar dudas médicas generales, o pedir trabajo sobre el paciente abierto. Si hay una consulta grabada, la tiene disponible como contexto — de ahí que funcione pedirle *"hazme el reporte de esta cita"*.

**Notas previas.** El historial completo del paciente, con su estado y autor.

---

## Trazabilidad

Cada nota queda con autor, fecha, hora y tipo. Cada acción se registra en `audit_log`, la bitácora compartida con la Historia Clínica. Cada uso de IA queda en `ai_jobs` con el modelo empleado.

Toda salida de IA nace como `unreviewed` y toda nota puede guardarse como borrador antes de firmarse. Esto no es un detalle de diseño: la NOM-004 exige que todo asiento del expediente tenga un autor profesional responsable, y una salida de modelo no puede integrarse sin validación humana demostrable.

Una nota firmada no se modifica — la base de datos lo impide. Para corregirla se crea una nota de enmienda que referencia a la original.

---

## Costos

Whisper cobra unos 0.6 centavos de dólar por minuto: una consulta de 30 minutos son 18 centavos. Claude para redactar la nota ronda 1 a 3 centavos.

Con 20 consultas al mes son unos 4 dólares. Con 100, unos 20.

---

## Requisitos previos

En Supabase deben estar ejecutadas las migraciones `001_ehr_compliance.sql` y `002_scribe_integration.sql`, que crean `clinical_notes`, `ai_jobs`, `audit_log` y la vista `scribe_patients`.

---

## Nota sobre el modelo

Las rutas usan `claude-sonnet-5`. Los nombres de modelo cambian con el tiempo; si una llamada falla con error de modelo no encontrado, verifica el nombre vigente en la documentación de Anthropic y actualízalo en `app/api/generate-note/route.js` y `app/api/chat/route.js`.
