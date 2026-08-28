/**
 * Alertas médicas — misma lógica que la Historia Clínica.
 *
 * Estas alertas se inyectan en el contexto del modelo antes de
 * cualquier consulta clínica. Un embarazo declarado o un
 * anticoagulante no pueden depender de que el modelo los note
 * leyendo un campo de texto: se le entregan explícitos.
 */

/* ─── Coincidencia tolerante a errores de escritura ───
   Los pacientes escriben "penecillin", "amoxicilina" o "codeína" de
   formas impredecibles. Una búsqueda literal falla ante cualquier
   errata, y en un campo de alergias eso es inaceptable.
   Se combina búsqueda directa con distancia de edición por palabra. */

const TRIVIALES = ['', 'no', 'none', 'ninguna', 'ninguno', 'n/a', 'na', '-', '--', 'nada', 'sin', 'nan', 'no se', 'nose'];

function normTxt(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');  // quita acentos
}

function editDist(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const m = a.length, n = b.length;
  let prev = Array.from({length: n + 1}, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

function fuzzyHas(texto, terminos) {
  const t = normTxt(texto);
  if (!t) return false;
  const palabras = t.split(/[^a-z0-9]+/).filter(w => w.length > 3);
  return terminos.some(term => {
    const q = normTxt(term);
    if (t.includes(q)) return true;                 // coincidencia directa
    // Tolerancia: 1 error en palabras cortas, 2 en palabras largas
    const margen = q.length >= 9 ? 2 : (q.length >= 6 ? 1 : 0);
    if (margen === 0) return false;
    return palabras.some(w => editDist(w, q) <= margen);
  });
}

export function buildAlerts(p = {}) {
  const al = String(p.allergies  || '').toLowerCase();
  const co = String(p.conditions || '').toLowerCase();
  const me = String(p.meds       || '').toLowerCase();
  const su = String(p.surgeries  || '').toLowerCase();
  // Los antecedentes cardiacos pueden constar como padecimiento o como
  // cirugía previa. Se revisan ambos campos.
  const cs = co + ' ' + su;
  const r = [];
  // Rastrea si algún padecimiento declarado fue reconocido por el catálogo.
  let condMatched = false;

  const alergiaPenicilina = fuzzyHas(al, ['penicilina','penicillin','penicil','amoxicilina','amoxicillin','ampicilina','ampicillin','betalactamico','cefalosporina','cephalosporin']);

  // Esquema de profilaxis. Si hay alergia a penicilina se omite la amoxicilina.
  const PROFILAXIS = alergiaPenicilina
    ? 'Profilaxis antibiótica indicada: clindamicina 600 mg o azitromicina 500 mg, dosis única vía oral 1 hora antes del procedimiento. Amoxicilina contraindicada por alergia declarada.'
    : 'Profilaxis antibiótica indicada: amoxicilina 2 g, clindamicina 600 mg o azitromicina 500 mg, dosis única vía oral 1 hora antes del procedimiento.';

  // ═════════════════════════════════════════════════════════════
  // ALERGIAS
  // Toda alergia declarada genera alerta, esté o no en el catálogo.
  // La ortografía del paciente no es confiable, por eso además de la
  // búsqueda directa se usa tolerancia a errores de escritura.
  // ═════════════════════════════════════════════════════════════
  let allergyMatched = false;
  const alTxt = String(p.allergies||'').trim();

  if (fuzzyHas(al, ['penicilina','penicillin','penicil','amoxicilina','amoxicillin','ampicilina','ampicillin','betalactamico','beta-lactam','cefalosporina','cephalosporin','augmentin'])) {
    allergyMatched = true;
    r.push({ t:'red', m:'ALERGIA A PENICILINA O BETALACTÁMICOS — contraindicadas amoxicilina, ampicilina y cefalosporinas. Usar clindamicina o azitromicina.' });
  }
  if (fuzzyHas(al, ['codeina','codeine','opioide','opioid','morfina','morphine','tramadol','hidrocodona','hydrocodone','oxicodona','oxycodone'])) {
    allergyMatched = true;
    r.push({ t:'red', m:'ALERGIA A OPIOIDES — contraindicados codeína, tramadol y derivados. Planificar analgesia alternativa antes del procedimiento.' });
  }
  if (fuzzyHas(al, ['aine','nsaid','aspirina','aspirin','ibuprofeno','ibuprofen','naproxeno','naproxen','ketorolaco','ketorolac','diclofenaco','diclofenac','acido acetilsalicilico'])) {
    allergyMatched = true;
    r.push({ t:'red', m:'ALERGIA A AINE — contraindicados ibuprofeno, naproxeno, ketorolaco y aspirina. Valorar analgesia alternativa.' });
  }
  if (fuzzyHas(al, ['paracetamol','acetaminofen','acetaminophen','tylenol'])) {
    allergyMatched = true;
    r.push({ t:'red', m:'ALERGIA A PARACETAMOL — contraindicado. Revisar el esquema analgésico completo.' });
  }
  if (fuzzyHas(al, ['lidocaina','lidocaine','articaina','articaine','mepivacaina','mepivacaine','benzocaina','benzocaine','anestesia local','anestesico local','local anesthetic','xylocaine'])) {
    allergyMatched = true;
    r.push({ t:'red', m:'ALERGIA A ANESTÉSICO LOCAL — CRÍTICO. Precisar el fármaco implicado y considerar interconsulta con alergología antes de cualquier procedimiento.' });
  }
  if (fuzzyHas(al, ['clindamicina','clindamycin','azitromicina','azithromycin','eritromicina','erythromycin','macrolido','macrolide'])) {
    allergyMatched = true;
    r.push({ t:'red', m:'ALERGIA A CLINDAMICINA O MACRÓLIDOS — limita las opciones de profilaxis antibiótica. Coordinar el esquema con el médico tratante.' });
  }
  if (fuzzyHas(al, ['latex','latexs','guantes'])) {
    allergyMatched = true;
    r.push({ t:'red', m:'ALERGIA AL LÁTEX — usar protocolo libre de látex: guantes, dique de goma y material alternativo.' });
  }
  if (fuzzyHas(al, ['clorhexidina','chlorhexidine','peridex'])) {
    allergyMatched = true;
    r.push({ t:'red', m:'ALERGIA A CLORHEXIDINA — evitar enjuagues y antisépticos que la contengan. Riesgo de reacción anafiláctica.' });
  }
  if (fuzzyHas(al, ['yodo','iodine','povidona','povidone','betadine','isodine'])) {
    allergyMatched = true;
    r.push({ t:'yellow', m:'Alergia al yodo o povidona — seleccionar antiséptico alternativo.' });
  }
  if (fuzzyHas(al, ['sulfa','sulfamida','sulfonamida','sulfonamide','bactrim','trimetoprim'])) {
    allergyMatched = true;
    r.push({ t:'yellow', m:'Alergia a sulfas — verificar antes de prescribir cualquier antimicrobiano.' });
  }
  if (fuzzyHas(al, ['niquel','nickel','metal','cromo','cobalto','cobalt'])) {
    allergyMatched = true;
    r.push({ t:'yellow', m:'Alergia a metales — relevante para la selección de aleaciones protésicas y componentes de implante.' });
  }

  // Red de seguridad: cualquier alergia declarada que no fue reconocida
  if (alTxt && !TRIVIALES.includes(al.trim()) && !allergyMatched) {
    r.push({ t:'red', m:'ALERGIA DECLARADA NO CLASIFICADA: "' + alTxt + '". El sistema no la reconoce en su catálogo. Verificar con el paciente y confirmar antes de prescribir cualquier fármaco.' });
  }


  // ─── Indicaciones de profilaxis antibiótica ───
  if (cs.includes('stent'))
    r.push({ t:'red', m:'Stent coronario. ' + PROFILAXIS });
  if (cs.includes('válvula') || cs.includes('valvula') || cs.includes('valvular') ||
      cs.includes('valve') || cs.includes('recambio valv'))
    r.push({ t:'red', m:'Válvula cardiaca protésica o cirugía valvular. ' + PROFILAXIS });
  if (cs.includes('endocarditis'))
    r.push({ t:'red', m:'Antecedente de endocarditis infecciosa. ' + PROFILAXIS });
  if (cs.includes('cardiopatía congénita') || cs.includes('cardiopatia congenita') ||
      cs.includes('congenital heart'))
    r.push({ t:'red', m:'Cardiopatía congénita. ' + PROFILAXIS });
  if (cs.includes('trasplante card') || cs.includes('transplante card') ||
      cs.includes('heart transplant'))
    r.push({ t:'red', m:'Trasplante cardiaco. ' + PROFILAXIS });
  if (cs.includes('bypass') || cs.includes('baipás') || cs.includes('revasculariz'))
    r.push({ t:'red', m:'Cirugía de revascularización coronaria. ' + PROFILAXIS });

  // ─── Prótesis articular: NO requiere profilaxis ───
  if (su.includes('prótesis de cadera') || su.includes('protesis de cadera') ||
      su.includes('prótesis de rodilla') || su.includes('protesis de rodilla') ||
      su.includes('prótesis articular') || su.includes('protesis articular') ||
      su.includes('artroplast') || su.includes('hip replacement') ||
      su.includes('knee replacement') || su.includes('joint replacement'))
    r.push({ t:'yellow', m:'Prótesis articular — no requiere profilaxis antibiótica conforme a las guías vigentes.' });

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
    { condMatched = true; r.push({ t:'yellow', m:'Diabetes — protocolo de cicatrización extendido. Valorar control glucémico (HbA1c).' }); }
  if (co.includes('hipert') || co.includes('hypert') || co.includes('presión') ||
      co.includes('high blood') || co.includes('blood pressure'))
    { condMatched = true; r.push({ t:'yellow', m:'Hipertensión — verificar presión arterial antes del procedimiento. Puede requerir ajuste anestésico.' }); }
  if (co.includes('cardio') || co.includes('cardiac') || co.includes('heart') || co.includes('corazón'))
    { condMatched = true; r.push({ t:'yellow', m:'Cardiopatía — puede requerir valoración médica previa al procedimiento.' }); }
  if (co.includes('osteoporos'))
    { condMatched = true; r.push({ t:'yellow', m:'Osteoporosis — valorar densidad ósea. Puede afectar la oseointegración.' }); }
  if (co.includes('tiroi') || co.includes('thyroid'))
    { condMatched = true; r.push({ t:'yellow', m:'Alteración tiroidea — considerar impacto en cicatrización y anestesia.' }); }

  // ─────────────────────────────────────────────────────────────
  // INFECCIOSAS E INMUNOLÓGICAS
  // ─────────────────────────────────────────────────────────────
  if (co.includes('vih') || co.includes('hiv') || co.includes('sida') || co.includes('aids')) {
    condMatched = true;
    r.push({ t:'red', m:'VIH/SIDA — inmunosupresión. Solicitar conteo de CD4 y carga viral recientes. Mayor riesgo de infección, enfermedad periodontal y candidiasis oral; cicatrización comprometida. Con CD4 bajo, valorar profilaxis antibiótica y coordinar con el médico tratante. Precauciones estándar en todo procedimiento.' });
  }
  if (co.includes('hepatitis b') || co.includes('hepatitis c') || co.includes('vhb') || co.includes('vhc')) {
    condMatched = true;
    r.push({ t:'red', m:'Hepatitis viral — valorar función hepática y coagulación (TP/INR) antes de cirugía. Ajustar fármacos de metabolismo hepático; limitar paracetamol. Precauciones estándar.' });
  }
  if (co.includes('tuberculos') || co.includes('tuberculosis')) {
    condMatched = true;
    r.push({ t:'red', m:'Tuberculosis — si está activa, diferir tratamiento electivo y coordinar con el médico tratante. Precauciones respiratorias ante procedimientos que generen aerosoles.' });
  }
  if (co.includes('inmunosupres') || co.includes('inmunodeficien') || co.includes('immunosupp'))
    { condMatched = true; r.push({ t:'red', m:'Inmunosupresión — mayor riesgo de infección y cicatrización retardada. Valorar profilaxis antibiótica y coordinar con el médico tratante.' }); }
  if (co.includes('trasplante') || co.includes('transplante') || co.includes('transplant'))
    { condMatched = true; r.push({ t:'red', m:'Receptor de trasplante — inmunosupresión farmacológica. Coordinar con el equipo de trasplante antes de cualquier procedimiento invasivo.' }); }

  // ─────────────────────────────────────────────────────────────
  // ONCOLÓGICAS
  // ─────────────────────────────────────────────────────────────
  if (co.includes('radioterapia') || co.includes('radiaci') || co.includes('radiotherapy') || co.includes('radiation'))
    { condMatched = true; r.push({ t:'red', m:'Antecedente de radioterapia — si el campo irradiado incluye cabeza y cuello, riesgo de osteorradionecrosis. Extracciones e implantes en zona irradiada requieren valoración especializada.' }); }
  if (co.includes('quimioterap') || co.includes('chemotherap'))
    { condMatched = true; r.push({ t:'red', m:'Quimioterapia — inmunosupresión, mucositis y trombocitopenia. Solicitar biometría hemática reciente y coordinar tiempos con oncología.' }); }
  if (co.includes('cáncer') || co.includes('cancer') || co.includes('carcinoma') || co.includes('tumor') || co.includes('neoplasia'))
    { condMatched = true; r.push({ t:'yellow', m:'Antecedente oncológico — precisar tipo, estadio y tratamiento recibido. Coordinar con oncología antes de procedimientos invasivos.' }); }
  if (co.includes('leucemia') || co.includes('linfoma') || co.includes('mieloma') || co.includes('leukemia') || co.includes('lymphoma'))
    { condMatched = true; r.push({ t:'red', m:'Neoplasia hematológica — riesgo de sangrado e infección. Requiere biometría hemática y valoración por hematología antes de cirugía.' }); }

  // ─────────────────────────────────────────────────────────────
  // HEMATOLÓGICAS
  // ─────────────────────────────────────────────────────────────
  if (co.includes('hemofilia') || co.includes('hemophilia') || co.includes('von willebrand') || co.includes('coagulopat'))
    { condMatched = true; r.push({ t:'red', m:'Trastorno de la coagulación — riesgo hemorrágico significativo. Requiere valoración por hematología y probable reposición de factores antes de cualquier procedimiento.' }); }
  if (co.includes('trombocitopen') || co.includes('plaquetas baj'))
    { condMatched = true; r.push({ t:'red', m:'Trombocitopenia — verificar conteo plaquetario antes de cirugía. Riesgo hemorrágico aumentado.' }); }
  if (co.includes('anemia'))
    { condMatched = true; r.push({ t:'yellow', m:'Anemia — valorar hemoglobina antes de procedimientos prolongados. Puede afectar la cicatrización y la tolerancia a la sedación.' }); }

  // ─────────────────────────────────────────────────────────────
  // RENALES Y HEPÁTICAS
  // ─────────────────────────────────────────────────────────────
  if (co.includes('renal') || co.includes('riñón') || co.includes('riñon') || co.includes('diális') || co.includes('dialis') || co.includes('kidney') || co.includes('dialysis'))
    { condMatched = true; r.push({ t:'red', m:'Enfermedad renal — ajustar dosis de fármacos de eliminación renal y evitar AINE. Tendencia al sangrado. Si recibe diálisis, programar el día posterior a la sesión.' }); }
  if (co.includes('cirrosis') || co.includes('hepatopat') || co.includes('hígado') || co.includes('higado') || co.includes('liver'))
    { condMatched = true; r.push({ t:'red', m:'Hepatopatía — riesgo de coagulopatía. Solicitar TP/INR y ajustar fármacos de metabolismo hepático.' }); }

  // ─────────────────────────────────────────────────────────────
  // ENDOCRINAS
  // ─────────────────────────────────────────────────────────────
  if (co.includes('suprarrenal') || co.includes('addison') || co.includes('cushing') || co.includes('adrenal'))
    { condMatched = true; r.push({ t:'red', m:'Patología suprarrenal — riesgo de crisis adrenal ante el estrés quirúrgico. Valorar suplementación con corticoides junto al médico tratante.' }); }
  if (me.includes('prednison') || me.includes('corticoide') || me.includes('dexameta') || me.includes('hidrocortison') || me.includes('prednisolon'))
    { r.push({ t:'yellow', m:'Corticoterapia — inmunosupresión y posible supresión del eje suprarrenal. Valorar cobertura antibiótica y suplementación esteroidea en cirugía extensa.' }); }

  // ─────────────────────────────────────────────────────────────
  // NEUROLÓGICAS
  // ─────────────────────────────────────────────────────────────
  if (co.includes('epilep') || co.includes('convulsi') || co.includes('seizure'))
    { condMatched = true; r.push({ t:'yellow', m:'Epilepsia — confirmar apego al tratamiento anticonvulsivo. Reducir factores desencadenantes; algunos anticonvulsivos causan hiperplasia gingival.' }); }
  if (co.includes('parkinson'))
    { condMatched = true; r.push({ t:'yellow', m:'Enfermedad de Parkinson — el temblor puede dificultar el procedimiento y la higiene oral. Considerar citas cortas y apoyo del cuidador.' }); }
  if (co.includes('alzheimer') || co.includes('demencia') || co.includes('dementia'))
    { condMatched = true; r.push({ t:'yellow', m:'Deterioro cognitivo — verificar capacidad para otorgar consentimiento informado. Puede requerirse representante legal.' }); }
  if (co.includes('evc') || co.includes('acv') || co.includes('embolia') || co.includes('infarto cerebral') || co.includes('stroke'))
    { condMatched = true; r.push({ t:'yellow', m:'Antecedente de evento vascular cerebral — frecuentemente asociado a antiagregación o anticoagulación. Monitorizar presión arterial durante el procedimiento.' }); }

  // ─────────────────────────────────────────────────────────────
  // RESPIRATORIAS
  // ─────────────────────────────────────────────────────────────
  if (co.includes('asma') || co.includes('asthma'))
    { condMatched = true; r.push({ t:'yellow', m:'Asma — solicitar que el paciente traiga su broncodilatador. Evitar AINE si existe sensibilidad a la aspirina; precaución con la sedación.' }); }
  if (co.includes('epoc') || co.includes('copd') || co.includes('enfisema') || co.includes('bronquitis crón'))
    { condMatched = true; r.push({ t:'yellow', m:'EPOC — evitar posición supina prolongada. Precaución con sedantes y depresores respiratorios.' }); }
  if (co.includes('apnea'))
    { condMatched = true; r.push({ t:'yellow', m:'Apnea del sueño — riesgo elevado con sedación. Valorar manejo de la vía aérea antes de cualquier procedimiento sedado.' }); }

  // ─────────────────────────────────────────────────────────────
  // AUTOINMUNES
  // ─────────────────────────────────────────────────────────────
  if (co.includes('lupus'))
    { condMatched = true; r.push({ t:'yellow', m:'Lupus eritematoso — valorar inmunosupresores y corticoides en uso. Posibles lesiones orales y mayor riesgo de infección.' }); }
  if (co.includes('artritis reumat') || co.includes('rheumatoid'))
    { condMatched = true; r.push({ t:'yellow', m:'Artritis reumatoide — valorar inmunosupresores y afectación de la articulación temporomandibular. Limitación de apertura bucal frecuente.' }); }
  if (co.includes('sjögren') || co.includes('sjogren'))
    { condMatched = true; r.push({ t:'yellow', m:'Síndrome de Sjögren — xerostomía marcada, mayor riesgo de caries e infección por Candida. Considerar sustitutos salivales.' }); }
  if (co.includes('crohn') || co.includes('colitis ulcer') || co.includes('inflamatoria intestinal'))
    { condMatched = true; r.push({ t:'yellow', m:'Enfermedad inflamatoria intestinal — frecuentemente en tratamiento inmunosupresor. Posibles lesiones orales asociadas.' }); }

  // ─────────────────────────────────────────────────────────────
  // OTRAS
  // ─────────────────────────────────────────────────────────────
  if (co.includes('reflujo') || co.includes('erge') || co.includes('gerd') || co.includes('acidez'))
    { condMatched = true; r.push({ t:'yellow', m:'Reflujo gastroesofágico — erosión dental ácida. Evitar posición supina prolongada durante el procedimiento.' }); }
  if (co.includes('fibromialgia'))
    { condMatched = true; r.push({ t:'yellow', m:'Fibromialgia — mayor sensibilidad al dolor. Considerar citas cortas y manejo analgésico reforzado.' }); }

  // ─── Hábitos ───
  if (p.smoke)
    r.push({ t:'yellow', m:'Fumador activo — mayor riesgo de falla del implante y cicatrización retardada. Recomendar cese tabáquico.' });

  // ─── Embarazo ───
  if (p.pregnant)
    r.push({ t:'red', m:'EMBARAZO O LACTANCIA DECLARADOS — diferir procedimiento electivo. Contraindicados radiografías no esenciales, sedación y varios fármacos.' });

  // ─── Medicamento declarado no reconocido ───
  const meTxt = String(p.meds||'').trim();
  const medConocido = r.some(x => /warfarina|xarelto|eliquis|pradaxa|plavix|bifosfonatos|corticoterapia/i.test(x.m));
  if (meTxt && !TRIVIALES.includes(me.trim()) && !medConocido) {
    r.push({ t:'yellow', m:'Medicamento declarado sin clasificación automática: "' + meTxt + '". Verificar interacciones y relevancia odontológica antes de prescribir.' });
  }

  // ─────────────────────────────────────────────────────────────
  // RED DE SEGURIDAD
  // Un padecimiento no reconocido nunca debe pasar en silencio.
  // ─────────────────────────────────────────────────────────────
  const coLimpio = co.trim();
  if (coLimpio && !TRIVIALES.includes(coLimpio) && !condMatched) {
    r.push({ t:'yellow', m:'Padecimiento declarado sin clasificación automática: "' + String(p.conditions||'').trim() + '". Revisar manualmente su relevancia para el tratamiento odontológico.' });
  }

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
