/**
 * Motor de alertas clínicas.
 *
 * Réplica de la lógica de la Historia Clínica Digital, para que ambos
 * sistemas adviertan exactamente lo mismo ante los mismos datos.
 *
 * Se ejecuta tanto en el servidor (para inyectar las alertas en el
 * contexto del modelo) como en el cliente (para mostrarlas en pantalla).
 */

export function construirAlertas(p) {
  if (!p) return [];

  const al = (p.allergies  || '').toLowerCase();
  const co = (p.conditions || '').toLowerCase();
  const me = (p.meds       || '').toLowerCase();
  const alertas = [];

  // ─── Alergias ───
  if (al.includes('penicil') || al.includes('amoxicil') || al.includes('ampicil')) {
    alertas.push({ nivel: 'roja', texto: 'Alergia a penicilina o amoxicilina — se requiere antibiótico alternativo.' });
  }
  if (al && !['none','no','n/a','ninguna','ninguno'].includes(al.trim()) && !al.includes('penicil')) {
    alertas.push({ nivel: 'amarilla', texto: `Alergia declarada: ${p.allergies}` });
  }

  // ─── Anticoagulantes y antiagregantes ───
  if (me.includes('warfar') || me.includes('coumadin')) {
    alertas.push({ nivel: 'roja', texto: 'Warfarina — riesgo de sangrado quirúrgico. Requiere valoración con cardiología.' });
  }
  if (me.includes('xarelto') || me.includes('rivarox')) {
    alertas.push({ nivel: 'roja', texto: 'Xarelto (rivaroxabán) — anticoagulante. Requiere protocolo de suspensión antes de cirugía.' });
  }
  if (me.includes('eliquis') || me.includes('apixab')) {
    alertas.push({ nivel: 'roja', texto: 'Eliquis (apixabán) — anticoagulante. Requiere protocolo de suspensión antes de cirugía.' });
  }
  if (me.includes('pradaxa') || me.includes('dabigat')) {
    alertas.push({ nivel: 'roja', texto: 'Pradaxa (dabigatrán) — anticoagulante. Requiere protocolo de suspensión.' });
  }
  if (me.includes('plavix') || me.includes('clopido')) {
    alertas.push({ nivel: 'roja', texto: 'Plavix (clopidogrel) — antiagregante. Valorar suspensión con cardiología.' });
  }

  // ─── Bifosfonatos y antirresortivos ───
  if (me.includes('fosamax') || me.includes('alendr') || me.includes('boniva') ||
      me.includes('ibandr')  || me.includes('prolia') || me.includes('denoso') ||
      me.includes('zometa')  || me.includes('zolendr') ||
      me.includes('bisfosfon') || me.includes('bisphosph')) {
    alertas.push({ nivel: 'roja', texto: 'Bifosfonatos o antirresortivos — riesgo de osteonecrosis maxilar (MRONJ). Valoración prequirúrgica obligatoria.' });
  }

  // ─── Padecimientos sistémicos ───
  if (co.includes('diabet')) {
    alertas.push({ nivel: 'amarilla', texto: 'Diabetes — protocolo de cicatrización extendido. Valorar control glucémico (HbA1c).' });
  }
  if (co.includes('hipert') || co.includes('hypert') || co.includes('high blood') || co.includes('presión')) {
    alertas.push({ nivel: 'amarilla', texto: 'Hipertensión — verificar presión arterial antes del procedimiento. Puede requerir ajuste anestésico.' });
  }
  if (co.includes('cardi') || co.includes('heart') || co.includes('corazón')) {
    alertas.push({ nivel: 'amarilla', texto: 'Cardiopatía — puede requerir valoración médica previa al procedimiento.' });
  }
  if (co.includes('osteo')) {
    alertas.push({ nivel: 'amarilla', texto: 'Osteoporosis — valorar densidad ósea. Puede afectar la oseointegración.' });
  }
  if (co.includes('tiroi') || co.includes('thyroid')) {
    alertas.push({ nivel: 'amarilla', texto: 'Alteración tiroidea — considerar impacto en cicatrización y anestesia.' });
  }

  // ─── Factores de riesgo ───
  if (p.smoke) {
    const detalle = typeof p.smoke === 'string' && p.smoke.length > 3 ? ` (${p.smoke})` : '';
    alertas.push({ nivel: 'amarilla', texto: `Tabaquismo activo${detalle} — mayor riesgo de falla del implante y cicatrización retardada.` });
  }
  if (p.pregnant) {
    alertas.push({ nivel: 'roja', texto: 'EMBARAZO DECLARADO — diferir procedimientos electivos hasta después del parto. Contraindicadas radiografías de rutina y ciertos fármacos.' });
  }

  return alertas;
}

/**
 * Formatea las alertas para inyectarlas en el contexto del modelo.
 * Las rojas van primero y en mayúsculas: son las que no pueden pasarse por alto.
 */
export function alertasComoTexto(alertas) {
  if (!alertas.length) return 'Sin alertas clínicas identificadas.';
  const rojas     = alertas.filter(a => a.nivel === 'roja');
  const amarillas = alertas.filter(a => a.nivel === 'amarilla');
  const lineas = [];
  if (rojas.length) {
    lineas.push('ALERTAS ROJAS — atención obligatoria:');
    rojas.forEach(a => lineas.push(`  ⛔ ${a.texto}`));
  }
  if (amarillas.length) {
    if (rojas.length) lineas.push('');
    lineas.push('Alertas amarillas:');
    amarillas.forEach(a => lineas.push(`  ⚠️ ${a.texto}`));
  }
  return lineas.join('\n');
}
