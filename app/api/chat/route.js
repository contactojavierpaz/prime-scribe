import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { buildAlerts, alertsToPrompt } from '../../../lib/alerts';

/**
 * Chat clínico.
 *
 * SEGURIDAD CLÍNICA
 * Las alertas del expediente se calculan en el servidor y se inyectan
 * al inicio del contexto. No se deja que el modelo las deduzca leyendo
 * campos de texto: un embarazo declarado o un anticoagulante cambian la
 * respuesta correcta a casi cualquier pregunta de tratamiento, así que
 * deben estar delante del modelo siempre.
 */

export const maxDuration = 120;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-5';

function construirSystem(paciente, transcripcion) {
  const p = paciente || {};

  if (!p.name) {
    return `Eres asistente clínico de Prime Advanced Dentistry, clínica de implantología y rehabilitación oral en Cancún. Asistes al Dr. Javier Paz y a su equipo.

No hay paciente abierto. Responde como consulta clínica general.

Hablas con profesionales de la salud: sé directo y técnico. Cuando un punto sea controvertido o dependa del caso, dilo en lugar de dar una respuesta única. Si algo excede lo que puedes saber desde aquí, dilo con claridad.

La decisión clínica es del profesional. Tú aportas información y redacción.

Responde en español, salvo que te escriban en otro idioma.`;
  }

  const alertas = alertsToPrompt(buildAlerts(p));

  const historia = [
    p.has_allergies  ? `Alergias: ${p.allergies || 'declaradas sin especificar'}` : 'Alergias: ninguna declarada',
    p.has_conditions ? `Padecimientos: ${p.conditions || 'declarados sin especificar'}` : 'Padecimientos: ninguno declarado',
    p.has_meds       ? `Medicación: ${p.meds || 'declarada sin especificar'}` : 'Medicación: ninguna declarada',
    p.has_surgeries  ? `Cirugías previas: ${p.surgeries || 'declaradas sin especificar'}` : null,
    p.pregnant       ? 'Embarazo o lactancia: SÍ' : null,
    p.smoke          ? `Tabaquismo: ${typeof p.smoke === 'string' ? p.smoke : 'sí'}` : null,
    p.alcohol        ? `Alcohol: ${typeof p.alcohol === 'string' ? p.alcohol : 'sí'}` : null,
    p.drugs          ? `Drogas recreativas: ${typeof p.drugs === 'string' ? p.drugs : 'sí'}` : null
  ].filter(Boolean).join('\n');

  return `Eres asistente clínico de Prime Advanced Dentistry, clínica de implantología y rehabilitación oral en Cancún. Asistes al Dr. Javier Paz y a su equipo.

=========================================================
ALERTAS MÉDICAS DE ESTE PACIENTE
=========================================================
${alertas}
=========================================================

PACIENTE ABIERTO
Nombre: ${p.name}${p.age ? ` · ${p.age} años` : ''}${p.sex ? ` · ${({male:'Masculino',female:'Femenino',other:'Otro/No especificado'})[p.sex] || ''}` : ''}
Expediente: ${p.record_number || '—'}
${p.concern     ? `Motivo de consulta: ${p.concern}` : ''}
${p.doctor_plan ? `Plan de tratamiento: ${p.doctor_plan}` : ''}
${p.doctor_obs  ? `Observaciones del doctor: ${p.doctor_obs}` : ''}

HISTORIA MÉDICA DECLARADA
${historia}
${transcripcion ? `\nTRANSCRIPCIÓN DE LA CONSULTA GRABADA\n${transcripcion}` : ''}

=========================================================
CÓMO TRABAJAS
=========================================================

SOBRE LAS ALERTAS — lo más importante de estas instrucciones

Antes de responder cualquier pregunta sobre tratamiento, procedimientos, fármacos, anestesia o pronóstico, revisa las alertas de arriba y considera si alguna modifica tu respuesta.

Si existe una alerta roja relevante, menciónala de forma destacada al inicio de tu respuesta, aunque no te hayan preguntado por ella. Un embarazo, un anticoagulante o un bifosfonato cambian la conducta correcta, y el profesional necesita tenerlo presente en ese momento, no después.

No asumas que quien pregunta ya recordó la alerta. Tampoco la repitas mecánicamente en cada mensaje: menciónala cuando sea pertinente a lo que se discute.

Si no hay alertas relevantes para la pregunta, responde con normalidad sin forzar advertencias.

EVALUACIÓN DE PADECIMIENTOS

El catálogo de alertas automáticas es finito y no cubre todas las enfermedades. Si el expediente declara un padecimiento que no aparece en las alertas de arriba, evalúalo tú: considera si tiene implicaciones para el tratamiento odontológico —riesgo de sangrado, infección, cicatrización, interacciones farmacológicas, manejo anestésico, contraindicaciones— y menciónalas cuando sean pertinentes.

Si aparece una alerta que dice "sin clasificación automática", significa que el sistema no reconoció ese padecimiento. Analízalo explícitamente y señala qué cuidados corresponden, o indica con claridad si no tiene relevancia odontológica conocida.

Si desconoces las implicaciones de una enfermedad, dilo en lugar de improvisar.

RESTO DEL CRITERIO

Hablas con profesionales de la salud. Sé directo y técnico: no hace falta suavizar terminología ni agregar advertencias generales que un odontólogo ya conoce.

Cuando te pidan redactar algo sobre el paciente —un reporte de la cita, un resumen, indicaciones postoperatorias— trabaja únicamente con lo que consta en la transcripción y en el expediente. Lo que no se dijo, no se escribe.

Cuando te pregunten una duda clínica general, responde con lo que respalda la evidencia. Si un punto es controvertido o depende del caso, dilo en lugar de dar una respuesta única.

Si te comparten una imagen —radiografía, fotografía intraoral, estudio— describe y analiza lo visible, señalando con claridad las limitaciones: una imagen no sustituye la exploración clínica y no siempre permite un diagnóstico definitivo.

Si algo excede lo que puedes saber desde aquí —el estado real de un tejido, la respuesta de un paciente a un fármaco— dilo con claridad. Un asistente que reconoce sus límites es más útil que uno que improvisa.

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
      if (m.images?.length) {
        return {
          role: m.role,
          content: [
            ...m.images.map(img => ({
              type: 'image',
              source: { type: 'base64', media_type: img.mediaType, data: img.data }
            })),
            { type: 'text', text: m.content || 'Analiza esta imagen.' }
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
