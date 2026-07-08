// prompt.js — construye el prompt a partir del meeting model (v4)
// ✅ Soporta templates: admin / docente (sin romper reuniones viejas)
// ✅ Incluye: tipo de reunión, encuadre, objetivo, seguimiento de acuerdos anteriores
// ✅ NO omite secciones con contenido (aunque estén "No revisado" o "No aplica")
// ✅ Omite solo secciones realmente vacías (sin notas ni acuerdos)
// ✅ Separa: hechos observados / versión del trabajador / lectura institucional / acuerdos / apoyos
// ✅ NO incluye las frases guía del facilitador
// ✅ Mantiene: no inventar, reescribir sin copiar textual, "No se registró información"

export function buildPrompt(meeting){
  const m = meeting || {};

  // ---------- Utils ----------
  const safe = (v) => (v ?? "").toString().trim();
  const safeOneLine = (v) => safe(v).replace(/\s+/g, " ");
  const safeMultiline = (v) => safe(v);

  const normalizeNoInfo = (v) => {
    const s = safeMultiline(v);
    return s ? s : "No se registró información";
  };

  const toISODateMaybe = (v) => {
    const s = safe(v);
    if (!s) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return s.replaceAll("/", "-");
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())){
      const y = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, "0");
      const da = String(d.getDate()).padStart(2, "0");
      return `${y}-${mo}-${da}`;
    }
    return s;
  };

  const normalizeArea = (v) => {
    const s = safeOneLine(v).toLowerCase();
    if (!s) return "";
    const t = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (t.includes("academ")) return "Académica";
    if (t.includes("admin")) return "Administrativa";
    if (t.includes("venta")) return "Ventas";
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  const asListText = (v) => {
    if (Array.isArray(v)) return v.filter(Boolean).map(x => safeOneLine(x)).filter(Boolean).join(", ");
    return safeOneLine(v);
  };
  const uniq = (arr) => Array.from(new Set((arr || []).filter(Boolean)));
  const cleanForTable = (s) => safeOneLine(s).replaceAll("|", "/");

  // ---------- Templates ----------
  const TEMPLATES = {
    admin: {
      label: "Administrativos",
      areaDefault: "Administrativa",
      sections: [
        ["agradecimiento","Reconocimiento de avances y aspectos positivos del periodo"],
        ["retroEstudiantes","Retroalimentaciones de estudiantes o usuarios"],
        ["retroAdmin","Retroalimentaciones administrativas internas"],
        ["distintivos","Cumplimiento de protocolos y distintivos"],
        ["puntualidad","Puntualidad y registro de jornadas"],
        ["bitacora","Bitácora, tareas y trazabilidad del cargo"],
        ["comunicacion","Calidad de comunicación y atención"],
        ["funcionesCargo","Funciones del cargo y claridad de responsabilidades"],
        ["kpis","KPI's o indicadores del periodo"],
        ["bloqueos","Bloqueos, riesgos o dificultades para cumplir el cargo"],
        ["apoyosMusicala","Apoyos requeridos por Musicala"],
        ["proyeccion","Proyección del siguiente periodo"],
        ["palabrasTrabajador","Palabras del trabajador"],
        ["mejorasCargo","Retroalimentaciones y puntos de mejora"],
        ["bienestar","Espacios de bienestar"],
        ["cierre","Cierre de entendimiento y observaciones finales"],
      ]
    },
    docente: {
      label: "Docentes",
      areaDefault: "Académica",
      sections: [
        ["agradecimiento","Reconocimiento de avances y aspectos positivos del periodo"],
        ["registroClases","Registro de clases"],
        ["planeacion","Planeación y bitácora pedagógica"],
        ["manejoGrupo","Manejo de grupo"],
        ["relacionEstudiantes","Relación con estudiantes, líderes o acudientes"],
        ["muestrasProceso","Muestras de proceso"],
        ["avancesPedagogicos","Avances pedagógicos"],
        ["apoyoInstitucional","Necesidades de apoyo institucional"],
        ["puntualidad","Puntualidad y registro de jornadas"],
        ["proyeccion","Proyección del siguiente periodo"],
        ["palabrasDocente","Palabras del docente"],
        ["bienestar","Espacios de bienestar"],
      ]
    }
  };

  const templateKey = (() => {
    const t = safe(m.template || m.type).toLowerCase();
    return TEMPLATES[t] ? t : "admin";
  })();
  const template = TEMPLATES[templateKey];

  const normalizeSectionConfigForPrompt = () => {
    const defaults = template.sections.map(([key, title], index) => ({
      key, title, description: "", enabled: true, visible: true, applies: true, archived: false, custom: false, order: index
    }));
    const incoming = Array.isArray(m.sectionConfig) ? m.sectionConfig : [];
    const byKey = new Map();
    const defaultKeys = new Set(defaults.map(d => d.key));

    incoming.forEach((item, index) => {
      const key = safe(item?.key);
      if (!key) return;
      const def = defaults.find(d => d.key === key);
      const visible = item?.visible !== false && item?.enabled !== false;
      byKey.set(key, {
        key,
        title: safeOneLine(item?.title) || def?.title || key,
        description: safeMultiline(item?.description || item?.guide || def?.description || ""),
        enabled: visible, visible,
        applies: item?.applies !== false,
        archived: item?.archived === true,
        custom: item?.custom === true || !defaultKeys.has(key),
        order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index
      });
    });
    defaults.forEach(def => { if (!byKey.has(def.key)) byKey.set(def.key, def); });

    return Array.from(byKey.values())
      .filter(item => item.archived !== true)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((item, index) => ({ ...item, order: index }));
  };

  const isNoAplica = (status) => safeOneLine(status).toLowerCase().includes("no aplica");

  // ---------- Header data ----------
  const dateStr   = toISODateMaybe(m.dateISO || m.date || m.fecha);
  const period    = safeOneLine(m.periodLabel || m.period || m.periodo);
  const employee  = safeOneLine(m.employeeName || m.workerName || m.trabajador || m.nombreTrabajador);
  const role      = safeOneLine(m.role || m.cargo);
  const coordinator = safeOneLine(m.coordinator || m.coordinador);
  const area      = normalizeArea(m.area) || template.areaDefault;
  const place     = safeOneLine(m.place || m.modalidad || m.lugar);
  const meetingKind = safeOneLine(m.meetingKind) || "No se registró información";

  const attendees = (() => {
    const raw = m.attendees || m.asistentes || m.attendeesText;
    if (Array.isArray(raw)) return asListText(uniq(raw));
    const txt = asListText(raw);
    if (!txt) return "";
    const parts = txt.split(",").map(x => safeOneLine(x)).filter(Boolean);
    return uniq(parts).join(", ");
  })();

  const statusRaw = safeOneLine(m.status || m.estado);
  const status = statusRaw || "draft";

  // ---------- Encuadre + objetivo ----------
  const meetingFrame = safeMultiline(m.meetingFrame) ||
    "Esta reunión corresponde a un espacio de seguimiento y retroalimentación, y no constituye por sí misma una diligencia de descargos ni una decisión disciplinaria.";

  const objective = safeMultiline(m.objective || m.objetivo) ||
    `Realizar seguimiento al desempeño y procesos asociados del/de la ${template.label.toLowerCase()} en Musicala, revisando avances, observaciones, acuerdos y proyección.`;

  // ---------- Secciones ----------
  const sectionsObj = (m.sections && typeof m.sections === "object") ? m.sections : {};
  const sectionConfig = normalizeSectionConfigForPrompt();
  const applicableSectionKeys = new Set();

  const hasRelevantText = (v) => {
    const txt = safeOneLine(v).toLowerCase();
    const plain = txt.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return !!plain && plain !== "no se registro informacion" && plain !== "no aplica";
  };

  const renderSection = (item) => {
    const key = item.key;
    const s = (sectionsObj && sectionsObj[key] && typeof sectionsObj[key] === "object") ? sectionsObj[key] : {};
    const st = safeOneLine(s.status) || "No revisado";

    const actions = Array.isArray(s.actions) ? s.actions : [];
    const actionTitles = actions
      .map(a => safeOneLine(a?.title || a?.accion || a))
      .filter(Boolean)
      .slice(0, 12);

    const notesRaw = safeMultiline(s.notes || s.note || s.comentarios);
    const hasNotes = hasRelevantText(notesRaw);
    const hasActions = actionTitles.length > 0;

    // REGLA: omitir solo si NO hay notas ni acuerdos (vacía de verdad).
    // Si hay contenido, se incluye SIEMPRE, aunque esté "No aplica" o "No revisado".
    if (!hasNotes && !hasActions) return "";

    applicableSectionKeys.add(key);

    const title = item.title || safeOneLine(s.sectionTitle) || key;
    const notes = normalizeNoInfo(notesRaw);
    const noAplicaFlag = isNoAplica(st)
      ? "- Nota de revisión: la sección fue marcada como 'No aplica' pero contiene información registrada; inclúyela con prudencia."
      : "";

    const actionsText = actionTitles.length
      ? "- Acuerdos (insumo para reescribir):\n" + actionTitles.map(x => "  - " + x).join("\n")
      : "- Acuerdos: No se registró información";

    return [
      "## " + title,
      "- Estado: " + st,
      noAplicaFlag,
      "- Notas / hechos observados (insumo para reescribir): " + notes,
      actionsText,
      ""
    ].filter(line => line !== "").join("\n");
  };

  const sectionLines = sectionConfig
    .filter(item => item.enabled !== false && item.visible !== false && item.applies !== false && item.archived !== true)
    .map(item => renderSection(item))
    .filter(Boolean)
    .join("\n") || "No se registraron secciones con contenido para incluir en el acta.";

  // ---------- Seguimiento de acuerdos anteriores ----------
  const prevReview = Array.isArray(m.previousActionsReview) ? m.previousActionsReview : [];
  const prevBlock = prevReview.length
    ? prevReview.slice(0, 40).map((r, i) => {
        const title = safeOneLine(r?.originalTitle) || "No se registró información";
        const date  = safeOneLine(r?.sourceDate) || "No se registró información";
        const prev  = safeOneLine(r?.previousStatus) || "No se registró información";
        const foll  = safeOneLine(r?.followStatus) || "No se registró información";
        const comm  = safeMultiline(r?.comment) || "No se registró información";
        return [
          `${i + 1}) Acuerdo anterior: ${title}`,
          `   - Fecha anterior: ${date}`,
          `   - Estado anterior: ${prev}`,
          `   - Estado de seguimiento: ${foll}`,
          `   - Comentario de seguimiento: ${comm}`
        ].join("\n");
      }).join("\n")
    : "No se encontraron acuerdos pendientes de reuniones anteriores.";

  // ---------- Acuerdos (consolidado) ----------
  const rawActionItems =
    Array.isArray(m.actionItems) ? m.actionItems
    : Array.isArray(m.acuerdos) ? m.acuerdos
    : Array.isArray(m.compromisos) ? m.compromisos
    : Array.isArray(m.acciones) ? m.acciones
    : [];

  const actionItems = rawActionItems.filter(a => {
    const obj = (a && typeof a === "object") ? a : {};
    const key = safeOneLine(obj.sectionKey || obj.seccionKey || "");
    if (!key) return true;
    return applicableSectionKeys.has(key);
  });

  const normalizeAction = (a) => {
    const obj = (a && typeof a === "object") ? a : { title: a };
    return {
      title: safeOneLine(obj.title || obj.accion || obj.acuerdo) || "No se registró información",
      type:  safeOneLine(obj.type) || "acuerdo",
      owner: safeOneLine(obj.owner || obj.responsable) || "No se registró información",
      due:   toISODateMaybe(obj.dueDateISO || obj.fecha || obj.due) || "No se registró información",
      follow: toISODateMaybe(obj.followUpDateISO) || "No se registró información",
      prio:  safeOneLine(obj.priority) || "media",
      st:    safeOneLine(obj.status || obj.estado) || "pendiente",
      sec:   safeOneLine(obj.sectionTitle || obj.sectionKey || obj.seccion) || "No se registró información",
      ev:    safeMultiline(obj.expectedEvidence) || "No se registró información",
      obs:   safeMultiline(obj.details || obj.observaciones || obj.notas) || "No se registró información",
    };
  };

  const actionsTable = (() => {
    const headTop = "| Acción | Tipo | Responsable | Compromiso | Seguimiento | Prioridad | Estado | Evidencia esperada |";
    const headSep = "|---|---|---|---|---|---|---|---|";
    if (!actionItems.length){
      return [headTop, headSep,
        "| No se registró información | acuerdo | No se registró información | No se registró información | No se registró información | media | pendiente | No se registró información |"
      ].join("\n");
    }
    const rows = actionItems.slice(0, 80).map(a => {
      const x = normalizeAction(a);
      return `| ${cleanForTable(x.title)} | ${cleanForTable(x.type)} | ${cleanForTable(x.owner)} | ${cleanForTable(x.due)} | ${cleanForTable(x.follow)} | ${cleanForTable(x.prio)} | ${cleanForTable(x.st)} | ${cleanForTable(x.ev)} |`;
    });
    return [headTop, headSep, ...rows].join("\n");
  })();

  const actionsBlock = actionItems.length
    ? actionItems.slice(0, 80).map((a, i) => {
        const x = normalizeAction(a);
        return [
          `${i + 1})`,
          `Acción/acuerdo: ${x.title}`,
          `Tipo: ${x.type}`,
          `Responsable: ${x.owner}`,
          `Fecha compromiso: ${x.due}`,
          `Fecha seguimiento: ${x.follow}`,
          `Prioridad: ${x.prio}`,
          `Estado: ${x.st}`,
          `Sección: ${x.sec}`,
          `Evidencia esperada: ${x.ev}`,
          `Observaciones: ${x.obs}`
        ].join("\n");
      }).join("\n\n")
    : "No se registraron acuerdos.";

  // ---------- Header / instrucciones ----------
  const header = [
    "Eres ChatGPT y tu tarea es redactar un ACTA institucional, formal, clara y profesional a partir del contenido registrado abajo.",
    "",
    "REGLAS CRÍTICAS (OBLIGATORIAS):",
    "- NO inventes información ni agregues hechos, fechas, cifras, nombres o situaciones que no estén registradas.",
    "- Si un dato no está registrado, SIMPLEMENTE OMITE ese punto. NO escribas frases de relleno como 'No se registró información', 'No aplica', 'No revisado', 'Sin información', 'No hay datos' ni '—'.",
    "- El insumo de abajo usa 'No se registró información' o '—' para marcar campos vacíos. Trátalos como AUSENCIA de dato: no los copies al acta; simplemente no menciones ese punto.",
    "- Incluye todas las secciones que tengan contenido. Omite por completo las secciones realmente vacías (sin notas ni acuerdos): no las listes ni con un título.",
    "- No conviertas una reunión de seguimiento en una sanción disciplinaria si eso no fue expresamente registrado.",
    "- No emitas diagnósticos personales, psicológicos ni juicios de carácter sobre el trabajador.",
    "",
    "REDACTOR PROFESIONAL (MUY IMPORTANTE):",
    "- NO transcribas ni copies textualmente ningún texto del contenido registrado.",
    "- Reescribe con OTRAS PALABRAS todo: notas, observaciones, acuerdos, comentarios y cierre.",
    "- Mantén fielmente el sentido de lo escrito, pero conviértelo en redacción institucional formal.",
    "- Puedes ampliar para dar claridad, siempre que NO agregues hechos nuevos.",
    "",
    "SEPARACIÓN EN CADA SECCIÓN (INCLUIR SOLO LOS SUB-PUNTOS CON CONTENIDO; OMITIR LOS DEMÁS):",
    "- Hechos observados (lo que se registró objetivamente).",
    "- Versión / percepción del trabajador (solo si fue registrada; si no, omite este sub-punto).",
    "- Lectura institucional (interpretación de Musicala, sin juicios personales).",
    "- Acuerdos derivados (qué se definió hacer).",
    "- Apoyos de Musicala (qué se compromete la institución, si aplica).",
    "- No fuerces los cinco sub-puntos: si una sección solo tiene hechos y un acuerdo, redacta solo eso.",
    "",
    "FORMATO Y ESTILO:",
    "- Español neutro-formal, fácil de leer. Evita muletillas y repeticiones. Tono institucional humano, sin regaños ni dramatismo.",
    "",
    `Empresa: Musicala`,
    `Tipo de evaluación: Seguimiento (${template.label})`,
    `Tipo de reunión: ${meetingKind}`,
    `Estado del acta en sistema: ${status || "—"}`,
    `Fecha: ${dateStr || "—"}`,
    `Periodo evaluado: ${period || "—"}`,
    `Trabajador: ${employee || "—"}`,
    `Cargo: ${role || "—"}`,
    `Coordinador: ${coordinator || "—"}`,
    `Área: ${area || "—"}`,
    `Lugar/Modalidad: ${place || "—"}`,
    `Asistentes: ${attendees || "—"}`,
    "",
    "ENCUADRE DE LA REUNIÓN (incluir al inicio del acta; reescribir con otras palabras sin cambiar el sentido):",
    `- ${meetingFrame}`,
    "",
    "OBJETIVO DE LA REUNIÓN (usar como base; puedes reescribirlo sin cambiar el sentido):",
    `- ${objective}`,
    "",
    "ESTRUCTURA OBLIGATORIA DEL ACTA (ENTREGABLE FINAL):",
    "1) Encabezado (datos básicos, tipo de reunión)",
    "2) Encuadre de la reunión",
    "3) Objetivo de la reunión",
    "4) Seguimiento de acuerdos anteriores (si hay)",
    "5) Desarrollo por secciones con contenido (Hechos / Versión del trabajador / Lectura institucional / Acuerdos / Apoyos)",
    "6) Acuerdos y compromisos (TABLA)",
    "7) Cierre (resumen breve + constancia)",
    "8) Firmas (Musicala / Trabajador)",
    "",
    "ENTREGA:",
    "- Devuelve el acta completa ya redactada, lista para copiar y pegar.",
    "- No incluyas explicaciones meta del tipo 'a continuación' o 'según lo proporcionado'.",
    ""
  ].join("\n");

  return [
    header,
    "CONTENIDO REGISTRADO (INSUMO BASE. PROHIBIDO COPIAR TEXTUAL):",
    "",
    "# Seguimiento de acuerdos anteriores",
    prevBlock,
    "",
    "# Secciones del periodo",
    sectionLines,
    "## Acuerdos y compromisos (consolidado) — DETALLE (insumo)",
    actionsBlock,
    "",
    "## Acuerdos y compromisos (consolidado) — TABLA DE INSUMO (reescribir formalmente, no copiar textual)",
    actionsTable,
    "",
    "REDACTA AHORA el ACTA COMPLETA siguiendo la ESTRUCTURA OBLIGATORIA.",
    "Recuerda: reescribe con otras palabras TODO lo escrito, separa hechos/versión/lectura institucional/acuerdos/apoyos, incluye SOLO lo que tenga contenido y omite lo vacío (sin frases de relleno ni '—') y NO inventes. Excepción: en la TABLA de acuerdos, si una celda no tiene dato déjala con '—' para no romper el formato; el resto del acta va sin rellenos."
  ].join("\n");
}
