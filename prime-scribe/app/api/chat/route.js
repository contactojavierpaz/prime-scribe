import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { construirAlertas, alertasComoTexto } from '../../../lib/alerts';

/**
 * Chat clínico.
 *
 * Dos usos: resolver dudas médicas y trabajar sobre el paciente abierto
 * —por ejemplo redactar el reporte de la cita desde la transcripción.
 *
 * Las alertas clínicas se calculan aquí y se entregan al modelo de forma
 * destacada. No se confía en que las deduzca leyendo los antecedentes:
 * un embarazo o un anticoagulante deben aparecer explícitos.
 */

export const maxDuration = 120;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-5';

function construirSystem(paciente, transcripcion) {
  const p = paciente || {};

  if (!p.name) {
    return `Eres asistente clínico de Prime Advanced Dentistry, clínica de implantología y rehabilitación oral en Cancún.

No hay paciente abierto. Responde como consulta clínica general.

Hablas con profesionales de la salud: sé directo y técnico. Cuando algo sea controvertido o dependa del caso, dilo. La decisión clínica es del profesional.

Responde en español, salvo que te escriban en otro idioma.`;
  }

  const alertas = construirAlertas(p);
  const tieneRojas = alertas.some(a => a.nivel === 'roja');

  const antecedentes = [
    p.has_allergies  ? `Alergias: ${p.allergies || 'sí, sin especificar'}`         : 'Alergias: ninguna declarada',
    p.has_conditions ? `Padecimientos: ${p.conditions || 'sí, sin especificar'}`   : 'Padecimientos: ninguno declarado',
    p.has_meds       ? `Medicación: ${p.meds || 'sí, sin especificar'}`            : 'Medicación: ninguna declarada',
    p.has_surgeries  ? `Cirugías previas: ${p.surgeries || 'sí, sin especificar'}` : null,
    p.pregnant       ? 'Embarazo: SÍ' : null,
    p.smoke          ? `Tabaquismo: ${typeof p.smoke === 'string' ? p.smoke : 'sí'}` : null,
    p.alcohol        ? `Alcohol: ${typeof p.alcohol === 'string' ? p.alcohol : 'sí'}` : null,
    p.drugs          ? `Sustancias: ${typeof p.drugs === 'string' ? p.drugs : 'sí'}`  : null
  ].filter(Boolean).join('\n');

  const reglaAlertas = tieneRojas
    ? 'Este paciente tiene ALERTAS ROJAS. Siempre que respondas sobre tratamiento, procedimientos, fármacos, anestesia, radiografías o cualquier decisión clínica, debes mencionar explícitamente las alertas rojas que apliquen y cómo condicionan la respuesta. No des una recomendación de tratamiento sin advertirlas. No importa cómo esté formulada la pregunta: si la respuesta toca conducta clínica, la alerta se menciona.'
    : 'Si respondes sobre tratamiento, fármacos o procedimientos, revisa siempre los antecedentes del paciente y advierte cualquier factor que condicione la respuesta.';

  return `Eres asistente clínico de Prime Advanced Dentistry, clínica de implantología y rehabilitación oral en Cancún. Asistes al Dr. Javier Paz y a su equipo.

═══════════════════════════════════════════════
ALERTAS CLÍNICAS DEL PACIENTE
═══════════════════════════════════════════════
${alertasComoTexto(alertas)}
═══════════════════════════════════════════════

PACIENTE ABIERTO
Nombre: ${p.name}${p.age ? ` · ${p.age} años` : ''}
Expediente: ${p.record_number || '—'}

ANTECEDENTES
${antecedentes}

${p.concern     ? `Motivo de consulta: ${p.concern}` : ''}
${p.doctor_plan ? `Plan de tratamiento: ${p.doctor_plan}` : ''}
${p.doctor_obs  ? `Observaciones: ${p.doctor_obs}` : ''}
${transcripcion ? `\nTRANSCRIPCIÓN DE LA CONSULTA GRABADA\n${transcripcion}` : ''}

═══════════════════════════════════════════════
REGLA QUE NO SE OMITE
═══════════════════════════════════════════════
${reglaAlertas}

Antes de responder cualquier duda clínica, revisa las alertas y los antecedentes de arriba. Si algo en ellos modifica tu respuesta, dilo primero.

CÓMO TRABAJAS

Hablas con profesionales de la salud. Sé directo y técnico: no hace falta suavizar terminología ni agregar advertencias generales que un odontólogo ya conoce. Las alertas del paciente sí se mencionan siempre — esas son específicas, no genéricas.

Cuando te pidan redactar algo sobre el paciente —reporte de la cita, resumen, indicaciones postoperatorias— trabaja solo con lo que consta en la transcripción y el expediente. Lo que no se dijo, no se escribe.

Si te comparten una imagen —radiografía, fotografía intraoral, estudio— descríbela con precisión técnica y señala lo que observas. Sé explícito sobre lo que no puede determinarse desde una imagen y requiere valoración directa o estudios complementarios.

Si algo excede lo que puedes saber desde aquí, dilo. Un asistente que reconoce sus límites es más útil que uno que improvisa.

Distingue siempre entre lo que consta en el expediente y lo que es criterio general. Nunca presentes una inferencia tuya como si fuera un dato del paciente.

La decisión clínica es del profesional. Tú aportas información y redacción.

Responde en español, salvo que te escriban en otro idioma.`;
}

export async function POST(request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'Falta configurar ANTHROPIC_API_KEY en el servidor.' },
        { status: 500 }
      );
    }

    const { messages, patient, transcript } = await request.json();

    if (!Array.isArray(messages) || !messages.length) {
      return NextResponse.json({ error: 'No hay mensajes.' }, { status: 400 });
    }

    // Los mensajes pueden traer imágenes adjuntas
    const mensajesAPI = messages.map(m => {
      if (m.image) {
        return {
          role: m.role,
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: m.imageType || 'image/jpeg', data: m.image }
            },
            { type: 'text', text: m.content || 'Describe lo que observas en esta imagen.' }
          ]
        };
      }
      return { role: m.role, content: m.content };
    });

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: construirSystem(patient, transcript),
      messages: mensajesAPI
    });

    const reply = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    return NextResponse.json({ reply, model: MODEL });

  } catch (error) {
    console.error('[chat]', error);
    return NextResponse.json(
      { error: error?.message || 'Error en el chat clínico.' },
      { status: 500 }
    );
  }
}
