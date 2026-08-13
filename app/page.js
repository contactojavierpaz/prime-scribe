'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase, EHR_URL, audit } from '../lib/supabase';
import { buildAlerts } from '../lib/alerts';

/* ══════════════════════════════════════════════════════════
   PRIME SCRIBE
   Grabación, transcripción y redacción de notas clínicas.

   El paciente llega seleccionado desde la Historia Clínica.
   Esta app no mantiene su propia lista de pacientes.
   ══════════════════════════════════════════════════════════ */

const PLANTILLAS = [
  { id: 'consultation', nombre: 'Consulta inicial' },
  { id: 'procedure',    nombre: 'Nota de procedimiento' },
  { id: 'followup',     nombre: 'Nota de seguimiento' },
  { id: 'evolution',    nombre: 'Nota de evolución' }
];

const SUGERENCIAS = [
  'Hazme el reporte de esta cita',
  'Redacta las indicaciones postoperatorias',
  'Resume los puntos clave de la consulta',
  '¿Qué debo vigilar en el seguimiento de este caso?'
];

export default function PrimeScribe() {
  // Sesión
  const [user, setUser] = useState(null);
  const [cargandoSesion, setCargandoSesion] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorLogin, setErrorLogin] = useState('');
  const [entrando, setEntrando] = useState(false);

  // Paciente
  const [paciente, setPaciente] = useState(null);
  const [errorPaciente, setErrorPaciente] = useState('');

  // Grabación
  const [grabando, setGrabando] = useState(false);
  const [pausado, setPausado] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [audioBlob, setAudioBlob] = useState(null);
  const mediaRecorder = useRef(null);
  const chunks = useRef([]);
  const timer = useRef(null);
  const stream = useRef(null);

  // Transcripción y nota
  const [transcripcion, setTranscripcion] = useState('');
  const [idiomaDetectado, setIdiomaDetectado] = useState('');
  const [transcribiendo, setTranscribiendo] = useState(false);
  const [plantilla, setPlantilla] = useState('consultation');
  const [nota, setNota] = useState('');
  const [generando, setGenerando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState(null);

  // Chat
  const [tab, setTab] = useState('nota');
  const [mensajes, setMensajes] = useState([]);
  const [entrada, setEntrada] = useState('');
  const [pensando, setPensando] = useState(false);
  const [imagenes, setImagenes] = useState([]);      // adjuntos pendientes
  const [dictando, setDictando] = useState(false);   // micrófono del chat
  const [transcribiendoChat, setTranscribiendoChat] = useState(false);
  const [guardandoChat, setGuardandoChat] = useState(false);
  const chatRef = useRef(null);
  const fileRef = useRef(null);
  const chatRecorder = useRef(null);
  const chatChunks = useRef([]);
  const chatStream = useRef(null);

  // Notas previas
  const [notasPrevias, setNotasPrevias] = useState([]);

  /* ─── Sesión ─── */
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      setCargandoSesion(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user || null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function iniciarSesion() {
    if (!email || !password) { setErrorLogin('Ingresa correo y contraseña.'); return; }
    setEntrando(true); setErrorLogin('');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setErrorLogin(
        error.message === 'Invalid login credentials'
          ? 'Correo o contraseña incorrectos.'
          : error.message
      );
    } else {
      setUser(data.user);
      setPassword('');
    }
    setEntrando(false);
  }

  async function cerrarSesion() {
    await supabase.auth.signOut();
    setUser(null);
  }

  /* ─── Cargar el paciente que llega por URL ─── */
  const cargarPaciente = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('patient_id');
    if (!id) { setErrorPaciente('sin_paciente'); return; }

    const { data, error } = await supabase
      .from('scribe_patients').select('*').eq('id', id).single();

    if (error || !data) {
      setErrorPaciente('no_encontrado');
      return;
    }
    setPaciente(data);
    audit('VIEW', 'patient', data.id, { record_number: data.record_number });
    cargarNotasPrevias(data.id);
  }, []);

  useEffect(() => { if (user) cargarPaciente(); }, [user, cargarPaciente]);

  async function cargarNotasPrevias(patientId) {
    const { data } = await supabase
      .from('clinical_notes')
      .select('id, note_type, title, content, status, author_name, author_email, created_at')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(20);
    setNotasPrevias(data || []);
  }

  /* ─── Grabación ─── */
  async function iniciarGrabacion() {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
      });

      // 24 kbps en opus: voz nítida y ~5 MB por media hora,
      // holgadamente dentro del límite de 25 MB de Whisper.
      const opciones = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 24000 }
        : {};

      const mr = new MediaRecorder(stream.current, opciones);
      chunks.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunks.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' });
        setAudioBlob(blob);
        stream.current?.getTracks().forEach(t => t.stop());
      };
      mr.start(1000);
      mediaRecorder.current = mr;

      setGrabando(true); setPausado(false); setSegundos(0);
      setAudioBlob(null); setTranscripcion(''); setNota(''); setAviso(null);
      timer.current = setInterval(() => setSegundos(s => s + 1), 1000);
    } catch (e) {
      setAviso({ tipo: 'red', texto: 'No se pudo acceder al micrófono. Revisa los permisos del navegador.' });
    }
  }

  function pausarGrabacion() {
    if (!mediaRecorder.current) return;
    if (pausado) {
      mediaRecorder.current.resume();
      timer.current = setInterval(() => setSegundos(s => s + 1), 1000);
      setPausado(false);
    } else {
      mediaRecorder.current.pause();
      clearInterval(timer.current);
      setPausado(true);
    }
  }

  function detenerGrabacion() {
    if (!mediaRecorder.current) return;
    mediaRecorder.current.stop();
    clearInterval(timer.current);
    setGrabando(false); setPausado(false);
  }

  function descartarGrabacion() {
    setAudioBlob(null); setTranscripcion(''); setNota(''); setSegundos(0); setAviso(null);
  }

  const formatoTiempo = s =>
    `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;

  /* ─── Transcripción ─── */
  async function transcribir() {
    if (!audioBlob) return;
    setTranscribiendo(true); setAviso(null);
    try {
      const fd = new FormData();
      fd.append('audio', audioBlob, 'consulta.webm');
      const r = await fetch('/api/transcribe', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Error al transcribir');

      setTranscripcion(d.transcript || '');
      setIdiomaDetectado(d.language || '');

      if (paciente) {
        await registrarTrabajoIA('transcription', { chars: (d.transcript||'').length, language: d.language });
        audit('AI_GENERATE', 'note', paciente.id, {
          record_number: paciente.record_number, job_type: 'transcription'
        });
      }
    } catch (e) {
      setAviso({ tipo: 'red', texto: e.message });
    }
    setTranscribiendo(false);
  }

  /* ─── Generación de nota ─── */
  async function generarNota() {
    if (!transcripcion.trim()) return;
    setGenerando(true); setAviso(null);
    try {
      const r = await fetch('/api/generate-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: transcripcion, patient: paciente, template: plantilla })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Error al generar la nota');
      setNota(d.note || '');
      if (paciente) await registrarTrabajoIA('summary', { template: plantilla, model: d.model });
    } catch (e) {
      setAviso({ tipo: 'red', texto: e.message });
    }
    setGenerando(false);
  }

  async function registrarTrabajoIA(jobType, extra = {}) {
    try {
      await supabase.from('ai_jobs').insert({
        patient_id:    paciente?.id,
        record_number: paciente?.record_number,
        service:       'prime_scribe',
        job_type:      jobType,
        status:        'completed',
        model:         extra.model || (jobType === 'transcription' ? 'whisper-1' : 'claude-sonnet-5'),
        output:        extra,
        requested_by:  user?.email,
        review_status: 'unreviewed',   // toda salida de IA nace sin revisar
        completed_at:  new Date().toISOString()
      });
    } catch (e) { console.warn('[ai_jobs]', e?.message); }
  }

  /* ─── Guardar la nota ─── */
  async function guardarNota(status) {
    if (!paciente || !nota.trim()) return;
    setGuardando(true); setAviso(null);
    try {
      const { data, error } = await supabase.from('clinical_notes').insert({
        patient_id:    paciente.id,
        record_number: paciente.record_number,
        note_type:     plantilla,
        title:         PLANTILLAS.find(p => p.id === plantilla)?.nombre || 'Nota clínica',
        content:       nota,
        transcript:    transcripcion || null,
        source:        transcripcion ? 'scribe_ai' : 'manual',
        ai_model:      transcripcion ? 'claude-sonnet-5' : null,
        author_email:  user?.email,
        author_name:   user?.email?.split('@')[0] || null,
        author_role:   'doctor',
        status,
        signed_at:     status === 'signed' ? new Date().toISOString() : null,
        signed_by:     status === 'signed' ? user?.email : null
      }).select().single();

      if (error) throw error;

      await audit(status === 'signed' ? 'NOTE_SIGN' : 'NOTE_ADD', 'note', paciente.id, {
        record_number: paciente.record_number, entity_id: data.id, note_type: plantilla
      });

      setAviso({
        tipo: 'green',
        texto: status === 'signed'
          ? 'Nota firmada y guardada en el expediente.'
          : 'Nota guardada como borrador.'
      });
      cargarNotasPrevias(paciente.id);
    } catch (e) {
      setAviso({ tipo: 'red', texto: e.message });
    }
    setGuardando(false);
  }


  /* ─── Imágenes adjuntas al chat ─── */
  async function adjuntarImagenes(files) {
    const lista = Array.from(files || []).filter(f => f.type.startsWith('image/'));
    if (!lista.length) return;

    const nuevas = [];
    for (const file of lista.slice(0, 4)) {
      if (file.size > 5 * 1024 * 1024) {
        setAviso({ tipo: 'red', texto: `"${file.name}" excede 5 MB.` });
        continue;
      }
      const data = await new Promise(res => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1]);
        r.readAsDataURL(file);
      });
      nuevas.push({
        name: file.name,
        mediaType: file.type === 'image/jpg' ? 'image/jpeg' : file.type,
        data,
        preview: `data:${file.type};base64,${data}`
      });
    }
    setImagenes(prev => [...prev, ...nuevas].slice(0, 4));
  }

  function quitarImagen(i) {
    setImagenes(prev => prev.filter((_, idx) => idx !== i));
  }

  /* ─── Dictado por micrófono en el chat ─── */
  async function alternarDictado() {
    if (dictando) {
      chatRecorder.current?.stop();
      setDictando(false);
      return;
    }
    try {
      chatStream.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
      });
      const opciones = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 24000 }
        : {};
      const mr = new MediaRecorder(chatStream.current, opciones);
      chatChunks.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chatChunks.current.push(e.data); };
      mr.onstop = async () => {
        chatStream.current?.getTracks().forEach(t => t.stop());
        const blob = new Blob(chatChunks.current, { type: mr.mimeType || 'audio/webm' });
        if (blob.size < 1000) return;

        setTranscribiendoChat(true);
        try {
          const fd = new FormData();
          fd.append('audio', blob, 'dictado.webm');
          const r = await fetch('/api/transcribe', { method: 'POST', body: fd });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || 'Error al transcribir');
          setEntrada(prev => (prev ? prev + ' ' : '') + (d.transcript || '').trim());
        } catch (e) {
          setAviso({ tipo: 'red', texto: e.message });
        }
        setTranscribiendoChat(false);
      };
      mr.start();
      chatRecorder.current = mr;
      setDictando(true);
    } catch (e) {
      setAviso({ tipo: 'red', texto: 'No se pudo acceder al micrófono.' });
    }
  }

  /* ─── Guardar la conversación en el expediente ─── */
  async function guardarChat() {
    if (!paciente || !mensajes.length) return;
    if (!confirm('¿Guardar esta conversación en el expediente del paciente?\n\nQuedará registrada como nota clínica con fecha y autor.')) return;

    setGuardandoChat(true);
    try {
      const contenido = mensajes.map(m =>
        `${m.role === 'user' ? '▸ CONSULTA' : '▸ RESPUESTA DEL ASISTENTE'}\n${m.content}${m.images?.length ? `\n[${m.images.length} imagen(es) adjunta(s)]` : ''}`
      ).join('\n\n');

      const { data, error } = await supabase.from('clinical_notes').insert({
        patient_id:    paciente.id,
        record_number: paciente.record_number,
        note_type:     'chat',
        title:         'Consulta al asistente clínico',
        content:       contenido,
        source:        'scribe_ai',
        ai_model:      'claude-sonnet-5',
        author_email:  user?.email,
        author_name:   user?.email?.split('@')[0] || null,
        author_role:   'doctor',
        status:        'draft',
        metadata:      { messages: mensajes.length, had_images: mensajes.some(m => m.images?.length) }
      }).select().single();

      if (error) throw error;

      await audit('NOTE_ADD', 'note', paciente.id, {
        record_number: paciente.record_number, entity_id: data.id, note_type: 'chat'
      });

      setAviso({ tipo: 'green', texto: 'Conversación guardada en el expediente como nota clínica.' });
      cargarNotasPrevias(paciente.id);
    } catch (e) {
      setAviso({ tipo: 'red', texto: e.message });
    }
    setGuardandoChat(false);
  }

  function limpiarChat() {
    if (mensajes.length && !confirm('¿Descartar esta conversación sin guardarla?')) return;
    setMensajes([]); setImagenes([]); setEntrada('');
  }

  /* ─── Chat clínico ─── */
  async function enviarMensaje(texto) {
    const contenido = (texto ?? entrada).trim();
    if ((!contenido && !imagenes.length) || pensando) return;

    const adjuntos = imagenes.length ? imagenes.map(i => ({ mediaType: i.mediaType, data: i.data })) : null;
    const nuevos = [...mensajes, {
      role: 'user',
      content: contenido || 'Analiza esta imagen.',
      images: adjuntos,
      previews: imagenes.map(i => i.preview)
    }];
    setMensajes(nuevos); setEntrada(''); setImagenes([]); setPensando(true);

    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nuevos, patient: paciente, transcript: transcripcion })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Error en el chat');
      setMensajes([...nuevos, { role: 'assistant', content: d.reply }]);
    } catch (e) {
      setMensajes([...nuevos, { role: 'assistant', content: `No se pudo completar: ${e.message}` }]);
    }
    setPensando(false);
  }

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [mensajes, pensando]);

  /* ══════════ PANTALLAS ══════════ */

  if (cargandoSesion) {
    return (
      <div className="login-wrap">
        <div style={{ textAlign: 'center' }}>
          <span className="spinner" />
          <div className="sub" style={{ marginTop: 12 }}>Conectando...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <div className="brand-mark" style={{ margin: '0 auto 12px', width: 44, height: 44, fontSize: 18 }}>P</div>
            <div className="h2">Prime Scribe</div>
            <div className="sub">Notas clínicas asistidas</div>
          </div>

          {errorLogin && <div className="alert alert-red">{errorLogin}</div>}

          <div style={{ marginBottom: '.9rem' }}>
            <label className="label">Correo</label>
            <input type="email" value={email} autoComplete="username"
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && iniciarSesion()}
              placeholder="doctor@primeadvanceddentistry.com" />
          </div>
          <div style={{ marginBottom: '1.25rem' }}>
            <label className="label">Contraseña</label>
            <input type="password" value={password} autoComplete="current-password"
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && iniciarSesion()}
              placeholder="••••••••" />
          </div>

          <button className="btn btn-gold btn-block" onClick={iniciarSesion} disabled={entrando}>
            {entrando ? <><span className="spinner" /> Verificando...</> : 'Iniciar sesión'}
          </button>

          <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: 11, color: 'var(--subtle)', lineHeight: 1.6 }}>
            Mismas credenciales que la Historia Clínica.<br />El acceso queda registrado.
          </div>
        </div>
      </div>
    );
  }

  if (errorPaciente) {
    return (
      <>
        <Topbar user={user} onLogout={cerrarSesion} />
        <div className="shell">
          <div className="card" style={{ textAlign: 'center', padding: '2.5rem 1.5rem' }}>
            <div className="h2" style={{ marginBottom: 8 }}>
              {errorPaciente === 'sin_paciente' ? 'Sin paciente seleccionado' : 'Paciente no encontrado'}
            </div>
            <p className="sub" style={{ maxWidth: 420, margin: '0 auto 1.5rem' }}>
              {errorPaciente === 'sin_paciente'
                ? 'Prime Scribe se abre desde la Historia Clínica. Entra al módulo Scribe y elige un paciente para comenzar.'
                : 'El expediente indicado no existe o no está disponible.'}
            </p>
            <a className="btn btn-gold" href={EHR_URL}>Ir a la Historia Clínica</a>
          </div>
        </div>
      </>
    );
  }

  if (!paciente) {
    return (
      <>
        <Topbar user={user} onLogout={cerrarSesion} />
        <div className="shell">
          <div className="empty"><span className="spinner" /> Cargando expediente...</div>
        </div>
      </>
    );
  }

  /* ══════════ APLICACIÓN ══════════ */
  const alertas = buildAlerts(paciente);

  return (
    <>
      <Topbar user={user} onLogout={cerrarSesion} />
      <div className="shell">

        {/* Paciente */}
        <div className="card">
          <div className="card-head" style={{ marginBottom: '.75rem' }}>
            <div>
              <div className="h1" style={{ fontSize: 24 }}>{paciente.name}</div>
              <div className="sub">
                {[paciente.age && `${paciente.age} años`, paciente.hotel && `${paciente.hotel}${paciente.room ? ` · Hab. ${paciente.room}` : ''}`]
                  .filter(Boolean).join(' · ')}
              </div>
            </div>
            <span className="folio">{paciente.record_number || '—'}</span>
          </div>

          {alertas.length > 0 && (
            <div style={{ marginBottom: '.75rem' }}>
              {alertas.map((a, i) => (
                <div key={i} className={`alert alert-${a.t === 'red' ? 'red' : 'gold'}`} style={{ marginBottom: 6 }}>
                  <span>{a.t === 'red' ? '⛔' : '⚠️'}</span>
                  <span><strong>{a.t === 'red' ? 'ALERTA CRÍTICA:' : 'ALERTA:'}</strong> {a.m}</span>
                </div>
              ))}
            </div>
          )}

          {(paciente.allergies || paciente.conditions || paciente.meds) && (
            <div className="alert alert-gold" style={{ marginBottom: '.75rem' }}>
              <span>📋</span>
              <span>
                {paciente.allergies  && <><strong>Alergias:</strong> {paciente.allergies}<br /></>}
                {paciente.conditions && <><strong>Padecimientos:</strong> {paciente.conditions}<br /></>}
                {paciente.meds       && <><strong>Medicación:</strong> {paciente.meds}</>}
              </span>
            </div>
          )}

          <div className="meta-grid">
            {paciente.concern && (
              <div style={{ gridColumn: '1/-1' }}>
                <div className="meta-k">MOTIVO DE CONSULTA</div>
                <div className="meta-v">{paciente.concern}</div>
              </div>
            )}
            {paciente.doctor_plan && (
              <div style={{ gridColumn: '1/-1' }}>
                <div className="meta-k">PLAN DE TRATAMIENTO</div>
                <div className="meta-v" style={{ whiteSpace: 'pre-wrap' }}>{paciente.doctor_plan}</div>
              </div>
            )}
          </div>
        </div>

        {/* Pestañas */}
        <div className="tabs">
          <button className={`tab ${tab === 'nota' ? 'active' : ''}`} onClick={() => setTab('nota')}>
            Nueva nota
          </button>
          <button className={`tab ${tab === 'chat' ? 'active' : ''}`} onClick={() => setTab('chat')}>
            Chat clínico
          </button>
          <button className={`tab ${tab === 'historial' ? 'active' : ''}`} onClick={() => setTab('historial')}>
            Notas previas {notasPrevias.length > 0 && `(${notasPrevias.length})`}
          </button>
        </div>

        {aviso && (
          <div className={`alert alert-${aviso.tipo}`}>
            <span>{aviso.tipo === 'red' ? '⛔' : '✓'}</span>
            <span>{aviso.texto}</span>
          </div>
        )}

        {/* ─── NUEVA NOTA ─── */}
        {tab === 'nota' && (
          <>
            <div className="card">
              <div className="recorder">
                <button
                  className={`rec-button ${grabando ? 'recording' : ''}`}
                  onClick={grabando ? detenerGrabacion : iniciarGrabacion}
                  disabled={transcribiendo}
                  aria-label={grabando ? 'Detener grabación' : 'Iniciar grabación'}
                >
                  {grabando ? (
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                  ) : (
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2a3 3 0 00-3 3v6a3 3 0 006 0V5a3 3 0 00-3-3z" />
                      <path d="M19 10v1a7 7 0 01-14 0v-1" /><line x1="12" y1="18" x2="12" y2="22" />
                    </svg>
                  )}
                </button>

                <div className="rec-timer">{formatoTiempo(segundos)}</div>
                <div className="rec-hint">
                  {grabando ? (pausado ? 'En pausa' : 'Grabando consulta...')
                    : audioBlob ? 'Grabación lista' : 'Toca para comenzar a grabar'}
                </div>

                {grabando && (
                  <div className="rec-controls">
                    <button className="btn btn-ghost btn-sm" onClick={pausarGrabacion}>
                      {pausado ? '▶ Reanudar' : '⏸ Pausar'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={detenerGrabacion}>■ Finalizar</button>
                  </div>
                )}

                {audioBlob && !grabando && (
                  <div className="rec-controls">
                    <button className="btn btn-gold" onClick={transcribir} disabled={transcribiendo}>
                      {transcribiendo ? <><span className="spinner" /> Transcribiendo...</> : '✨ Transcribir'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={descartarGrabacion} disabled={transcribiendo}>
                      Descartar
                    </button>
                  </div>
                )}
              </div>
            </div>

            {transcripcion && (
              <div className="card">
                <div className="card-head">
                  <div>
                    <div className="h2" style={{ fontSize: 18 }}>Transcripción</div>
                    <div className="sub">Revisa y corrige antes de generar la nota.</div>
                  </div>
                  {idiomaDetectado && <span className="badge">Idioma: {idiomaDetectado}</span>}
                </div>
                <textarea rows={7} value={transcripcion} onChange={e => setTranscripcion(e.target.value)} />
              </div>
            )}

            {transcripcion && (
              <div className="card">
                <div className="card-head">
                  <div className="h2" style={{ fontSize: 18 }}>Nota clínica</div>
                </div>

                <div className="row" style={{ marginBottom: '1rem', alignItems: 'flex-end' }}>
                  <div className="grow" style={{ minWidth: 200 }}>
                    <label className="label">Tipo de nota</label>
                    <select value={plantilla} onChange={e => setPlantilla(e.target.value)}>
                      {PLANTILLAS.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                  </div>
                  <button className="btn btn-gold" onClick={generarNota} disabled={generando}>
                    {generando ? <><span className="spinner" /> Redactando...</> : '✨ Generar nota'}
                  </button>
                </div>

                {nota && (
                  <>
                    <textarea rows={16} value={nota} onChange={e => setNota(e.target.value)}
                      style={{ fontFamily: 'ui-monospace, SF Mono, Menlo, monospace', fontSize: 13 }} />

                    <div className="alert alert-gold mt">
                      <span>👤</span>
                      <span>Revisa la nota antes de guardarla. Como profesional, eres el responsable de su contenido.</span>
                    </div>

                    <div className="row mt-sm">
                      <button className="btn btn-ghost" onClick={() => guardarNota('draft')} disabled={guardando}>
                        Guardar borrador
                      </button>
                      <button className="btn btn-gold grow" onClick={() => guardarNota('signed')} disabled={guardando}>
                        {guardando ? <><span className="spinner" /> Guardando...</> : '✓ Firmar y guardar en el expediente'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {/* ─── CHAT ─── */}
        {tab === 'chat' && (
          <div className="card">
            <div className="card-head">
              <div>
                <div className="h2" style={{ fontSize: 18 }}>Chat clínico</div>
                <div className="sub">
                  Consulta dudas médicas o pide trabajo sobre este paciente.
                  {transcripcion && ' La consulta grabada está disponible como contexto.'}
                </div>
              </div>
              {mensajes.length > 0 && (
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={limpiarChat}>Descartar</button>
                  <button className="btn btn-gold btn-sm" onClick={guardarChat} disabled={guardandoChat}>
                    {guardandoChat ? <><span className="spinner" /> Guardando...</> : '💾 Guardar en expediente'}
                  </button>
                </div>
              )}
            </div>

            {alertas.some(a => a.t === 'red') && (
              <div className="alert alert-red">
                <span>⛔</span>
                <span>Este paciente tiene alertas críticas. El asistente las considera en sus respuestas.</span>
              </div>
            )}

            {mensajes.length === 0 && (
              <div className="chips">
                {SUGERENCIAS.map(s => (
                  <button key={s} className="chip" onClick={() => enviarMensaje(s)}>{s}</button>
                ))}
              </div>
            )}

            <div className="chat-log" ref={chatRef}>
              {mensajes.length === 0 && (
                <div className="empty">
                  Escribe una pregunta, dicta con el micrófono o adjunta una radiografía.
                </div>
              )}
              {mensajes.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  <div className="msg-bubble">
                    {m.previews?.length > 0 && (
                      <div className="msg-images">
                        {m.previews.map((src, j) => (
                          <img key={j} src={src} alt="Adjunto" className="msg-image" />
                        ))}
                      </div>
                    )}
                    {m.content}
                  </div>
                </div>
              ))}
              {pensando && (
                <div className="msg assistant">
                  <div className="msg-bubble"><span className="spinner" /></div>
                </div>
              )}
            </div>

            {imagenes.length > 0 && (
              <div className="attach-row">
                {imagenes.map((img, i) => (
                  <div key={i} className="attach-thumb">
                    <img src={img.preview} alt={img.name} />
                    <button className="attach-x" onClick={() => quitarImagen(i)} aria-label="Quitar">×</button>
                  </div>
                ))}
              </div>
            )}

            <div className="chat-input-row">
              <button
                className={`btn ${dictando ? 'btn-danger' : 'btn-ghost'}`}
                onClick={alternarDictado}
                disabled={transcribiendoChat}
                title={dictando ? 'Detener dictado' : 'Dictar con el micrófono'}
                style={{ padding: '11px 13px', flexShrink: 0 }}
              >
                {transcribiendoChat ? <span className="spinner" /> : dictando ? '■' : (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a3 3 0 00-3 3v6a3 3 0 006 0V5a3 3 0 00-3-3z" />
                    <path d="M19 10v1a7 7 0 01-14 0v-1" /><line x1="12" y1="18" x2="12" y2="22" />
                  </svg>
                )}
              </button>

              <button
                className="btn btn-ghost"
                onClick={() => fileRef.current?.click()}
                title="Adjuntar imagen o radiografía"
                style={{ padding: '11px 13px', flexShrink: 0 }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                </svg>
              </button>

              <input ref={fileRef} type="file" accept="image/*" multiple hidden
                onChange={e => { adjuntarImagenes(e.target.files); e.target.value = ''; }} />

              <textarea rows={2}
                value={entrada}
                placeholder={dictando ? 'Escuchando...' : 'Escribe tu pregunta...'}
                onChange={e => setEntrada(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarMensaje(); }
                }} />

              <button className="btn btn-gold" onClick={() => enviarMensaje()}
                disabled={pensando || (!entrada.trim() && !imagenes.length)}>
                Enviar
              </button>
            </div>
          </div>
        )}

        {/* ─── NOTAS PREVIAS ─── */}
        {tab === 'historial' && (
          <div className="card">
            <div className="card-head">
              <div className="h2" style={{ fontSize: 18 }}>Notas previas</div>
            </div>
            {notasPrevias.length === 0 ? (
              <div className="empty">Sin notas registradas para este paciente.</div>
            ) : notasPrevias.map(n => (
              <div className="note-item" key={n.id}>
                <div className="note-item-head">
                  <div>
                    <span className="badge badge-gold">
                      {PLANTILLAS.find(p => p.id === n.note_type)?.nombre || n.note_type}
                    </span>
                    {n.status === 'signed' && <span className="badge badge-green" style={{ marginLeft: 6 }}>Firmada</span>}
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {new Date(n.created_at).toLocaleString('es-MX', {
                      timeZone: 'America/Cancun', day: '2-digit', month: 'short',
                      year: 'numeric', hour: '2-digit', minute: '2-digit'
                    })}
                  </span>
                </div>
                <div className="note-item-body">{n.content}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                  {n.author_name || n.author_email || '—'}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
          <a className="btn btn-ghost" href={EHR_URL}>← Volver a la Historia Clínica</a>
        </div>
      </div>
    </>
  );
}

/* ─── Barra superior ─── */
function Topbar({ user, onLogout }) {
  return (
    <div className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <div className="brand-mark">P</div>
          <div>
            <div className="brand-name">Prime Scribe</div>
            <div className="brand-sub">Prime Advanced Dentistry</div>
          </div>
        </div>
        <div className="topbar-actions">
          <span>{user?.email}</span>
          <button className="btn btn-ghost btn-sm" onClick={onLogout}>Cerrar sesión</button>
        </div>
      </div>
    </div>
  );
}
