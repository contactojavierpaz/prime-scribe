/**
 * Alertas médicas — misma lógica que la Historia Clínica.
 *
 * Estas alertas se inyectan en el contexto del modelo antes de
 * cualquier consulta clínica. Un embarazo declarado o un
 * anticoagulante no pueden depender de que el modelo los note
 * leyendo un campo de texto: se le entregan explícitos.
 */

export function buildAlerts(p = {}) {
  const al = String(p.allergies  || '').toLowerCase();
  const co = String(p.conditions || '').toLowerCase();
  const me = String(p.meds       || '').toLowerCase();
  const r = [];

  // ─── Alergias ───
  if (al.includes('penicil') || al.includes('amoxicil'))
    r.push({ t:'red', m:'Alergia a penicilina/amoxicilina — requiere antibiótico alternativo.' });

  // ─── Anticoagulantes y antiagregantes ───
  if (me.includes('warfar') || me.includes('coumadin'))
    r.push({ t:'red', m:'Warfarina — riesgo de sangrado quirúrgico. Requiere valoración por cardiología.' });
  if (me.includes('xarelto') || me.includes('rivarox'))
    r.push({ t:'red', m:'Xarelto (rivaroxabán) — anticoagulante. Requiere protocolo de suspensión antes de cirugía.' });
  if (me.includes('eliquis') || me.includes('apixab'))
    r.push({ t:'red', m:'Eliquis (apixabán) — anticoagulante. Requiere protocolo de suspensión antes de cirugía.' });
  if (me.includes('pradaxa') || me.includes('dabigat'))
    r.push({ t:'red', m:'Pradaxa (dabigatrán) — anticoagulante. Requiere protocolo de suspensión.' });
  if (me.includes('plavix') || me.includes('clopido'))
    r.push({ t:'red', m:'Plavix (clopidogrel) — antiagregante. Evaluar suspensión con cardiología.' });

  // ─── Bifosfonatos y antirresortivos ───
  if (me.includes('fosamax') || me.includes('alendr') || me.includes('boniva') ||
      me.includes('prolia')  || me.includes('zometa') || me.includes('denosum') ||
      me.includes('bisfosfon') || me.includes('bisphosph'))
    r.push({ t:'red', m:'Bifosfonatos o antirresortivos — riesgo de osteonecrosis mandibular (MRONJ). Valoración prequirúrgica obligatoria.' });

  // ─── Enfermedades sistémicas ───
  if (co.includes('diabet'))
    r.push({ t:'yellow', m:'Diabetes — protocolo de cicatrización extendido. Valorar control glucémico (HbA1c).' });
  if (co.includes('hipert') || co.includes('hypert') || co.includes('presión') ||
      co.includes('high blood') || co.includes('blood pressure'))
    r.push({ t:'yellow', m:'Hipertensión — verificar presión arterial antes del procedimiento. Puede requerir ajuste anestésico.' });
  if (co.includes('cardio') || co.includes('cardiac') || co.includes('heart') || co.includes('corazón'))
    r.push({ t:'yellow', m:'Cardiopatía — puede requerir valoración médica previa al procedimiento.' });
  if (co.includes('osteo'))
    r.push({ t:'yellow', m:'Osteoporosis — valorar densidad ósea. Puede afectar la oseointegración.' });
  if (co.includes('tiroi') || co.includes('thyroid'))
    r.push({ t:'yellow', m:'Alteración tiroidea — considerar impacto en cicatrización y anestesia.' });

  // ─── Hábitos ───
  if (p.smoke)
    r.push({ t:'yellow', m:'Fumador activo — mayor riesgo de falla del implante y cicatrización retardada. Recomendar cese tabáquico.' });

  // ─── Embarazo: contraindicación para procedimiento electivo ───
  if (p.pregnant)
    r.push({ t:'red', m:'EMBARAZO O LACTANCIA DECLARADOS — diferir procedimiento electivo. Contraindicados radiografías no esenciales, sedación y varios fármacos.' });

  return r;
}

/** Bloque de texto para inyectar en el contexto del modelo. */
export function alertsToPrompt(alerts) {
  if (!alerts?.length) return 'Sin alertas médicas identificadas en el expediente.';
  const rojas    = alerts.filter(a => a.t === 'red');
  const amarillas = alerts.filter(a => a.t === 'yellow');
  const bloques = [];
  if (rojas.length)
    bloques.push('ALERTAS ROJAS (críticas):\n' + rojas.map(a => `- ${a.m}`).join('\n'));
  if (amarillas.length)
    bloques.push('ALERTAS AMARILLAS:\n' + amarillas.map(a => `- ${a.m}`).join('\n'));
  return bloques.join('\n\n');
}
