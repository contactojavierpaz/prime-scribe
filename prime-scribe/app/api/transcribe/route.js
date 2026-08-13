import OpenAI from 'openai';
import { NextResponse } from 'next/server';

/**
 * Transcripción de audio clínico con Whisper.
 *
 * La llave vive del lado del servidor: el navegador nunca la ve.
 * No se fija idioma a propósito — Whisper lo detecta solo, que es lo
 * que necesita una clínica donde el idioma varía según el paciente
 * e incluso cambia dentro de la misma consulta.
 */

export const maxDuration = 300; // consultas largas necesitan margen

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Vocabulario de referencia: mejora notablemente el reconocimiento
// de terminología dental y nombres de fármacos.
const PROMPT_CONTEXTO = [
  'Consulta de odontología e implantología dental.',
  'Términos frecuentes: implante dental, carga inmediata, injerto óseo,',
  'zirconia, PMMA, oseointegración, alveoloplastia, elevación de seno,',
  'arcada completa, full arch, pilar, corona, carilla, conducto radicular,',
  'periodontitis, torque, Neodent, Straumann, Nobel Biocare.',
  'Fármacos: amoxicilina, clindamicina, ibuprofeno, metformina, lisinopril,',
  'warfarina, Xarelto, Eliquis, Plavix, alendronato, Prolia.'
].join(' ');

export async function POST(request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'Falta configurar OPENAI_API_KEY en el servidor.' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const audio = formData.get('audio');

    if (!audio) {
      return NextResponse.json({ error: 'No se recibió audio.' }, { status: 400 });
    }

    // Whisper acepta hasta 25 MB. La grabación va comprimida a 24 kbps,
    // así que una consulta de 30 minutos ronda los 5 MB.
    const MAX = 25 * 1024 * 1024;
    if (audio.size > MAX) {
      return NextResponse.json(
        { error: 'La grabación excede 25 MB. Divide la consulta en partes.' },
        { status: 413 }
      );
    }

    const file = new File([audio], 'consulta.webm', {
      type: audio.type || 'audio/webm'
    });

    const result = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      prompt: PROMPT_CONTEXTO,
      response_format: 'verbose_json'
      // Sin `language`: detección automática.
    });

    return NextResponse.json({
      transcript: result.text,
      language: result.language || null,
      duration: result.duration || null
    });

  } catch (error) {
    console.error('[transcribe]', error);
    return NextResponse.json(
      { error: error?.message || 'Error al transcribir el audio.' },
      { status: 500 }
    );
  }
}
