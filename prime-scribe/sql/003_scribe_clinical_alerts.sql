-- ══════════════════════════════════════════════════════════════════════
-- PRIME ADVANCED DENTISTRY — Migración 003
-- Exposición de datos de riesgo clínico a Prime Scribe
--
-- MOTIVO
--   La vista `scribe_patients` omitía `pregnant`, `smoke`, `alcohol` y
--   `drugs`. En consecuencia, Prime Scribe no podía advertir sobre un
--   embarazo declarado al responder dudas de tratamiento.
--   Esto corrige esa omisión.
--
-- GARANTÍAS
--   · Solo reemplaza una vista. No toca tablas ni datos.
--   · Aditiva: los campos existentes conservan su nombre y posición.
--   · Idempotente.
--
-- EJECUTAR EN: Supabase → SQL Editor → New query → Run
-- ══════════════════════════════════════════════════════════════════════

-- PostgreSQL no permite reordenar ni renombrar columnas con
-- CREATE OR REPLACE VIEW, así que la vista se elimina y se vuelve a
-- crear. Es seguro: una vista no almacena datos, solo es una consulta
-- con nombre sobre la tabla `patients`.
drop view if exists scribe_patients;

create view scribe_patients as
select
  p.id,
  p.record_number,
  p.name,
  p.age,
  p.dob,
  p.phone,
  p.email,
  p.hotel,
  p.room,
  p.return_date,
  p.concern,
  p.doctor_plan,
  p.doctor_obs,
  p.status,

  -- ─── Antecedentes médicos ───
  p.has_allergies,
  p.allergies,
  p.has_conditions,
  p.conditions,
  p.has_meds,
  p.meds,
  p.has_surgeries,
  p.surgeries,

  -- ─── Factores de riesgo (ausentes en la versión anterior) ───
  p.pregnant,
  p.smoke,
  p.alcohol,
  p.drugs,

  p.created_at,
  (select count(*) from clinical_notes n where n.patient_id = p.id) as notes_count,
  (select max(n.created_at) from clinical_notes n where n.patient_id = p.id) as last_note_at
from patients p
where p.submitted = true
order by p.created_at desc;

comment on view scribe_patients is
  'Vista de solo lectura para Prime Scribe. Incluye antecedentes y factores de riesgo. Excluye firmas, fotografías y consentimientos.';


-- ══════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
-- ══════════════════════════════════════════════════════════════════════

select
  'Migración 003 aplicada' as resultado,
  count(*) as pacientes_visibles,
  count(*) filter (where pregnant) as con_embarazo_declarado,
  count(*) filter (where smoke is not null and smoke <> '') as fumadores
from scribe_patients;
