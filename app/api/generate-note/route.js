import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { buildAlerts, alertsToPrompt } from '../../../lib/alerts';
import { alertsForPrompt } from '../../../lib/alerts';

/**
 * Redacción de nota clínica a partir de la transcripción.
 *
 * Principio rector: el modelo redacta únicamente sobre lo que consta
 * en la transcripción. No infiere diagnósticos, no completa datos
 * faltantes y no inventa hallazgos. Un apartado que no se abordó
 * simplemente se omite: no se rellena con texto de marcador.
 */

export const maxDuration = 120;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-5';

const PLANTILLAS = {
  consultation: {
    nombre: 'Consulta inicial',
    estructura: [
      'MOTIVO DE CONSULTA',
      'PADECIMIENTO ACTUAL',
      'ANTECEDENTES RELEVANTES',
      'EXPLORACIÓN CLÍNICA',
      'DIAGNÓSTICO PRESUNTIVO',
      'PLAN DE TRATAMIENTO PROPUESTO',
      'INDICACIONES'
    ]
  },
  procedure: {
    nombre: 'Nota de procedimiento',
    estructura: [
      'PROCEDIMIENTO REALIZADO',
      'ANESTESIA EMPLEADA',
      'DESCRIPCIÓN DE LA TÉCNICA',
      'MATERIALES E INSUMOS',
      'HALLAZGOS TRANSOPERATORIOS',
      'INCIDENTES O COMPLICACIONES',
      'INDICACIONES POSTOPERATORIAS'
    ]
  },
  followup: {
    nombre: 'Nota de seguimiento',
    estructura: [
      'MOTIVO DE LA VISITA',
      'EVOLUCIÓN DESDE LA ÚLTIMA CITA',
      'EXPLORACIÓN',
      'AJUSTES AL PLAN',
      'INDICACIONES',
      'PRÓXIMA CITA'
    ]
  },
  evolution: {
    nombre: 'Nota de evolución',
    estructura: [
      'ESTADO ACTUAL',
      'HALLAZGOS',
      'ANÁLISIS',
      'CONDUCTA A SEGUIR'
    ]
  }
};

function construirSystem(paciente, plantilla) {
  const p = paciente || {};
  const t = PLANTILLAS[plantilla] || PLANTILLAS.consultation;

  const alertas = alertsToPrompt(buildAlerts(p));

  const contexto = [
    p.name          ? `Paciente: ${p.name}` : null,
    p.age           ? `Edad: ${p.age} años` : null,
    p.sex           ? `Sexo: ${({male:'Masculino',female:'Femenino',other:'Otro/No especificado'})[p.sex] || p.sex}` : null,
    p.record_number ? `Expediente: ${p.record_number}` : null,
    p.concern       ? `Motivo registrado en su historia clínica: ${p.concern}` : null,
    p.allergies     ? `Alergias declaradas: ${p.allergies}` : null,
    p.conditions    ? `Padecimientos declarados: ${p.conditions}` : null,
    p.meds          ? `Medicación actual: ${p.meds}` : null,
    p.pregnant      ? 'Embarazo o lactancia: SÍ' : null,
    p.smoke         ? `Tabaquismo: ${typeof p.smoke === 'string' ? p.smoke : 'sí'}` : null,
    p.doctor_plan   ? `Plan de tratamiento vigente: ${p.doctor_plan}` : null
  ].filter(Boolean).join('\n');

  return `Eres asistente de documentación clínica en Prime Advanced Dentistry, clínica de implantología y rehabilitación oral en Cancún, México.

Tu tarea es redactar una nota clínica a partir de la transcripción de una consulta.

=========================================================
ALERTAS MÉDICAS DE ESTE PACIENTE
=========================================================
${alertas}
=========================================================

CONTEXTO DEL PACIENTE
${contexto || 'Sin contexto previo disponible.'}

ESTRUCTURA DE REFERENCIA — "${t.nombre}"
${t.estructura.map(s => `## ${s}`).join('\n')}

=========================================================
REGLAS DE REDACCIÓN
=========================================================

QUÉ INCLUIR Y QUÉ NO

Redacta únicamente sobre lo que consta en la transcripción.

Si un apartado de la estructura no fue abordado durante la consulta, OMÍTELO POR COMPLETO. No lo incluyas con un texto de relleno, no escribas "no consignado", "no se mencionó", "sin datos" ni ninguna variante. Simplemente no aparece en la nota. La estructura es una guía, no una plantilla que deba llenarse entera.

Una nota corta que refleje fielmente lo que ocurrió es mejor que una nota larga con apartados vacíos.

No infieras diagnósticos, no completes datos que no se dijeron y no agregues hallazgos que no se mencionaron. Una nota clínica es un documento legal: lo que escribes debe poder sostenerse frente a lo grabado.

El contexto del paciente y sus alertas sirven para interpretar correctamente lo que oyes —por ejemplo, reconocer el nombre de un fármaco que ya toma— no para rellenar la nota con información que no se trató en la consulta.

SOBRE LAS ALERTAS

Si durante la consulta se discutió un tema que interactúa con una alerta médica —un procedimiento en una paciente embarazada, anestesia en un paciente anticoagulado— consigna esa parte de la conversación con precisión.

Si detectas que se planeó algo que contradice una alerta roja y eso no se discutió en la consulta, agrégalo al final bajo "## OBSERVACIONES PARA REVISIÓN". No lo mezcles con el cuerpo de la nota: es una observación tuya, no un asiento de lo ocurrido.

ESTILO

Usa terminología odontológica precisa y español clínico formal. Redacta en tercera persona.

Si en la transcripción se mencionan cifras relevantes —torque, milímetros, dosis, número de órgano dentario— consígnalas textualmente.

Responde solo con la nota. Sin preámbulos ni comentarios sobre tu trabajo.`;
}

export async function POST(request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'Falta configurar ANTHROPIC_API_KEY en el servidor.' },
        { status: 500 }
      );
    }

    const { transcript, patient, template, extraInstructions } = await request.json();

    if (!transcript || !transcript.trim()) {
      return NextResponse.json({ error: 'No hay transcripción para procesar.' }, { status: 400 });
    }

    const mensaje = [
      'Transcripción de la consulta:',
      '',
      transcript,
      extraInstructions ? `\n\nIndicación adicional del profesional: ${extraInstructions}` : ''
    ].join('\n');

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: construirSystem(patient, template),
      messages: [{ role: 'user', content: mensaje }]
    });

    const note = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    return NextResponse.json({
      note,
      model: MODEL,
      template: template || 'consultation'
    });

  } catch (error) {
    console.error('[generate-note]', error);
    return NextResponse.json(
      { error: error?.message || 'Error al generar la nota.' },
      { status: 500 }
    );
  }
}
