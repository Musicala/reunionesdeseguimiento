// prompt.js — construye el prompt a partir del meeting model (v3.1)
// ✅ Soporta templates: admin / docente (sin romper reuniones viejas)
// ✅ Usa sectionTitle del modelo si existe, y cae a títulos por template
// ✅ Resistente a reuniones “viejas” (fields alternos / faltantes)
// ✅ Acciones por sección + consolidado
// ✅ Instrucciones claras: NO inventar, rellenar con "No se registró información"
// ✅ Obliga a: REESCRIBIR con otras palabras (no copiar textual)
// ✅ Permite: explicar/mejorar redacción para claridad profesional (sin inventar hechos)
// ✅ Tabla de acuerdos lista para copiar a un acta

export function buildPrompt(meeting){
  const m = meeting || {};

  // ---------- Utils ----------
  const safe = (v) => (v ?? "").toString().trim();
  const safeOneLine = (v) => safe(v).replace(/\s+/g, " ");
  const safeMultiline = (v) => safe(v); // deja saltos si vienen del user

  const normalizeNoInfo = (v) => {
    const s = safeMultiline(v);
    return s ? s : "No se registró información.";
  };

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
    if (t.includes("venta")) return "Ventas";
    // primera letra mayúscula
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  const asListText = (v) => {
    if (Array.isArray(v)) {
      return v
        .filter(Boolean)
        .map(x => safeOneLine(x))
        .filter(Boolean)
        .join(", ");
    }
    return safeOneLine(v);
  };

  const uniq = (arr) => Array.from(new Set((arr || []).filter(Boolean)));

  const cleanForTable = (s) => safeOneLine(s).replaceAll("|", "/");

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

  const normalizeSectionConfigForPrompt = () => {
    const defaults = template.sections.map(([key, title], index) => ({
      key,
      title,
      description: "",
      enabled: true,
      visible: true,
      applies: true,
      archived: false,
      custom: false,
      order: index
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
        enabled: visible,
        visible,
        applies: item?.applies !== false,
        archived: item?.archived === true,
        custom: item?.custom === true || !defaultKeys.has(key),
        order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index
      });
    });

    defaults.forEach(def => {
      if (!byKey.has(def.key)) byKey.set(def.key, def);
    });

    return Array.from(byKey.values())
      .filter(item => item.archived !== true)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((item, index) => ({ ...item, order: index }));
  };

  const isNoAplica = (status) => {
    const s = safeOneLine(status).toLowerCase();
    return s.includes("no aplica");
  };

  // ---------- Basic header data (compat con legacy fields) ----------
  const dateStr   = toISODateMaybe(m.dateISO || m.date || m.fecha);
  const period    = safeOneLine(m.periodLabel || m.period || m.periodo);
  const employee  = safeOneLine(m.employeeName || m.workerName || m.trabajador || m.nombreTrabajador);
  const role      = safeOneLine(m.role || m.cargo);
  const area      = normalizeArea(m.area) || template.areaDefault;
  const place     = safeOneLine(m.place || m.modalidad || m.lugar);

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

  // ---------- Objective ----------
  // Si no hay objetivo explícito, creamos uno genérico (plantilla válida, no inventa hechos)
  const objective = safeMultiline(m.objective || m.objetivo) ||
    `Realizar seguimiento al desempeño y procesos asociados del/de la ${template.label.toLowerCase()} en Musicala, revisando avances, observaciones, acuerdos y proyección.`;

  // ---------- Sections rendering ----------
  const sectionsObj = (m.sections && typeof m.sections === "object") ? m.sections : {};

  const sectionConfig = normalizeSectionConfigForPrompt();
  const applicableSectionKeys = new Set();

  const hasRelevantText = (v) => {
    const txt = safeOneLine(v).toLowerCase();
    const plain = txt.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return !!plain && plain !== "no se registro informacion" && plain !== "no aplica";
  };

  const renderSection = (item) => {
    const key = item.key;
    const s = (sectionsObj && sectionsObj[key] && typeof sectionsObj[key] === "object") ? sectionsObj[key] : {};

    const st = safeOneLine(s.status) || "No registrado";
    if (isNoAplica(st)) return "";

    const actions = Array.isArray(s.actions) ? s.actions : [];
    const actionTitles = actions
      .map(a => safeOneLine(a?.title || a?.accion || a))
      .filter(Boolean)
      .slice(0, 12);

    const notesRaw = safeMultiline(s.notes || s.note || s.comentarios);
    if (!hasRelevantText(notesRaw) && !actionTitles.length) return "";

    applicableSectionKeys.add(key);

    const title = item.title || safeOneLine(s.sectionTitle) || key;
    const notes = normalizeNoInfo(notesRaw);
    const description = safeMultiline(item.description)
      ? "- Guia interna de la seccion: " + safeMultiline(item.description)
      : "";

    const actionsText = actionTitles.length
      ? "- Acuerdos (insumo para reescribir):\n" + actionTitles.map(x => "  - " + x).join("\n")
      : "- Acuerdos: No se registro informacion.";

    return [
      "## " + title,
      description,
      "- Estado: " + st,
      "- Notas (insumo para reescribir): " + notes,
      actionsText,
      ""
    ].filter(line => line !== "").join("\n");
  };

  const sectionLines = sectionConfig
    .filter(item => item.enabled !== false && item.visible !== false && item.applies !== false && item.archived !== true)
    .map(item => renderSection(item))
    .filter(Boolean)
    .join("\n") || "No se registraron secciones aplicables para incluir en el acta.";

  // ---------- Agreements / actionItems (consolidado) ----------
  const rawActionItems =
    Array.isArray(m.actionItems) ? m.actionItems
    : Array.isArray(m.acuerdos) ? m.acuerdos
    : Array.isArray(m.compromisos) ? m.compromisos
    : Array.isArray(m.acciones) ? m.acciones
    : [];

  const actionItems = rawActionItems.filter(a => {
    const obj = (a && typeof a === "object") ? a : {};
    const key = safeOneLine(obj.sectionKey || obj.seccionKey || "");
    // Si no hay sección asociada, lo conservamos para no perder información registrada.
    if (!key) return true;
    return applicableSectionKeys.has(key);
  });

  const normalizeAction = (a) => {
    const obj = (a && typeof a === "object") ? a : { title: a };
    return {
      title: safeOneLine(obj.title || obj.accion || obj.acuerdo) || "No se registró información",
      owner: safeOneLine(obj.owner || obj.responsable) || "No se registró información",
      due:   toISODateMaybe(obj.dueDateISO || obj.fecha || obj.due) || "No se registró información",
      st:    safeOneLine(obj.status || obj.estado) || "pendiente",
      sec:   safeOneLine(obj.sectionTitle || obj.sectionKey || obj.seccion) || "No se registró información",
      obs:   safeMultiline(obj.details || obj.observaciones || obj.notas) || "No se registró información",
    };
  };

  const actionsTable = (() => {
    if (!actionItems.length) {
      return [
        "| Acción | Responsable | Fecha | Estado | Observaciones |",
        "|---|---|---|---|---|",
        "| No se registró información | No se registró información | No se registró información | No se registró información | No se registró información |"
      ].join("\n");
    }

    const rows = actionItems.slice(0, 80).map(a => {
      const x = normalizeAction(a);
      return `| ${cleanForTable(x.title)} | ${cleanForTable(x.owner)} | ${cleanForTable(x.due)} | ${cleanForTable(x.st)} | ${cleanForTable(x.obs)} |`;
    });

    return [
      "| Acción | Responsable | Fecha | Estado | Observaciones |",
      "|---|---|---|---|---|",
      ...rows
    ].join("\n");
  })();

  const actionsBlock = actionItems.length
    ? actionItems.slice(0, 80).map((a, i) => {
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
    "Eres ChatGPT y tu tarea es redactar un ACTA institucional, formal, clara y profesional a partir del contenido registrado abajo.",
    "",
    "REGLAS CRÍTICAS (OBLIGATORIAS):",
    "- NO inventes información ni agregues hechos, fechas, cifras, nombres o situaciones que no estén registradas.",
    "- Si un dato aplicable no está registrado, escribe exactamente: 'No se registró información'. (Sin sinónimos.)",
    "- Omite por completo las secciones marcadas como 'No aplica' o configuradas como ocultas. No las menciones en el acta final.",
    "",
    "REDACTOR PROFESIONAL (MUY IMPORTANTE):",
    "- NO transcribas ni copies textualmente ningún texto del contenido registrado.",
    "- Debes reescribir con OTRAS PALABRAS todo: notas, observaciones, acuerdos, compromisos, comentarios y cierre.",
    "- Mantén fielmente el sentido de lo escrito, pero convierte frases rápidas o informales en redacción institucional formal.",
    "- Tu salida debe sonar como un acta oficial: coherente, ordenada, precisa y bien redactada.",
    "- Puedes ampliar la explicación para que el texto sea claro y completo, siempre y cuando NO agregues hechos nuevos.",
    "",
    "FORMATO Y ESTILO:",
    "- Español neutro-formal, fácil de leer.",
    "- Evita muletillas y repeticiones.",
    "- Usa conectores y redacción fluida.",
    "- No regañes ni dramatices. Mantén tono institucional humano.",
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
    "OBJETIVO DE LA REUNIÓN (usar este texto como base, puedes reescribirlo con otras palabras sin cambiar el sentido):",
    objective ? `- ${objective}` : "- No se registró información",
    "",
    "ESTRUCTURA OBLIGATORIA DEL ACTA (ENTREGABLE FINAL):",
    "1) Encabezado (datos básicos)",
    "2) Objetivo de la reunión",
    "3) Desarrollo por secciones aplicables únicamente (redacción formal basada en las notas; incluir Estado + redacción; omitir secciones No aplica)",
    "4) Acuerdos y compromisos (TABLA: Acción | Responsable | Fecha | Estado | Observaciones; redactar formalmente, no copiar textual)",
    "5) Cierre (resumen breve + constancia)",
    "6) Firmas (Musicala / Trabajador)",
    "",
    "ENTREGA:",
    "- Devuelve el acta completa ya redactada, lista para copiar y pegar.",
    "- No incluyas explicaciones meta del tipo 'a continuación' o 'según lo proporcionado'.",
    ""
  ].join("\n");

  // ---------- Final prompt ----------
  return [
    header,
    "CONTENIDO REGISTRADO (INSUMO BASE. PROHIBIDO COPIAR TEXTUAL):",
    "",
    sectionLines,
    "## Acuerdos y compromisos (consolidado) — DETALLE (insumo)",
    actionsBlock,
    "",
    "## Acuerdos y compromisos (consolidado) — TABLA DE INSUMO (reescribir formalmente, no copiar textual)",
    actionsTable,
    "",
    "REDACTA AHORA el ACTA COMPLETA siguiendo la ESTRUCTURA OBLIGATORIA.",
    "Recuerda: reescribe con otras palabras TODO lo escrito, mejora claridad y formalidad, omite lo marcado como No aplica y NO inventes. Si falta algo aplicable: 'No se registró información'."
  ].join("\n");
}