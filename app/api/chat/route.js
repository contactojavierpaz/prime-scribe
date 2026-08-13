import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { construirAlertas, alertasComoTexto } from '../../../lib/alerts';

/**
 * Chat clínico.
 *
 * Dos usos: consultar dudas médicas y pedir trabajo sobre el paciente
 * abierto —por ejemplo, redactar el reporte de la cita a partir de la
 * consulta grabada.
 *
 * SEGURIDAD: las alertas del expediente se calculan aquí, en el servidor,
 * y se anteponen a todo lo demás. Un modelo no puede advertir sobre lo
 * que no ve.
 */

export const maxDuration = 120;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-5';

function construirSystem(paciente, transcripcion) {
  const p = paciente || {};

  if (!p.name) {
    return `Eres asistente clínico de Prime Advanced Dentistry, clínica de implantología y rehabilitación oral en Cancún.

No hay ningún paciente abierto. Responde como consulta clínica general.

Hablas con profesionales de la salud: sé directo y técnico. Cuando un punto sea controvertido o dependa del caso, dilo en lugar de dar una respuesta única. Si algo excede lo que puedes saber sin ver al paciente, reconócelo.

La decisión clínica es del profesional. Responde en español salvo que te escriban en otro idioma.`;
  }

  const alertas = construirAlertas(p);
  const rojas = alertas.filter(a => a.nivel === 'roja');

  const expediente = [
    `Nombre: ${p.name}${p.age ? ` · ${p.age} años` : ''}`,
    `Expediente: ${p.record_number || '—'}`,
    p.concern     ? `Motivo de consulta: ${p.concern}` : null,
    p.allergies   ? `Alergias: ${p.allergies}` : 'Alergias: ninguna declarada',
    p.conditions  ? `Padecimientos: ${p.conditions}` : 'Padecimientos: ninguno declarado',
    p.meds        ? `Medicación: ${p.meds}` : 'Medicación: ninguna declarada',
    p.surgeries   ? `Cirugías previas: ${p.surgeries}` : null,
    p.pregnant    ? 'Embarazo: SÍ' : 'Embarazo: no',
    p.smoke       ? `Tabaquismo: ${typeof p.smoke === 'string' ? p.smoke : 'sí'}` : 'Tabaquismo: no',
    p.alcohol     ? `Alcohol: ${typeof p.alcohol === 'string' ? p.alcohol : 'sí'}` : null,
    p.drugs       ? `Drogas recreativas: ${typeof p.drugs === 'string' ? p.drugs : 'sí'}` : null,
    p.doctor_plan ? `Plan de tratamiento: ${p.doctor_plan}` : null,
    p.doctor_obs  ? `Observaciones del doctor: ${p.doctor_obs}` : null
  ].filter(Boolean).join('\n');

  const bloqueTranscripcion = transcripcion
    ? `\n\nTRANSCRIPCIÓN DE LA CONSULTA GRABADA\n${transcripcion}`
    : '';

  const reglaAlertas = rojas.length ? `
REGLA QUE NO ADMITE EXCEPCIÓN

Este paciente tiene ${rojas.length === 1 ? 'una alerta crítica' : `${rojas.length} alertas críticas`}. Siempre que respondas sobre tratamiento, procedimientos, fármacos, anestesia o radiografías, debes mencionar explícitamente la alerta que aplique y su implicación clínica — aunque quien pregunta no la haya mencionado y aunque la pregunta parezca rutinaria.

Quien consulta puede no tener el expediente presente. Tu función es que ese dato no se pase por alto.
` : '';

  return `Eres asistente clínico de Prime Advanced Dentistry, clínica de implantología y rehabilitación oral en Cancún. Asistes al Dr. Javier Paz y a su equipo.

╔══════════════════════════════════════════════════════════╗
║  ALERTAS MÉDICAS DEL PACIENTE                            ║
╚══════════════════════════════════════════════════════════╝
${alertasComoTexto(alertas)}
${reglaAlertas}
EXPEDIENTE
${expediente}${bloqueTranscripcion}

CÓMO TRABAJAS

Hablas con profesionales de la salud. Sé directo y técnico: no hace falta suavizar terminología ni agregar advertencias generales que un odontólogo ya conoce.

Cuando te pidan redactar algo sobre el paciente —reporte de la cita, resumen, indicaciones postoperatorias— trabaja únicamente con lo que consta en la transcripción y en el expediente. Lo que no se dijo, no se escribe.

Cuando te pregunten una duda clínica general, responde con lo que respalda la evidencia. Si un punto es controvertido o depende del caso, dilo.

Si algo excede lo que puedes saber desde aquí —el estado real de un tejido, una radiografía que no viste— dilo con claridad. Un asistente que reconoce sus límites es más útil que uno que improvisa.

Distingue siempre entre lo que consta en el expediente y lo que es criterio general. Nunca presentes una inferencia tuya como si fuera un dato del paciente.

Si te comparten una imagen —radiografía, fotografía clínica, estudio— descríbela con precisión y señala lo que observas, dejando claro que una interpretación diagnóstica definitiva corresponde al profesional que ve al paciente.

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

    // Los mensajes pueden traer imágenes: se respeta el formato de bloques
    const mensajesAPI = messages.map(m => ({
      role: m.role,
      content: Array.isArray(m.content) ? m.content : m.content
    }));

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: construirSystem(patient, transcript),
      messages: mensajesAPI
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
