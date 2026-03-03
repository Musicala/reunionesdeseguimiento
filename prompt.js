// prompt.js — construye el prompt a partir del meeting model (remejorado v2)
// ✅ Soporta templates: admin / docente (sin romper reuniones viejas)
// ✅ Usa sectionTitle del modelo si existe, y cae a títulos por template
// ✅ Resistente a reuniones “viejas” (fields alternos / faltantes)
// ✅ Acciones por sección + consolidado
// ✅ Instrucciones claras: NO inventar, rellenar con "No se registró información"
// ✅ Tono formal, humano y profesional

export function buildPrompt(meeting){
  const m = meeting || {};

  // ---------- Utils ----------
  const safe = (v) => (v ?? "").toString().trim();
  const safeOneLine = (v) => safe(v).replace(/\s+/g, " ");
  const safeMultiline = (v) => safe(v); // deja saltos si vienen del user

  const toISODateMaybe = (v) => {
    const s = safe(v);
    if (!s) return "";
    // soporta "YYYY-MM-DD" o "YYYY/MM/DD" o Date-like
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return s.replaceAll("/", "-");
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, "0");
      const da = String(d.getDate()).padStart(2, "0");
      return `${y}-${mo}-${da}`;
    }
    return s; // si es un formato raro, lo devolvemos tal cual
  };

  const normalizeArea = (v) => {
    const s = safeOneLine(v).toLowerCase();
    if (!s) return "";
    // normaliza tildes para casos típicos
    const t = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (t.includes("academ")) return "Académica";
    if (t.includes("admin")) return "Administrativa";
    // primera letra mayúscula
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  const asListText = (v) => {
    if (Array.isArray(v)) return v.filter(Boolean).map(x => safeOneLine(x)).filter(Boolean).join(", ");
    return safeOneLine(v);
  };

  // ---------- Templates ----------
  // OJO: Las keys deben coincidir con las sections que genera app.js
  const TEMPLATES = {
    admin: {
      label: "Administrativos",
      areaDefault: "Administrativa",
      sections: [
        ["agradecimiento","Agradecimiento por el trabajo hasta la fecha"],
        ["retroEstudiantes","Seguimiento de retroalimentaciones de estudiantes"],
        ["retroAdmin","Seguimiento de retroalimentaciones administrativas (Musicala)"],
        ["distintivos","Uso de distintivos (chaqueta, carnet)"],
        ["puntualidad","Puntualidad y registro de jornadas"],
        ["bitacora","Bitácora de tareas"],
        ["kpis","KPI's"],
        ["proyeccion","Proyección"],
        ["palabrasTrabajador","Palabras del trabajador (comentarios, sugerencias)"],
        ["mejorasCargo","Retroalimentaciones y puntos de mejora en el cargo"],
        ["bienestar","Espacios de bienestar"],
      ]
    },
    docente: {
      label: "Docentes",
      areaDefault: "Académica",
      sections: [
        ["agradecimiento","Agradecimiento por el trabajo hasta la fecha"],
        ["retroEstudiantes","Seguimiento de retroalimentaciones de estudiantes"],
        ["retroAdmin","Seguimiento de retroalimentaciones administrativas (Musicala)"],
        ["distintivos","Uso de distintivos (chaqueta, carnet)"],
        ["puntualidad","Puntualidad y registro de jornadas"],
        ["bitacora","Bitácora de tareas"],
        ["registroClases","Registro de clases"],
        ["muestrasProceso","Muestras de proceso"],
        ["proyeccion","Proyección"],
        ["palabrasDocente","Palabras del docente (comentarios, sugerencias)"],
        ["mejorasCargo","Retroalimentaciones y puntos de mejora en el cargo"],
        ["bienestar","Espacios de bienestar"],
      ]
    }
  };

  const templateKey = (() => {
    // soporta meeting.template o meeting.type (legacy)
    const t = safe(m.template || m.type).toLowerCase();
    return TEMPLATES[t] ? t : "admin";
  })();

  const template = TEMPLATES[templateKey];

  // ---------- Basic header data (compat con legacy fields) ----------
  const dateStr   = toISODateMaybe(m.dateISO || m.date || m.fecha);
  const period    = safeOneLine(m.periodLabel || m.period || m.periodo);
  const employee  = safeOneLine(m.employeeName || m.workerName || m.trabajador || m.nombreTrabajador);
  const role      = safeOneLine(m.role || m.cargo);
  const area      = normalizeArea(m.area) || template.areaDefault;
  const place     = safeOneLine(m.place || m.modalidad || m.lugar);
  const attendees = asListText(m.attendees || m.asistentes || m.attendeesText);

  const statusRaw = safeOneLine(m.status || m.estado);
  const status = statusRaw || "draft";

  // ---------- Objective ----------
  // Si no hay objetivo explícito, creamos uno genérico sin inventar (es válido como plantilla)
  const objective = safeMultiline(m.objective || m.objetivo) ||
    `Realizar seguimiento al desempeño y procesos asociados del/de la ${template.label.toLowerCase()} en Musicala, revisando avances, observaciones, acuerdos y proyección.`;

  // ---------- Sections rendering ----------
  // meeting.sections esperado: { key: { sectionTitle, status, notes, actions } }
  // legacy: a veces notes puede venir como "note" o "comentarios"
  const sectionsObj = (m.sections && typeof m.sections === "object") ? m.sections : {};

  const renderSection = (key, fallbackTitle) => {
    const s = (sectionsObj && sectionsObj[key] && typeof sectionsObj[key] === "object") ? sectionsObj[key] : {};

    const title = safeOneLine(s.sectionTitle) || fallbackTitle;
    const st    = safeOneLine(s.status) || "No registrado";
    const notes = safeMultiline(s.notes || s.note || s.comentarios) || "No se registró información.";

    // acciones por sección
    const actions = Array.isArray(s.actions) ? s.actions : [];
    const actionTitles = actions
      .map(a => safeOneLine(a?.title || a?.accion || a))
      .filter(Boolean)
      .slice(0, 12);

    const actionsText = actionTitles.length
      ? `- Acuerdos (resumen):\n${actionTitles.map(x => `  • ${x}`).join("\n")}`
      : `- Acuerdos (resumen): No se registró información.`;

    return [
      `## ${title}`,
      `- Estado: ${st}`,
      `- Notas: ${notes}`,
      actionsText,
      ""
    ].join("\n");
  };

  const sectionLines = template.sections
    .map(([key, fallbackTitle]) => renderSection(key, fallbackTitle))
    .join("\n");

  // ---------- Agreements / actionItems (consolidado) ----------
  // meeting.actionItems esperado: [{title, owner, dueDateISO, status, sectionTitle/sectionKey, details}]
  // legacy: acuerdos / compromisos / acciones
  const actionItems =
    Array.isArray(m.actionItems) ? m.actionItems
    : Array.isArray(m.acuerdos) ? m.acuerdos
    : Array.isArray(m.compromisos) ? m.compromisos
    : Array.isArray(m.acciones) ? m.acciones
    : [];

  const normalizeAction = (a) => {
    const obj = (a && typeof a === "object") ? a : { title: a };
    return {
      title: safeOneLine(obj.title || obj.accion || obj.acuerdo) || "—",
      owner: safeOneLine(obj.owner || obj.responsable) || "—",
      due:   toISODateMaybe(obj.dueDateISO || obj.fecha || obj.due) || "—",
      st:    safeOneLine(obj.status || obj.estado) || "pendiente",
      sec:   safeOneLine(obj.sectionTitle || obj.sectionKey || obj.seccion) || "—",
      obs:   safeMultiline(obj.details || obj.observaciones || obj.notas) || "—",
    };
  };

  const actionsBlock = actionItems.length
    ? actionItems.map((a, i) => {
        const x = normalizeAction(a);
        return [
          `${i + 1})`,
          `Acción: ${x.title}`,
          `Responsable: ${x.owner}`,
          `Fecha: ${x.due}`,
          `Estado: ${x.st}`,
          `Sección: ${x.sec}`,
          `Observaciones: ${x.obs}`
        ].join("\n");
      }).join("\n\n")
    : "No se registraron acuerdos.";

  // ---------- Prompt header / instructions ----------
  const header = [
    "Eres ChatGPT y vas a redactar un ACTA formal, completa y bien estructurada de una reunión de seguimiento en Musicala.",
    "",
    "REGLAS IMPORTANTES:",
    "- NO inventes información.",
    "- Si algo no está en el contenido registrado, escribe exactamente: 'No se registró información'.",
    "- Mantén un tono respetuoso, claro, humano y profesional. Sin dramatismos ni regaños.",
    "- Usa español neutro-formal, fácil de leer.",
    "",
    `Empresa: Musicala`,
    `Tipo de reunión: Seguimiento (${template.label})`,
    `Estado del acta en sistema: ${status || "—"}`,
    `Fecha: ${dateStr || "—"}`,
    `Periodo evaluado: ${period || "—"}`,
    `Trabajador: ${employee || "—"}`,
    `Cargo: ${role || "—"}`,
    `Área: ${area || "—"}`,
    `Lugar/Modalidad: ${place || "—"}`,
    `Asistentes: ${attendees || "—"}`,
    "",
    "OBJETIVO DE LA REUNIÓN (usar esto, no inventar otro):",
    objective ? `- ${objective}` : "- No se registró información",
    "",
    "ESTRUCTURA OBLIGATORIA DEL ACTA (entregable final):",
    "1) Encabezado (datos básicos)",
    "2) Objetivo de la reunión",
    "3) Desarrollo por secciones (cada sección debe incluir Estado + Notas; si no hay datos, poner 'No se registró información')",
    "4) Acuerdos y compromisos (TABLA: Acción | Responsable | Fecha | Estado | Observaciones)",
    "5) Cierre (resumen breve + constancia)",
    "6) Firmas (Musicala / Trabajador)",
    ""
  ].join("\n");

  // ---------- Final prompt (FIX: sectionLines, no 'sectionsLines') ----------
  return [
    header,
    "CONTENIDO REGISTRADO (NO INVENTAR):",
    "",
    sectionLines,
    "## Acuerdos y compromisos (consolidado)",
    actionsBlock,
    "",
    "Ahora redacta el acta completa siguiendo la ESTRUCTURA OBLIGATORIA. Si faltan datos, usa 'No se registró información'."
  ].join("\n");
}