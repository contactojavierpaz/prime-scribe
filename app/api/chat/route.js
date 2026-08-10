import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

/**
 * Chat clínico.
 *
 * Dos usos: consultar dudas médicas generales, y pedir trabajo sobre
 * el paciente abierto —por ejemplo "hazme el reporte de esta cita"
 * usando la transcripción de la consulta.
 *
 * El modelo asiste al criterio profesional, no lo sustituye.
 */

export const maxDuration = 120;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-5';

function construirSystem(paciente, transcripcion) {
  const p = paciente || {};

  const bloquePaciente = p.name ? `
PACIENTE ABIERTO EN ESTE MOMENTO
Nombre: ${p.name}${p.age ? ` · ${p.age} años` : ''}
Expediente: ${p.record_number || '—'}
${p.concern     ? `Motivo de consulta: ${p.concern}` : ''}
${p.allergies   ? `Alergias: ${p.allergies}` : ''}
${p.conditions  ? `Padecimientos: ${p.conditions}` : ''}
${p.meds        ? `Medicación: ${p.meds}` : ''}
${p.doctor_plan ? `Plan de tratamiento: ${p.doctor_plan}` : ''}
${p.doctor_obs  ? `Observaciones: ${p.doctor_obs}` : ''}
`.trim() : 'No hay paciente abierto. Responde como consulta clínica general.';

  const bloqueTranscripcion = transcripcion ? `

TRANSCRIPCIÓN DE LA CONSULTA GRABADA
${transcripcion}` : '';

  return `Eres asistente clínico de Prime Advanced Dentistry, clínica de implantología y rehabilitación oral en Cancún. Asistes al Dr. Javier Paz y a su equipo.

${bloquePaciente}${bloqueTranscripcion}

CÓMO TRABAJAS

Hablas con profesionales de la salud. Sé directo y técnico: no hace falta suavizar terminología ni agregar advertencias generales que un odontólogo ya conoce.

Cuando te pidan redactar algo sobre el paciente —un reporte de la cita, un resumen, indicaciones postoperatorias— trabaja únicamente con lo que consta en la transcripción y en el expediente. Lo que no se dijo, no se escribe.

Cuando te pregunten una duda clínica general, responde con lo que respalda la evidencia. Si un punto es controvertido o depende del caso, dilo en lugar de dar una respuesta única.

Si algo excede lo que puedes saber desde aquí —el estado real de un tejido, una radiografía que no viste, la respuesta de un paciente a un fármaco— dilo con claridad. Un asistente que reconoce sus límites es más útil que uno que improvisa.

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

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: construirSystem(patient, transcript),
      messages: messages.map(m => ({ role: m.role, content: m.content }))
    });

    const reply = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    return NextResponse.json({ reply, model: MODEL });

  } catch (error) {
    console.error('[chat]', error);
    return NextResponse.json(
      { error: error?.message || 'Error en el chat clínico.' },
      { status: 500 }
    );
  }
}
