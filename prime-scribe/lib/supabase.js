import { createClient } from '@supabase/supabase-js';

/**
 * Cliente Supabase compartido con la Historia Clínica.
 * Misma base de datos, mismas cuentas, mismas políticas RLS.
 */
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export const EHR_URL =
  process.env.NEXT_PUBLIC_EHR_URL || 'https://luminous-kelpie-7e295b.netlify.app';

/**
 * Bitácora de auditoría — NOM-024-SSA3, ISO 27789.
 * Falla en silencio por diseño: si no se puede registrar el evento,
 * la atención al paciente continúa igual.
 */
export async function audit(action, entity, patientId, details = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('audit_log').insert({
      patient_id:    patientId || null,
      record_number: details.record_number || null,
      action,
      entity:        entity || null,
      entity_id:     details.entity_id ? String(details.entity_id) : null,
      actor_email:   user?.email || null,
      actor_id:      user?.id || null,
      actor_role:    'doctor',
      device:        typeof navigator !== 'undefined' ? navigator.userAgent : null,
      timezone:      'America/Cancun',
      details:       { ...details, source: 'prime_scribe' }
    });
  } catch (e) {
    console.warn('[audit]', e?.message);
  }
}
