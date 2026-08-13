import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { construirAlertas, alertasComoTexto } from '../../../lib/alerts';

/**
 * Redacción de nota clínica a partir de la transcripción.
 *
 * Principio rector: el modelo redacta únicamente sobre lo que consta en
 * la transcripción. No infiere diagnósticos ni completa datos faltantes.
 *
 * Los apartados que no se abordaron durante la consulta se omiten por
 * completo — no se escriben con leyendas de ausencia. Una nota clínica
 * debe leerse como la escribiría un profesional, no como un formulario
 * con huecos.
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
    estructura: ['ESTADO ACTUAL', 'HALLAZGOS', 'ANÁLISIS', 'CONDUCTA A SEGUIR']
  }
};

function construirSystem(paciente, plantilla) {
  const p = paciente || {};
  const alertas = construirAlertas(p);

  const contexto = [
    p.name          ? `Paciente: ${p.name}` : null,
    p.age           ? `Edad: ${p.age} años` : null,
    p.record_number ? `Expediente: ${p.record_number}` : null,
    p.concern       ? `Motivo registrado en su historia clínica: ${p.concern}` : null,
    p.allergies     ? `Alergias declaradas: ${p.allergies}` : null,
    p.conditions    ? `Padecimientos declarados: ${p.conditions}` : null,
    p.meds          ? `Medicación actual: ${p.meds}` : null,
    p.pregnant      ? 'Embarazo declarado: SÍ' : null,
    p.smoke         ? `Tabaquismo: ${typeof p.smoke === 'string' ? p.smoke : 'sí'}` : null,
    p.doctor_plan   ? `Plan de tratamiento vigente: ${p.doctor_plan}` : null
  ].filter(Boolean).join('\n');

  const t = PLANTILLAS[plantilla] || PLANTILLAS.consultation;

  const bloqueAlertas = alertas.length
    ? `\nALERTAS CLÍNICAS DEL EXPEDIENTE\n${alertasComoTexto(alertas)}\n\nSi durante la consulta se abordó algún tema que estas alertas condicionan —fármacos, anestesia, radiografías, plan quirúrgico— consígnalo en la nota. No inventes que se discutieron si no fue así.\n`
    : '';

  return `Eres asistente de documentación clínica en Prime Advanced Dentistry, clínica de implantología y rehabilitación oral en Cancún, México.

Tu tarea es redactar una nota clínica a partir de la transcripción de una consulta.

CONTEXTO DEL PACIENTE
${contexto || 'Sin contexto previo disponible.'}
${bloqueAlertas}
ESTRUCTURA DE REFERENCIA — "${t.nombre}"
${t.estructura.map(s => `## ${s}`).join('\n')}

CÓMO USAR LA ESTRUCTURA

Incluye únicamente los apartados que se abordaron durante la consulta.

Si un apartado no se trató, omítelo por completo: no escribas el encabezado, no escribas "no consignado", no escribas "sin datos" ni ninguna leyenda equivalente. Simplemente no aparece en la nota.

Una nota con tres apartados bien documentados es mejor que una con siete, cuatro de ellos vacíos. La nota debe leerse como la escribiría un profesional, no como un formulario con huecos.

REGLAS DE REDACCIÓN

Redacta únicamente sobre lo que consta en la transcripción. No infieras diagnósticos, no completes datos que no se dijeron y no agregues hallazgos que no se mencionaron. Una nota clínica es un documento legal: lo que escribes debe poder sostenerse frente a lo grabado.

El contexto del paciente sirve para interpretar correctamente lo que oyes —por ejemplo, reconocer el nombre de un fármaco que ya toma— no para rellenar la nota con información que no se trató en esta consulta.

Usa terminología odontológica precisa y español clínico formal. Redacta en tercera persona.

Si en la transcripción se mencionan cifras relevantes —torque, milímetros, dosis, número de órgano dentario— consígnalas textualmente.

Si detectas algo clínicamente relevante que quedó ambiguo en la transcripción, agrégalo al final bajo "## OBSERVACIONES PARA REVISIÓN" en lugar de interpretarlo por tu cuenta.

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

    const note = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');

    return NextResponse.json({ note, model: MODEL, template: template || 'consultation' });

  } catch (error) {
    console.error('[generate-note]', error);
    return NextResponse.json(
      { error: error?.message || 'Error al generar la nota.' },
      { status: 500 }
    );
  }
}
