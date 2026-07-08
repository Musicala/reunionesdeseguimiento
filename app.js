'use strict';

console.log("APP JS CARGÓ ✅ (v4 — herramienta de conducción de reuniones)");

// Firestore
import {
  collection, addDoc, doc, getDoc, setDoc, updateDoc, deleteDoc,
  query, orderBy, limit, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import { db, auth, googleProvider, ALLOWED_EMAILS } from "./firebase.js";
import { buildPrompt } from "./prompt.js";

/* =====================================================================
   ESTADOS DE SECCIÓN (nuevos) + migración desde estados viejos
===================================================================== */
const STATUS_OPTIONS = [
  "⚪ No revisado",
  "⭕ No aplica",
  "🟢 Bien / Sostenido",
  "🟡 En observación",
  "🔴 Por mejorar",
  "🟣 Crítico",
  "✅ Resuelto"
];
const STATUS_DEFAULT = "⚪ No revisado";

// Mapea estados viejos -> nuevos. Si ya es nuevo, se respeta.
function migrateStatus(raw){
  const s = safeTrim(raw);
  if (!s) return STATUS_DEFAULT;
  if (STATUS_OPTIONS.includes(s)) return s;
  const t = s.toLowerCase();
  if (t.includes("no aplica")) return "⭕ No aplica";
  if (t.includes("no revisado")) return "⚪ No revisado";
  if (t.includes("bien") || t.includes("sosten")) return "🟢 Bien / Sostenido";
  if (t.includes("observ")) return "🟡 En observación";
  if (t.includes("en proceso") || t.includes("en progreso")) return "🟡 En observación";
  if (t.includes("por mejorar") || t.includes("mejorar")) return "🔴 Por mejorar";
  if (t.includes("crit")) return "🟣 Crítico";
  if (t.includes("resuel")) return "✅ Resuelto";
  return STATUS_DEFAULT;
}

function statusIsNoAplica(status){
  return safeTrim(status).toLowerCase().includes("no aplica");
}
function statusIsNoRevisado(status){
  return safeTrim(status).toLowerCase().includes("no revisado");
}

/* =====================================================================
   MODELO DE ACUERDOS (ampliado)
===================================================================== */
const ACTION_TYPES = ["acción", "acuerdo", "apoyo de Musicala", "escalamiento", "seguimiento"];
const ACTION_PRIORITIES = ["baja", "media", "alta", "crítica"];
const ACTION_STATUS = ["pendiente", "en proceso", "cumplido", "no cumplido", "reprogramado", "ya no aplica"];
const ACTION_DONE_STATES = ["cumplido", "listo", "resuelto", "ya no aplica"]; // para seguimiento de acuerdos previos

function migrateActionStatus(raw){
  const s = safeTrim(raw).toLowerCase();
  if (!s) return "pendiente";
  if (ACTION_STATUS.includes(s)) return s;
  if (s.includes("progreso") || s.includes("proceso")) return "en proceso";
  if (s.includes("listo") || s.includes("resuel") || s.includes("cumplid")) return "cumplido";
  if (s.includes("no cumpl")) return "no cumplido";
  if (s.includes("reprog")) return "reprogramado";
  if (s.includes("no aplica")) return "ya no aplica";
  return "pendiente";
}

// Estados de seguimiento para acuerdos de reuniones anteriores
const FOLLOW_STATUS = ["Pendiente de revisar", "Cumplido", "En proceso", "No cumplido", "Reprogramado", "Ya no aplica"];
// Estados de seguimiento que dan por resuelto el compromiso (no se arrastra a la siguiente acta)
const FOLLOW_DONE_STATES = ["Cumplido", "Ya no aplica"];

/* =====================================================================
   TIPOS DE REUNIÓN
===================================================================== */
const MEETING_KINDS = [
  "Seguimiento ordinario",
  "Retroalimentación preventiva",
  "Plan de mejora",
  "Llamado de atención formal",
  "Revisión de continuidad",
  "Otro"
];
// Tipos que requieren la advertencia de trazabilidad / debido proceso
const DISCIPLINARY_KINDS = ["Plan de mejora", "Llamado de atención formal", "Revisión de continuidad"];
const DISCIPLINARY_ALERT_TEXT =
  "Esta reunión debe conservar un enfoque de seguimiento y trazabilidad. " +
  "Si se va a imponer una sanción disciplinaria o realizar descargos, debe manejarse " +
  "mediante citación y procedimiento separado.";

// Encuadre por defecto (editable por el usuario)
const DEFAULT_MEETING_FRAME =
  "El objetivo de esta reunión es revisar el periodo evaluado, identificar avances, " +
  "escuchar la percepción del trabajador, revisar oportunidades de mejora y definir acuerdos " +
  "concretos para el siguiente ciclo. Esta reunión corresponde a un espacio de seguimiento y " +
  "retroalimentación, y no constituye por sí misma una diligencia de descargos ni una decisión disciplinaria.";

/* =====================================================================
   PLANTILLAS (secciones por tipo)
   NOTA: "Encuadre" y "Seguimiento de acuerdos anteriores" se manejan como
   tarjetas dedicadas (no como secciones de notas) para no duplicar.
===================================================================== */
const TEMPLATES = {
  admin: {
    key: "admin",
    label: "Administrativos",
    titleSuffix: "Admin",
    sections: [
      { key:"agradecimiento",     title:"Reconocimiento de avances y aspectos positivos del periodo" },
      { key:"retroEstudiantes",   title:"Retroalimentaciones de estudiantes o usuarios" },
      { key:"retroAdmin",         title:"Retroalimentaciones administrativas internas" },
      { key:"distintivos",        title:"Cumplimiento de protocolos y distintivos" },
      { key:"puntualidad",        title:"Puntualidad y registro de jornadas" },
      { key:"bitacora",           title:"Bitácora, tareas y trazabilidad del cargo" },
      { key:"comunicacion",       title:"Calidad de comunicación y atención" },
      { key:"funcionesCargo",     title:"Funciones del cargo y claridad de responsabilidades" },
      { key:"kpis",               title:"KPI's o indicadores del periodo" },
      { key:"bloqueos",           title:"Bloqueos, riesgos o dificultades para cumplir el cargo" },
      { key:"apoyosMusicala",     title:"Apoyos requeridos por Musicala" },
      { key:"proyeccion",         title:"Proyección del siguiente periodo" },
      { key:"palabrasTrabajador", title:"Palabras del trabajador" },
      { key:"mejorasCargo",       title:"Retroalimentaciones y puntos de mejora" },
      { key:"bienestar",          title:"Espacios de bienestar" },
      { key:"cierre",             title:"Cierre de entendimiento y observaciones finales" },
    ]
  },
  docente: {
    key: "docente",
    label: "Docentes",
    titleSuffix: "Docente",
    sections: [
      { key:"agradecimiento",       title:"Reconocimiento de avances y aspectos positivos del periodo" },
      { key:"registroClases",       title:"Registro de clases" },
      { key:"planeacion",           title:"Planeación y bitácora pedagógica" },
      { key:"manejoGrupo",          title:"Manejo de grupo" },
      { key:"relacionEstudiantes",  title:"Relación con estudiantes, líderes o acudientes" },
      { key:"muestrasProceso",      title:"Muestras de proceso" },
      { key:"avancesPedagogicos",   title:"Avances pedagógicos" },
      { key:"apoyoInstitucional",   title:"Necesidades de apoyo institucional" },
      { key:"puntualidad",          title:"Puntualidad y registro de jornadas" },
      { key:"proyeccion",           title:"Proyección del siguiente periodo" },
      { key:"palabrasDocente",      title:"Palabras del docente" },
      { key:"bienestar",            title:"Espacios de bienestar" },
    ]
  }
};

// Migración de títulos viejos -> nuevos (para sectionConfig guardado en docs antiguos)
const BASE_SECTION_TEXTS = {
  admin: {
    agradecimiento: "Durante el periodo se reconoce la disposición para el desarrollo de las funciones asignadas y la continuidad de los procesos propios del cargo.",
    retroEstudiantes: "Durante el periodo no se registraron novedades relevantes en las retroalimentaciones recibidas por parte de estudiantes o usuarios. Se continuará haciendo seguimiento a la calidad del servicio y la atención brindada.",
    retroAdmin: "En el seguimiento administrativo del periodo no se identificaron novedades relevantes. Se mantiene la recomendación de continuar fortaleciendo la coordinación, la comunicación interna y el cumplimiento oportuno de los procesos.",
    distintivos: "Durante el periodo se dio cumplimiento general a los protocolos institucionales y al uso de los distintivos requeridos para el desarrollo de las actividades.",
    puntualidad: "Durante el periodo se mantuvo el seguimiento habitual a la puntualidad y al registro de las jornadas, sin novedades relevantes que requieran un acuerdo adicional.",
    bitacora: "La bitácora y las tareas del cargo se mantuvieron como herramientas de seguimiento y trazabilidad. Se recomienda continuar registrando oportunamente los avances, pendientes y novedades de cada proceso.",
    comunicacion: "La comunicación y la atención asociadas al cargo se desarrollaron de manera adecuada durante el periodo. Se invita a mantener mensajes claros, oportunos y acordes con los canales institucionales.",
    funcionesCargo: "Se revisaron las funciones y responsabilidades del cargo, sin identificarse cambios relevantes para el periodo. Se continuará dando cumplimiento a las tareas habituales y realizando seguimiento a las prioridades definidas.",
    kpis: "Se revisaron los indicadores disponibles del periodo como parte del seguimiento habitual. No se registraron novedades adicionales y se continuará observando su evolución en el siguiente ciclo.",
    bloqueos: "No se reportaron bloqueos, riesgos o dificultades relevantes que impidieran el cumplimiento general de las funciones durante el periodo.",
    apoyosMusicala: "No se identificaron apoyos institucionales adicionales para este periodo. Musicala continuará brindando el acompañamiento habitual requerido para el desarrollo del cargo.",
    proyeccion: "Para el siguiente periodo se proyecta dar continuidad a las funciones del cargo, atender las prioridades definidas y mantener seguimiento a los procesos en curso.",
    palabrasTrabajador: "La persona trabajadora manifestó comprensión frente a los temas revisados y no presentó observaciones adicionales para dejar registradas en esta sección.",
    mejorasCargo: "No se identificaron puntos críticos de mejora durante el periodo. Se recomienda mantener las prácticas que vienen funcionando y continuar fortaleciendo la organización, la comunicación y el seguimiento de las responsabilidades.",
    bienestar: "No se reportaron novedades de bienestar que requirieran una acción específica durante el periodo. Se mantiene abierto el espacio institucional para comunicar oportunamente cualquier situación que necesite acompañamiento.",
    cierre: "Las partes manifestaron comprensión de los temas revisados. Se acuerda dar continuidad a las responsabilidades habituales y realizar seguimiento en la próxima reunión periódica."
  },
  docente: {
    agradecimiento: "Durante el periodo se reconoce la disposición del docente y la continuidad de su labor pedagógica con los grupos y estudiantes asignados.",
    registroClases: "Los registros de clase se mantuvieron como parte del seguimiento habitual del proceso. Se recomienda continuar realizándolos de manera completa y oportuna.",
    planeacion: "La planeación y la bitácora pedagógica se desarrollaron como herramientas de organización y trazabilidad. Se invita a mantener actualizados los objetivos, actividades, avances y novedades de cada grupo.",
    manejoGrupo: "Durante el periodo se dio continuidad al manejo habitual de los grupos, sin registrarse novedades relevantes que requieran un acuerdo adicional.",
    relacionEstudiantes: "La relación con estudiantes, líderes y acudientes se mantuvo dentro de los canales institucionales. Se recomienda continuar promoviendo una comunicación clara, respetuosa y oportuna.",
    muestrasProceso: "Se continuará promoviendo el registro y la presentación de muestras de proceso que permitan evidenciar los avances de los estudiantes y grupos.",
    avancesPedagogicos: "Se observaron avances acordes con la continuidad de los procesos pedagógicos. Se recomienda mantener el seguimiento individual y grupal durante el siguiente periodo.",
    apoyoInstitucional: "No se identificaron necesidades adicionales de apoyo institucional durante el periodo. Musicala continuará brindando el acompañamiento habitual para el desarrollo del proceso pedagógico.",
    puntualidad: "Durante el periodo se mantuvo el seguimiento habitual a la puntualidad y al registro de las jornadas, sin novedades relevantes que requieran un acuerdo adicional.",
    proyeccion: "Para el siguiente periodo se proyecta dar continuidad a la planeación, fortalecer los procesos en curso y realizar seguimiento a los avances de cada grupo.",
    palabrasDocente: "El docente manifestó comprensión frente a los temas revisados y no presentó observaciones adicionales para dejar registradas en esta sección.",
    bienestar: "No se reportaron novedades de bienestar que requirieran una acción específica durante el periodo. Se mantiene abierto el espacio institucional para comunicar oportunamente cualquier situación que necesite acompañamiento."
  }
};

function getBaseSectionText(templateKey, sectionKey){
  return BASE_SECTION_TEXTS[templateKey]?.[sectionKey] || "";
}

const TITLE_MIGRATION = {
  "agradecimiento": "Reconocimiento de avances y aspectos positivos del periodo",
  "distintivos": "Cumplimiento de protocolos y distintivos",
  "bitacora": "Bitácora, tareas y trazabilidad del cargo",
  "kpis": "KPI's o indicadores del periodo",
  "proyeccion": "Proyección del siguiente periodo",
  "mejorasCargo": "Retroalimentaciones y puntos de mejora",
  "retroEstudiantes_admin": "Retroalimentaciones de estudiantes o usuarios"
};
const LEGACY_TITLES = new Set([
  "Agradecimiento por el trabajo hasta la fecha",
  "Seguimiento de retroalimentaciones de estudiantes",
  "Seguimiento de retroalimentaciones administrativas (Musicala)",
  "Uso de distintivos (chaqueta, carnet)",
  "Bitácora de tareas",
  "KPI's",
  "Proyección",
  "Retroalimentaciones y puntos de mejora en el cargo"
]);

/* =====================================================================
   GUÍAS DEL FACILITADOR (solo ayuda visual; NO se guardan en el acta)
   Estructura por key de sección:
   { open, ask, feedback, listen, close, avoid } (arrays de strings)
   Edita libremente este diccionario para ajustar el tono.
===================================================================== */
const FACILITATOR_GUIDES = {
  // ---------- Tarjetas dedicadas ----------
  previousAgreements: {
    open: ["Vamos a revisar los acuerdos anteriores para saber qué avanzó, qué sigue pendiente y qué necesita ajustarse."],
    ask: [
      "¿Qué avances hubo frente a este acuerdo?",
      "¿Hubo alguna dificultad para cumplirlo?",
      "¿Este acuerdo sigue siendo útil o debemos reformularlo?"
    ],
    close: ["Definamos si queda cumplido, en proceso, reprogramado o si requiere otro tipo de seguimiento."],
    avoid: ["Esto otra vez no se hizo.", "Ya habíamos hablado de esto mil veces."]
  },

  // ---------- Administrativos ----------
  agradecimiento: {
    open: ["Antes de revisar puntos de mejora, queremos reconocer los avances o aspectos positivos que vimos en este periodo."],
    ask: ["¿Qué sientes que lograste mejorar este periodo?", "¿Qué parte de tu trabajo sentiste más fluida?"],
    feedback: ["No se trata de agradecer el cumplimiento básico, sino de reconocer avances concretos."],
    close: ["Dejemos identificado qué vale la pena sostener para el siguiente periodo."],
    avoid: ["Gracias por hacer tu trabajo.", "Nos hiciste el favor de…"]
  },
  retroEstudiantes: {
    open: ["Vamos a revisar comentarios o señales recibidas de usuarios, estudiantes o familias, enfocándonos en el servicio y la experiencia."],
    ask: ["¿Qué crees que puede estar percibiendo el usuario?", "¿Hay algo del proceso que esté dificultando una mejor atención?"],
    close: ["Convirtamos esto en una acción concreta sobre la experiencia del usuario."],
    avoid: ["La gente se quejó de ti.", "Todos dicen que…"]
  },
  retroAdmin: {
    open: ["Queremos revisar algunos puntos internos del equipo y de los procesos de Musicala."],
    ask: ["¿Cómo has sentido la comunicación interna?", "¿Qué parte del proceso administrativo te ha resultado más difícil?"],
    close: ["Dejemos claro qué debe ajustar cada parte."],
    avoid: ["El problema eres tú.", "No entiendes cómo trabajamos."]
  },
  distintivos: {
    open: ["Vamos a revisar el cumplimiento de protocolos, presentación institucional y uso de distintivos."],
    ask: ["¿Hay alguna dificultad para cumplir este protocolo?", "¿El protocolo está claro o necesita explicarse mejor?"],
    close: ["Definamos si este punto se mantiene, se refuerza o requiere ajuste."],
    avoid: ["Eso es obvio.", "No debería tocar recordarlo."]
  },
  puntualidad: {
    open: ["Vamos a revisar puntualidad, registros y cumplimiento de jornada desde los datos disponibles."],
    ask: ["¿Hubo alguna situación que afectara los registros o la puntualidad?", "¿El sistema de registro está funcionando bien?"],
    close: ["Dejemos claro el acuerdo de cumplimiento o ajuste para el próximo periodo."],
    avoid: ["Siempre llegas tarde.", "Eso muestra falta de compromiso."]
  },
  bitacora: {
    open: ["Vamos a revisar cómo se están registrando las tareas y si la trazabilidad está ayudando al proceso."],
    ask: [
      "¿La bitácora está siendo útil?",
      "¿Qué tareas quedan sin registrar y por qué?",
      "¿Hay una forma más simple de registrar sin perder control?"
    ],
    close: ["Definamos qué se mantiene, qué se simplifica y qué debe registrarse obligatoriamente."],
    avoid: ["Llenar eso porque sí.", "Eso toca porque toca."]
  },
  comunicacion: {
    open: ["Vamos a revisar la forma en que se está comunicando la información a usuarios y equipo."],
    ask: [
      "¿Qué parte de la comunicación te cuesta más?",
      "¿Sientes que tienes suficientes ejemplos o plantillas para responder?",
      "¿Qué errores se han repetido y cómo los podemos prevenir?"
    ],
    feedback: [
      "Queremos revisar el efecto del mensaje, no juzgar tu intención.",
      "A veces la intención puede ser buena, pero el mensaje puede sentirse cortante o incompleto."
    ],
    close: ["Dejemos ejemplos o criterios concretos para mejorar la comunicación."],
    avoid: ["Eres cortante.", "No sabes hablar con la gente.", "Eso sonó horrible."]
  },
  funcionesCargo: {
    open: ["Queremos revisar si las funciones están claras y si hay tareas que necesitan mejor distribución."],
    ask: [
      "¿Qué responsabilidades sientes claras?",
      "¿Qué tareas sientes ambiguas o sin dueño?",
      "¿Hay algo que estés asumiendo y no debería estar en tu cargo?"
    ],
    close: ["Dejemos claro qué queda bajo tu responsabilidad y qué debe ajustar Musicala."],
    avoid: ["Eso no es problema nuestro.", "Usted verá cómo se organiza."]
  },
  kpis: {
    open: ["Vamos a revisar los indicadores del periodo para entender resultados, no para reducir el trabajo a números."],
    ask: [
      "¿Qué explica este resultado?",
      "¿Qué acción concreta puede mejorar este indicador?",
      "¿Hay un bloqueo que esté afectando el cumplimiento?"
    ],
    close: ["Definamos un objetivo realista para el siguiente periodo."],
    avoid: ["Los números hablan solos.", "Eso está mal y ya."]
  },
  bloqueos: {
    open: ["Queremos identificar qué está dificultando el cumplimiento del cargo para no asumir que todo depende solo de la persona."],
    ask: [
      "¿Qué te está bloqueando?",
      "¿Qué proceso, herramienta o instrucción necesita mejorar?",
      "¿Qué riesgo ves si esto sigue igual?"
    ],
    close: ["Separemos qué depende de ti y qué debe resolver Musicala."],
    avoid: ["Eso suena a excusa.", "Todos tienen problemas."]
  },
  apoyosMusicala: {
    open: ["Así como revisamos compromisos del cargo, también queremos dejar claro qué apoyo debe brindar Musicala."],
    ask: [
      "¿Qué necesitas para cumplir mejor este punto?",
      "¿Te serviría una plantilla, capacitación, explicación, acompañamiento o ajuste del proceso?"
    ],
    close: ["Dejemos el apoyo como acuerdo institucional si corresponde."],
    avoid: ["Eso ya se explicó.", "Busque cómo hacerlo."]
  },
  proyeccion: {
    open: ["Vamos a cerrar proyectando qué debe pasar en el siguiente periodo."],
    ask: ["¿Cuál debería ser el foco principal del siguiente mes?", "¿Qué sería una mejora visible y alcanzable?"],
    close: ["Dejemos uno o dos focos claros para no salir con una lista infinita imposible."],
    avoid: ["Hay que mejorar todo."]
  },
  palabrasTrabajador: {
    open: ["Queremos darte un espacio para dejar tu percepción, comentarios, aclaraciones o desacuerdos."],
    ask: [
      "¿Hay algo que quieras aclarar?",
      "¿Hay algo con lo que no estés de acuerdo?",
      "¿Hay algo que quieras que quede registrado en el acta?"
    ],
    close: ["Vamos a dejar registrada tu intervención de forma clara y respetuosa."],
    avoid: ["Eso no tiene nada que ver.", "No estamos hablando de eso."]
  },
  mejorasCargo: {
    open: ["Vamos a sintetizar los principales puntos de mejora del periodo."],
    ask: ["¿Cuál de estos puntos consideras más importante trabajar primero?", "¿Qué acción concreta ayudaría a corregirlo?"],
    close: ["Convirtamos los puntos de mejora en acuerdos medibles."],
    avoid: ["Esto está mal.", "Ya deberías haberlo corregido."]
  },
  bienestar: {
    open: ["Queremos revisar si hay algo del entorno laboral que esté afectando el bienestar o el desarrollo del trabajo."],
    ask: [
      "¿Cómo te has sentido en el entorno laboral?",
      "¿Hay algo que pueda mejorar la dinámica de trabajo?",
      "¿Hay alguna situación que debamos conocer para prevenir desgaste?"
    ],
    close: ["Dejemos claro si hay alguna acción de cuidado, ajuste o seguimiento."],
    avoid: ["Eso es personal.", "Todos estamos cansados."]
  },
  cierre: {
    open: ["Vamos a cerrar resumiendo los acuerdos y verificando que todos entendimos lo mismo."],
    ask: [
      "¿Los acuerdos quedaron claros?",
      "¿Quieres agregar alguna observación final?",
      "¿Hay algún punto que quieras dejar aclarado antes de cerrar?"
    ],
    close: ["Con esto queda registrada la reunión y los compromisos para el siguiente seguimiento."],
    avoid: ["Bueno, ya, firme.", "Eso fue lo que se dijo y punto."]
  },

  // ---------- Docentes ----------
  registroClases: {
    open: ["Vamos a revisar el registro de clases para ver continuidad, cumplimiento y trazabilidad del proceso."],
    ask: ["¿El registro está al día?", "¿Hay clases sin registrar y por qué?"],
    close: ["Definamos qué se mantiene y qué debe ajustarse en el registro."],
    avoid: ["Otra vez sin registrar.", "Eso es lo mínimo."]
  },
  planeacion: {
    open: ["Vamos a revisar la planeación y la bitácora pedagógica para ver cómo está orientando el proceso."],
    ask: ["¿La planeación te está sirviendo como guía real?", "¿Qué parte de la planeación se complica más?"],
    close: ["Dejemos claro qué ajustes de planeación probamos el próximo periodo."],
    avoid: ["Eso debería estar listo siempre.", "Improvisaste."]
  },
  manejoGrupo: {
    open: ["Vamos a revisar cómo ha venido funcionando el manejo de grupo y qué estrategias están ayudando o faltan."],
    ask: [
      "¿Qué situaciones se han repetido con el grupo?",
      "¿Qué estrategias han funcionado?",
      "¿Qué apoyo necesitas de Musicala o del centro?"
    ],
    feedback: ["Queremos revisar la estrategia pedagógica y el contexto del grupo, no personalizar el problema."],
    close: ["Definamos una estrategia concreta para probar en el siguiente periodo."],
    avoid: ["Ese grupo se te salió de las manos.", "No tienes manejo de grupo."]
  },
  relacionEstudiantes: {
    open: ["Vamos a revisar la relación con estudiantes, líderes o acudientes, enfocándonos en la comunicación y el acompañamiento."],
    ask: ["¿Cómo ha sido la comunicación con acudientes o líderes?", "¿Hay alguna situación que requiera apoyo?"],
    close: ["Dejemos claras las acciones de comunicación o acompañamiento que correspondan."],
    avoid: ["Los papás se quejaron de ti.", "Tú no sabes tratar a la gente."]
  },
  muestrasProceso: {
    open: ["Vamos a revisar las muestras de proceso para evidenciar avances de los estudiantes y del trabajo pedagógico."],
    ask: ["¿Qué muestran los procesos de los estudiantes?", "¿Qué necesitas para documentar mejor el avance?"],
    close: ["Definamos qué evidencia de proceso vamos a sostener el próximo periodo."],
    avoid: ["No hay nada que mostrar.", "Eso no sirve."]
  },
  avancesPedagogicos: {
    open: ["Vamos a revisar los avances pedagógicos del periodo, tanto del grupo como tuyos como docente."],
    ask: ["¿Qué avance pedagógico destacas?", "¿Qué te gustaría fortalecer como docente?"],
    close: ["Dejemos identificado qué sostener y qué fortalecer."],
    avoid: ["No se ve ningún avance.", "Sigues igual."]
  },
  apoyoInstitucional: {
    open: ["Queremos dejar claro qué apoyo institucional necesitas para hacer mejor tu trabajo."],
    ask: ["¿Qué necesitas de Musicala o del centro?", "¿Te serviría capacitación, materiales o acompañamiento?"],
    close: ["Dejemos el apoyo como acuerdo institucional si corresponde."],
    avoid: ["Resuélvalo usted.", "Eso no nos corresponde."]
  },
  palabrasDocente: {
    open: ["Queremos darte un espacio para dejar tu percepción, comentarios, aclaraciones o desacuerdos."],
    ask: ["¿Hay algo que quieras aclarar?", "¿Hay algo con lo que no estés de acuerdo?", "¿Hay algo que quieras que quede registrado en el acta?"],
    close: ["Vamos a dejar registrada tu intervención de forma clara y respetuosa."],
    avoid: ["Eso no tiene nada que ver.", "No estamos hablando de eso."]
  }
};

const GUIDE_LABELS = {
  open: "Para abrir la sección",
  ask: "Preguntas sugeridas",
  feedback: "Frases de retroalimentación cuidadosa",
  listen: "Frases para escuchar al trabajador",
  close: "Cómo cerrar la sección",
  avoid: "Qué evitar decir"
};
const GUIDE_ORDER = ["open", "ask", "feedback", "listen", "close", "avoid"];

/* =====================================================================
   FRASES GUÍA GENERALES (editables) — solo ayuda visual
===================================================================== */
const GENERAL_GUIDE_PHRASES = {
  "Apertura": [
    "La idea de este espacio es revisar cómo vamos, escuchar tu percepción y dejar acuerdos claros.",
    "Queremos que esta conversación sea concreta, respetuosa y útil para ambas partes.",
    "No buscamos personalizar los temas, sino entender qué está funcionando y qué necesita ajuste."
  ],
  "Cuando se va a dar una retroalimentación": [
    "Te compartimos esto desde el proceso, no como una valoración personal.",
    "Lo que necesitamos revisar es el impacto de esta situación en el trabajo, el equipo o los usuarios.",
    "Queremos entender también tu versión antes de definir cualquier acuerdo."
  ],
  "Cuando el trabajador se pone a la defensiva": [
    "Entendemos que pueda sentirse incómodo. La intención no es atacar, sino aclarar y mejorar.",
    "Podemos separar la emoción del momento del punto concreto que necesitamos revisar.",
    "Tomemos un momento para ordenar la idea y volvamos al hecho específico."
  ],
  "Cuando hay desacuerdo": [
    "Dejemos registrada tu aclaración para que el acta refleje ambas miradas.",
    "No necesitamos forzar un acuerdo total sobre la percepción, pero sí definir cómo vamos a actuar hacia adelante.",
    "Podemos dejar constancia de que tienes una lectura distinta del punto."
  ],
  "Cuando se necesita concretar": [
    "Para que esto no quede en algo general, ¿qué acción concreta podemos definir?",
    "¿Quién queda responsable de este punto y para cuándo lo revisamos?",
    "¿Qué evidencia nos permitiría saber que esto mejoró?"
  ],
  "Cuando se habla de apoyo de Musicala": [
    "También queremos revisar qué necesitas de Musicala para poder cumplir mejor este punto.",
    "Si hay una barrera del proceso, herramienta o comunicación, dejémosla identificada.",
    "La mejora no depende solo de pedir cambios, también de revisar qué apoyo institucional hace falta."
  ],
  "Cierre": [
    "Voy a resumir los acuerdos para confirmar que todos entendimos lo mismo.",
    "¿Quieres dejar alguna observación, aclaración o desacuerdo registrado?",
    "El objetivo es que salgamos con compromisos claros y una ruta de seguimiento."
  ],
  "Qué evitar decir": [
    "Tú siempre…", "Tú nunca…", "Eso es actitud.", "No te lo tomes personal.",
    "Ya deberías saberlo.", "Nos tienes cansados.", "Eso es obvio.", "Si no te gusta…",
    "Mira a ver qué haces.", "Esto es por tu bien."
  ]
};

/* =====================================================================
   CONFIG DE SECCIONES
===================================================================== */
function defaultSectionConfig(templateKey = "admin"){
  const tpl = TEMPLATES[templateKey] || TEMPLATES.admin;
  return tpl.sections.map((s, index) => ({
    key: s.key,
    title: s.title,
    description: s.description || "",
    enabled: true,
    visible: true,
    applies: true,
    archived: false,
    custom: false,
    order: index
  }));
}

function allDefaultSections(){
  return Object.values(TEMPLATES).flatMap(t => t.sections);
}

function migrateTitle(key, title){
  const t = safeTrim(title);
  // Si el título guardado es uno legacy conocido, forzamos el nuevo título del default.
  if (!t || LEGACY_TITLES.has(t)){
    const def = allDefaultSections().find(s => s.key === key);
    if (def) return def.title;
  }
  return t;
}

function normalizeSectionConfig(meeting){
  const templateKey = templateFromMeeting(meeting);
  const defaults = defaultSectionConfig(templateKey);
  const incoming = Array.isArray(meeting?.sectionConfig) ? meeting.sectionConfig : [];
  const byKey = new Map();
  const defaultKeys = new Set(defaults.map(def => def.key));

  incoming.forEach((item, index) => {
    const key = safeTrim(item?.key);
    if (!key) return;
    const def = defaults.find(d => d.key === key);
    const visible = item?.visible !== false && item?.enabled !== false;
    const custom = item?.custom === true || !defaultKeys.has(key);
    byKey.set(key, {
      key,
      title: migrateTitle(key, safeTrim(item?.title) || def?.title || key) || def?.title || key,
      description: safeTrim(item?.description || item?.guide || def?.description || ""),
      enabled: visible,
      visible,
      applies: item?.applies !== false,
      archived: item?.archived === true,
      custom,
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
}

function getSectionTitleByKey(meeting, key){
  const cfg = Array.isArray(meeting?.sectionConfig) ? meeting.sectionConfig : defaultSectionConfig(templateFromMeeting(meeting));
  const custom = cfg.find(s => s.key === key);
  if (custom?.title) return custom.title;
  const fallback = allDefaultSections().find(s => s.key === key);
  return fallback?.title || key;
}

/* =====================================================================
   STATE
===================================================================== */
let currentMeetingId = null;
let currentMeeting = null;
let saveTimer = null;
let dirty = false;
let lastMeetingList = [];
let lastSaveError = null;
let currentUserEmail = "";
let appConfig = { workers: [], roles: [], coordinators: [] };

/* =====================================================================
   DOM
===================================================================== */
const $ = id => document.getElementById(id);

const savePill = $("savePill");
const meetingList = $("meetingList");
const emptyList = $("emptyList");
const qEmployee = $("qEmployee");
const fltKind = $("fltKind");
const fltStatus = $("fltStatus");
const noMeetingState = $("noMeetingState");
const meetingOnlyCards = Array.from(document.querySelectorAll(".meetingOnly"));

// Form base
const fDate = $("fDate");
const fPeriod = $("fPeriod");
const fEmployeeName = $("fEmployeeName");
const fRole = $("fRole");
const fCoordinator = $("fCoordinator");
const fArea = $("fArea");
const fTemplate = $("fTemplate");
const fPlace = $("fPlace");
// Form nuevos
const fMeetingKind = $("fMeetingKind");
const fObjective = $("fObjective");
const fMeetingFrame = $("fMeetingFrame");
const disciplinaryAlert = $("disciplinaryAlert");
const appModeLabel = $("appModeLabel");

// Buttons
const btnNew = $("btnNew");
const btnNewEmpty = $("btnNewEmpty");
const btnConfigLists = $("btnConfigLists");
const btnCopyPrompt = $("btnCopyPrompt");
const btnFinalize = $("btnFinalize");
const btnUnfinalize = $("btnUnfinalize");
const btnClearLocal = $("btnClearLocal");
const btnBackupJson = $("btnBackupJson");
const btnDuplicate = $("btnDuplicate");

const btnExpandAll = $("btnExpandAll");
const btnCollapseAll = $("btnCollapseAll");
const btnConfigureSections = $("btnConfigureSections");
const btnCopyActions = $("btnCopyActions");
const btnRefreshPrompt = $("btnRefreshPrompt");
const btnSelectPrompt = $("btnSelectPrompt");

// General guide
const generalGuideBody = $("generalGuideBody");
const btnToggleGeneralGuide = $("btnToggleGeneralGuide");

// Previous actions
const prevActionsList = $("prevActionsList");
const prevActionsEmpty = $("prevActionsEmpty");

// Sections / Actions / Prompt
const sectionsWrap = $("sectionsWrap");
const actionsList = $("actionsList");
const actionsEmpty = $("actionsEmpty");
const promptPreview = $("promptPreview");

const meetingIdTag = $("meetingIdTag");
const statusTag = $("statusTag");
const kindTag = $("kindTag");

// Auth
const authGate = $("authGate");
const btnGoogleLogin = $("btnGoogleLogin");
const authError = $("authError");
const userChip = $("userChip");
const btnLogout = $("btnLogout");

const toast = $("toast");

/* =====================================================================
   HELPERS
===================================================================== */
const isoToday = () => new Date().toISOString().slice(0, 10);

const MESES_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function prevMonthLabel(iso){
  if (!iso) return "";
  const [y, m] = iso.split("-").map(Number);
  if (!y || !m) return "";
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return `${MESES_ES[d.getMonth()]} ${d.getFullYear()}`;
}

// Reverse map: "julio" -> 6 (0-based)
const MES_INDEX = MESES_ES.reduce((acc, name, i) => { acc[name.toLowerCase()] = i; return acc; }, {});

// Recibe un periodo tipo "Junio 2026" y devuelve el mes siguiente "Julio 2026".
function nextMonthLabelFromLabel(label){
  const s = safeTrim(label).toLowerCase();
  const match = s.match(/([a-záéíóú]+)\s+(\d{4})/i);
  if (!match) return "";
  const mi = MES_INDEX[match[1]];
  const year = Number(match[2]);
  if (mi === undefined || !year) return "";
  const d = new Date(year, mi, 1);
  d.setMonth(d.getMonth() + 1);
  return `${MESES_ES[d.getMonth()]} ${d.getFullYear()}`;
}

function setPill(state, msg){
  const map = {
    ok: "🟢 Guardado", saving: "🟡 Guardando…", offline: "🔴 Sin conexión",
    idle: "⚪ Listo", error: "🔴 Error"
  };
  if (!savePill) return;
  savePill.textContent = msg || map[state] || "⚪ Listo";
}

function showToast(msg){
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add("hidden"), 2600);
}

function escapeHtml(s){
  return (s ?? "").toString()
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}
function safeTrim(s){ return (s ?? "").toString().trim(); }

function parseAttendees(text){
  const raw = (text ?? "").split(",").map(x => x.trim()).filter(Boolean);
  return Array.from(new Set(raw));
}

function templateFromMeeting(m){
  const t = safeTrim(m?.template).toLowerCase();
  return TEMPLATES[t] ? t : "admin";
}
function getTemplate(){ return templateFromMeeting(currentMeeting); }

function normEmployeeKey(name){
  return safeTrim(name)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

function getSectionDefs(){
  if (!currentMeeting) return defaultSectionConfig("admin");
  return normalizeSectionConfig(currentMeeting).filter(s => s.visible !== false && s.enabled !== false && s.archived !== true);
}
function getAllSectionDefsForConfig(){
  if (!currentMeeting) return defaultSectionConfig("admin");
  return normalizeSectionConfig(currentMeeting);
}

function nowId(){
  return `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
}

function makeSectionKey(title, existingKeys = []){
  const base = safeTrim(title)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 42) || "nueva-seccion";
  const taken = new Set(existingKeys);
  let key = `custom-${base}`;
  while (taken.has(key)){
    key = `custom-${base}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,5)}`;
  }
  return key;
}

function normalizeAction(a, sectionKey, sectionTitle){
  if (typeof a === "string") a = { title: a };
  a = a || {};
  return {
    id: a.id || nowId(),
    title: safeTrim(a.title || a.accion || a.acuerdo || ""),
    type: ACTION_TYPES.includes(a.type) ? a.type : "acuerdo",
    owner: safeTrim(a.owner || a.responsable || ""),
    dueDateISO: safeTrim(a.dueDateISO || a.fecha || a.due || ""),
    followUpDateISO: safeTrim(a.followUpDateISO || ""),
    priority: ACTION_PRIORITIES.includes(a.priority) ? a.priority : "media",
    status: migrateActionStatus(a.status),
    expectedEvidence: safeTrim(a.expectedEvidence || ""),
    details: safeTrim(a.details || a.observaciones || a.notas || ""),
    sectionKey: sectionKey || safeTrim(a.sectionKey || ""),
    sectionTitle: sectionTitle || safeTrim(a.sectionTitle || ""),
    createdAtLocal: a.createdAtLocal || new Date().toISOString()
  };
}

function actionHasContent(a){
  return !!(safeTrim(a.title) || safeTrim(a.owner) || safeTrim(a.dueDateISO) ||
            safeTrim(a.followUpDateISO) || safeTrim(a.details) || safeTrim(a.expectedEvidence));
}

function ensureSectionShape(sec){
  const out = {
    status: migrateStatus(sec?.status),
    notes: (sec?.notes ?? "").toString(),
    actions: Array.isArray(sec?.actions) ? sec.actions : []
  };
  return out;
}

function ensureMeetingSections(m){
  const config = normalizeSectionConfig(m);
  const defsAll = allDefaultSections();
  const allKeys = Array.from(new Set([
    ...defsAll.map(s => s.key),
    ...config.map(s => s.key),
    ...Object.keys(m.sections || {})
  ]));

  const sections = { ...(m.sections || {}) };
  allKeys.forEach(k => { sections[k] = ensureSectionShape(sections[k]); });

  allKeys.forEach(k => {
    sections[k].actions = (sections[k].actions || []).map(a =>
      normalizeAction(a, k, getSectionTitleByKey(m, k))
    );
  });

  return sections;
}

function sectionHasContent(sec){
  if (!sec) return false;
  const notes = safeTrim(sec.notes);
  const hasNotes = !!notes && notes.toLowerCase() !== "no se registró información";
  const hasActions = (sec.actions || []).some(actionHasContent);
  return hasNotes || hasActions;
}

/* =====================================================================
   LOCAL DRAFT
===================================================================== */
const localKey = () => currentMeetingId ? `acta_draft_${currentMeetingId}` : null;

function saveLocalDraft(){
  if (!currentMeetingId || !currentMeeting) return;
  try{ localStorage.setItem(localKey(), JSON.stringify(currentMeeting)); }
  catch(e){ console.warn("Local draft failed:", e); }
}
function loadLocalDraft(id){
  try{
    const raw = localStorage.getItem(`acta_draft_${id}`);
    return raw ? JSON.parse(raw) : null;
  }catch{ return null; }
}
function clearLocalDraft(){
  if (!currentMeetingId) return;
  localStorage.removeItem(localKey());
  showToast("Borrador local eliminado ✅");
}

/* =====================================================================
   DATA MODEL + MIGRACIÓN
===================================================================== */
function makeBaseMeeting(template = "admin"){
  const t = TEMPLATES[template] ? template : "admin";
  const sections = {};
  allDefaultSections().forEach(s => {
    sections[s.key] = { status: STATUS_DEFAULT, notes:"", actions:[] };
  });

  return {
    status: "draft",
    template: t,
    dateISO: isoToday(),
    periodLabel: "",
    employeeName: "",
    employeeKey: "",
    role: "",
    coordinator: "",
    coordinators: [],
    area: "administrativa",
    attendees: [],
    attendeesText: "",
    place: "",
    meetingKind: "",
    objective: "",
    meetingFrame: DEFAULT_MEETING_FRAME,
    previousActionsReview: [],
    sectionConfig: defaultSectionConfig(t),
    sections,
    actionItems: []
  };
}

function makeEmptyMeeting(overrides = {}){
  const template = TEMPLATES[overrides.template] ? overrides.template : "admin";
  return { ...makeBaseMeeting(template), ...overrides };
}

function normalizeMeeting(m){
  const t = templateFromMeeting(m);
  const base = makeBaseMeeting(t);
  const out = { ...base, ...(m || {}) };

  out.template = templateFromMeeting(out);
  out.sectionConfig = normalizeSectionConfig(out);

  out.attendeesText = (out.attendeesText ?? "").toString();
  out.attendees = Array.isArray(out.attendees) ? out.attendees : parseAttendees(out.attendeesText);
  if (!out.attendeesText && out.attendees.length) out.attendeesText = out.attendees.join(", ");

  out.dateISO = safeTrim(out.dateISO) || isoToday();
  out.place = (out.place ?? "").toString();
  out.role = (out.role ?? "").toString();
  out.coordinator = (out.coordinator ?? "").toString();
  out.coordinators = normalizeList(Array.isArray(out.coordinators) ? out.coordinators : parseAttendees(out.coordinator));
  if (!out.coordinator && out.coordinators.length) out.coordinator = out.coordinators.join(", ");
  if (out.coordinator && !out.coordinators.length) out.coordinators = normalizeList(parseAttendees(out.coordinator));
  if (out.coordinators.length){
    out.attendees = out.coordinators.slice();
    out.attendeesText = out.coordinator;
  }

  // Campos nuevos con defaults seguros
  out.meetingKind = MEETING_KINDS.includes(safeTrim(out.meetingKind)) ? safeTrim(out.meetingKind) : (safeTrim(out.meetingKind) || "");
  out.objective = (out.objective ?? "").toString();
  out.meetingFrame = safeTrim(out.meetingFrame) ? out.meetingFrame.toString() : DEFAULT_MEETING_FRAME;
  out.employeeKey = normEmployeeKey(out.employeeName);
  out.previousActionsReview = Array.isArray(out.previousActionsReview)
    ? out.previousActionsReview.map(normalizePrevReview)
    : [];

  out.sections = ensureMeetingSections(out);
  out.actionItems = consolidateActions(out);

  return out;
}

function normalizePrevReview(r){
  r = r || {};
  return {
    id: r.id || nowId(),
    sourceMeetingId: safeTrim(r.sourceMeetingId),
    sourceDate: safeTrim(r.sourceDate),
    originalTitle: safeTrim(r.originalTitle),
    originalOwner: safeTrim(r.originalOwner),
    previousStatus: safeTrim(r.previousStatus) || "pendiente",
    followStatus: FOLLOW_STATUS.includes(r.followStatus) ? r.followStatus : "Pendiente de revisar",
    comment: safeTrim(r.comment)
  };
}

function mergeMeeting(remote, local){
  const merged = {
    ...(remote || {}),
    ...(local || {}),
    sections: { ...((remote && remote.sections) || {}), ...((local && local.sections) || {}) }
  };
  return normalizeMeeting(merged);
}

/* =====================================================================
   SAVE
===================================================================== */
function debounceSave(){
  if (!currentMeetingId || !currentMeeting) {
    setPill("idle", "⚪ Abre o crea una reunión");
    return;
  }
  dirty = true;
  saveLocalDraft();
  setPill(navigator.onLine ? "saving" : "offline");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow({ silentOk: true }), 900);
}

async function saveNow(opts = {}){
  const { reason = "", silentOk = false } = opts;
  if (!currentMeetingId || !currentMeeting){
    showToast("Primero abre o crea una reunión 🙃");
    return false;
  }
  dirty = true;
  saveLocalDraft();
  currentMeeting.actionItems = consolidateActions(currentMeeting);

  if (!navigator.onLine){
    setPill("offline", "🔴 Sin conexión (guardado local)");
    if (reason) showToast(`${reason} (local) ✅`);
    return true;
  }

  setPill("saving");
  try{
    await saveRemote();
    if (!silentOk){
      if (reason) showToast(`${reason} ✅`);
      else showToast("Guardado ✅");
    }
    return true;
  }catch(e){
    console.error(e);
    lastSaveError = e;
    showToast("Error guardando (quedó local) ⚠️");
    return false;
  }
}

async function saveRemote(){
  if (!navigator.onLine || !currentMeetingId || !currentMeeting) return;
  const ref = doc(db, "meetings", currentMeetingId);

  currentMeeting.actionItems = consolidateActions(currentMeeting);
  currentMeeting.employeeKey = normEmployeeKey(currentMeeting.employeeName);

  const payload = { ...currentMeeting };
  delete payload.createdAt;

  try{
    await updateDoc(ref, {
      ...payload,
      updatedBy: currentUserEmail || "",
      updatedAt: serverTimestamp()
    });
    dirty = false;
    setPill("ok");
    lastSaveError = null;
  }catch(e){
    console.error(e);
    setPill("error");
    lastSaveError = e;
    throw e;
  }
}

/* =====================================================================
   FIRESTORE
===================================================================== */
async function listMeetings(){
  try{
    const q = query(
      collection(db, "meetings"),
      orderBy("updatedAt", "desc"),
      limit(200)
    );
    const snap = await getDocs(q);
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    lastMeetingList = items;
    applyMeetingListFilter();
  }catch(err){
    console.error(err);
    setPill("error");
    showToast("Error cargando reuniones");
  }
}

async function deleteMeeting(id, label){
  if (!id) return;
  const nombre = (label || "").trim() || "esta acta";
  const ok = window.confirm(`¿Seguro que quieres borrar "${nombre}"?\n\nEsta acción NO se puede deshacer.`);
  if (!ok) return;

  if (!navigator.onLine){
    showToast("Sin conexión. No puedo borrar en Firestore ahora ⚠️");
    return;
  }
  try{
    await deleteDoc(doc(db, "meetings", id));
    try{ localStorage.removeItem(`acta_draft_${id}`); }catch{}
    if (currentMeetingId === id){
      currentMeetingId = null; currentMeeting = null; dirty = false;
      meetingIdTag?.classList.add("hidden");
      renderAll();
    }
    await listMeetings();
    showToast("Acta borrada ✅");
  }catch(e){
    console.error(e);
    showToast("No se pudo borrar la acta");
    setPill("error");
  }
}

async function createMeeting(presetOverrides = null){
  if (dirty && currentMeetingId && currentMeeting){
    await saveNow({ reason: "Guardado antes de crear nueva", silentOk: true });
  }
  if (!navigator.onLine){
    showToast("Sin conexión. No puedo crear reunión en Firestore. (Tu borrador local sí se guarda) ⚠️");
    return;
  }

  const suggestedTemplate = (fArea && fArea.value === "academica") ? "docente" : "admin";
  const overrides = presetOverrides || { template: suggestedTemplate };
  const base = normalizeMeeting(makeEmptyMeeting(overrides));

  try{
    const ref = await addDoc(collection(db, "meetings"), {
      ...base,
      createdBy: currentUserEmail || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    await listMeetings(); // refresca antes de abrir para que la siembra vea lo último guardado
    await openMeeting(ref.id);
    showToast("Reunión creada ✅");
  }catch(e){
    console.error(e);
    showToast("No se pudo crear la reunión");
    setPill("error");
  }
}

async function openMeeting(id){
  currentMeetingId = id;
  meetingIdTag?.classList.remove("hidden");
  if (meetingIdTag) meetingIdTag.textContent = `ID: ${id}`;
  setPill("saving", "🟡 Cargando…");

  try{
    const ref = doc(db, "meetings", id);
    const snap = await getDoc(ref);
    if (!snap.exists()){
      setPill("error"); showToast("La reunión no existe"); return;
    }
    const remote = snap.data();
    const local = loadLocalDraft(id);
    currentMeeting = local ? mergeMeeting(remote, local) : normalizeMeeting(remote);

    seedPreviousActionsReview(); // intenta traer acuerdos previos del mismo trabajador

    renderAll();
    saveLocalDraft();
    dirty = false;
    setPill("ok");
    btnCopyPrompt && (btnCopyPrompt.disabled = false);
  }catch(e){
    console.error(e);
    setPill("error");
    showToast("Error abriendo la reunión");
  }
}

/* =====================================================================
   SEGUIMIENTO DE ACUERDOS ANTERIORES
===================================================================== */
function seedPreviousActionsReview(){
  if (!currentMeeting) return;
  // Si ya hay revisión guardada, respetarla.
  if (Array.isArray(currentMeeting.previousActionsReview) && currentMeeting.previousActionsReview.length) return;

  const key = normEmployeeKey(currentMeeting.employeeName);
  if (!key) return;

  const myDate = safeTrim(currentMeeting.dateISO);
  const prior = (lastMeetingList || [])
    .filter(m => m.id !== currentMeetingId)
    .filter(m => normEmployeeKey(m.employeeName) === key)
    .filter(m => safeTrim(m.dateISO) <= myDate) // anteriores o mismas fechas
    .sort((a, b) => safeTrim(b.dateISO).localeCompare(safeTrim(a.dateISO)));

  // Mapa del último seguimiento dado a cada compromiso (por título) en actas anteriores.
  // Si en algún acta posterior se marcó "Cumplido" / "Ya no aplica", no se vuelve a arrastrar.
  const resolvedByTitle = new Map();
  prior.forEach(m => {
    const reviews = Array.isArray(m.previousActionsReview) ? m.previousActionsReview : [];
    const reviewDate = safeTrim(m.dateISO);
    reviews.forEach(r => {
      const tkey = safeTrim(r?.originalTitle).toLowerCase();
      if (!tkey) return;
      const prevEntry = resolvedByTitle.get(tkey);
      if (!prevEntry || reviewDate >= prevEntry.date){
        resolvedByTitle.set(tkey, { date: reviewDate, followStatus: safeTrim(r?.followStatus) });
      }
    });
  });

  const seeded = [];
  prior.forEach(m => {
    const items = Array.isArray(m.actionItems) ? m.actionItems : [];
    items.forEach(a => {
      const st = migrateActionStatus(a?.status);
      if (ACTION_DONE_STATES.includes(st)) return; // ya cerrado en el acta original
      const title = safeTrim(a?.title);
      if (!title) return;
      // Si el compromiso ya quedó resuelto en el seguimiento de un acta posterior, no arrastrarlo.
      const resolved = resolvedByTitle.get(title.toLowerCase());
      if (resolved && FOLLOW_DONE_STATES.includes(resolved.followStatus)) return;
      seeded.push(normalizePrevReview({
        sourceMeetingId: m.id,
        sourceDate: safeTrim(m.dateISO),
        originalTitle: title,
        originalOwner: safeTrim(a?.owner),
        previousStatus: st,
        followStatus: "Pendiente de revisar",
        comment: ""
      }));
    });
  });

  // Evitar duplicados del mismo compromiso: se conserva solo la aparición más reciente
  // (prior ya viene ordenado de más nuevo a más antiguo).
  const seen = new Set();
  currentMeeting.previousActionsReview = seeded.filter(r => {
    const k = r.originalTitle.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).slice(0, 40);
}

function renderPreviousActions(){
  if (!prevActionsList) return;
  prevActionsList.innerHTML = "";
  const list = currentMeeting?.previousActionsReview || [];

  if (!list.length){
    prevActionsEmpty?.classList.remove("hidden");
    prevActionsList.classList.add("hidden");
    return;
  }
  prevActionsEmpty?.classList.add("hidden");
  prevActionsList.classList.remove("hidden");

  list.forEach(r => {
    const row = document.createElement("div");
    row.className = "prevRow";

    const head = document.createElement("div");
    head.className = "prevHead";
    head.innerHTML = `
      <div class="prevTitle">${escapeHtml(r.originalTitle || "—")}</div>
      <div class="prevMeta">${escapeHtml(r.sourceDate || "—")} · estado previo: ${escapeHtml(r.previousStatus || "—")}${r.originalOwner ? " · " + escapeHtml(r.originalOwner) : ""}</div>
    `;

    const ctrl = document.createElement("div");
    ctrl.className = "prevCtrl";

    const sel = document.createElement("select");
    sel.className = "input";
    FOLLOW_STATUS.forEach(s => {
      const op = document.createElement("option");
      op.value = s; op.textContent = s; sel.appendChild(op);
    });
    sel.value = r.followStatus;
    sel.onchange = () => { r.followStatus = sel.value; debounceSave(); renderActionsAndPrompt(); };
    sel.onblur = () => saveNow({ silentOk: true });

    const comment = document.createElement("input");
    comment.className = "input";
    comment.placeholder = "Comentario de seguimiento";
    comment.value = r.comment || "";
    comment.oninput = () => { r.comment = comment.value; debounceSave(); };
    comment.onblur = () => saveNow({ silentOk: true });

    ctrl.append(sel, comment);
    row.append(head, ctrl);
    prevActionsList.appendChild(row);
  });
}

/* =====================================================================
   RENDER LIST + FILTROS
===================================================================== */
function renderMeetingList(items){
  if (!meetingList) return;
  meetingList.innerHTML = "";

  if (!items.length){
    emptyList && emptyList.classList.remove("hidden");
    return;
  }
  emptyList && emptyList.classList.add("hidden");

  const sorted = [...items].sort((a, b) => {
    const fa = (a.dateISO || ""), fb = (b.dateISO || "");
    if (!fa && !fb) return 0;
    if (!fa) return 1;
    if (!fb) return -1;
    return fb.localeCompare(fa);
  });

  sorted.forEach(m => {
    const el = document.createElement("div");
    el.className = "item";

    const t = templateFromMeeting(m);
    const tLabel = TEMPLATES[t]?.label || "Administrativos";
    const st = (m.status || "draft").toString();
    const kind = safeTrim(m.meetingKind);

    el.innerHTML = `
      <div class="row1">
        <div class="name">${escapeHtml(m.employeeName || "—")}</div>
        <div class="row1Right">
          <div class="date">${escapeHtml(m.dateISO || "—")}</div>
          <button type="button" class="btnDeleteItem" title="Borrar acta" aria-label="Borrar acta">🗑</button>
        </div>
      </div>
      <div class="row2">
        <div class="metaSmall">${escapeHtml(m.role || "")}</div>
        <div class="metaSmall">${escapeHtml(tLabel)} · ${escapeHtml(st)}</div>
      </div>
      ${kind ? `<div class="row3"><span class="badge badgeKind">${escapeHtml(kind)}</span></div>` : ``}
    `;

    el.onclick = () => openMeeting(m.id);
    const btnDel = el.querySelector(".btnDeleteItem");
    if (btnDel){
      btnDel.onclick = (ev) => {
        ev.stopPropagation();
        const label = (m.employeeName || "").trim() || `acta del ${m.dateISO || "—"}`;
        deleteMeeting(m.id, label);
      };
    }
    meetingList.appendChild(el);
  });
}

function applyMeetingListFilter(){
  const q = safeTrim(qEmployee?.value || "").toLowerCase();
  const kind = safeTrim(fltKind?.value || "");
  const stat = safeTrim(fltStatus?.value || "");

  let filtered = lastMeetingList.slice();

  if (q){
    filtered = filtered.filter(m => {
      const name = (m.employeeName || "").toString().toLowerCase();
      const role = (m.role || "").toString().toLowerCase();
      const period = (m.periodLabel || "").toString().toLowerCase();
      return name.includes(q) || role.includes(q) || period.includes(q);
    });
  }
  if (kind) filtered = filtered.filter(m => safeTrim(m.meetingKind) === kind);
  if (stat) filtered = filtered.filter(m => safeTrim(m.status || "draft") === stat);

  renderMeetingList(filtered);
}

/* =====================================================================
   RENDER FORM
===================================================================== */
function renderAll(){
  renderEmptyState();
  if (!currentMeetingId || !currentMeeting) return;

  statusTag && (statusTag.textContent = currentMeeting.status);
  if (appModeLabel) appModeLabel.textContent = TEMPLATES[getTemplate()].titleSuffix;

  fDate && (fDate.value = currentMeeting.dateISO);
  fPeriod && (fPeriod.value = currentMeeting.periodLabel);
  populatePeopleSelects(); // Trabajador, Cargo y Coordinador (selects)
  fArea && (fArea.value = currentMeeting.area);
  fTemplate && (fTemplate.value = getTemplate());
  fPlace && (fPlace.value = currentMeeting.place || "");
  fMeetingKind && (fMeetingKind.value = currentMeeting.meetingKind || "");
  fObjective && (fObjective.value = currentMeeting.objective || "");
  fMeetingFrame && (fMeetingFrame.value = currentMeeting.meetingFrame || DEFAULT_MEETING_FRAME);

  renderKindBadgeAndAlert();

  const isFinal = currentMeeting.status === "final";
  if (btnFinalize) btnFinalize.disabled = isFinal || !currentMeetingId;
  if (btnUnfinalize) btnUnfinalize.disabled = !isFinal || !currentMeetingId;

  renderPreviousActions();
  renderSections();
  renderActionsAndPrompt();
}

function renderEmptyState(){
  const hasMeeting = !!currentMeetingId && !!currentMeeting;
  noMeetingState?.classList.toggle("hidden", hasMeeting);
  meetingOnlyCards.forEach(card => card.classList.toggle("hidden", !hasMeeting));

  if (!hasMeeting){
    meetingIdTag?.classList.add("hidden");
    statusTag && (statusTag.textContent = "sin reunión");
    if (appModeLabel) appModeLabel.textContent = "Sin reunión";
    if (promptPreview) promptPreview.value = "";
    if (sectionsWrap) sectionsWrap.innerHTML = "";
    if (actionsList) actionsList.innerHTML = "";
    actionsEmpty?.classList.remove("hidden");
    if (btnCopyPrompt) btnCopyPrompt.disabled = true;
    if (btnCopyActions) btnCopyActions.disabled = true;
    if (btnFinalize) btnFinalize.disabled = true;
    if (btnUnfinalize) btnUnfinalize.disabled = true;
  }
}

function renderKindBadgeAndAlert(){
  const kind = safeTrim(currentMeeting?.meetingKind);
  if (kindTag){
    if (kind){ kindTag.textContent = kind; kindTag.classList.remove("hidden"); }
    else kindTag.classList.add("hidden");
  }
  if (disciplinaryAlert){
    if (DISCIPLINARY_KINDS.includes(kind)){
      disciplinaryAlert.textContent = DISCIPLINARY_ALERT_TEXT;
      disciplinaryAlert.classList.remove("hidden");
    } else {
      disciplinaryAlert.classList.add("hidden");
    }
  }
}

/* =====================================================================
   GUÍA DEL FACILITADOR (render)
===================================================================== */
function buildGuideNode(guide){
  const box = document.createElement("div");
  box.className = "guideBox";
  GUIDE_ORDER.forEach(part => {
    const arr = guide[part];
    if (!Array.isArray(arr) || !arr.length) return;
    const block = document.createElement("div");
    block.className = "guideBlock";
    const h = document.createElement("div");
    h.className = "guideLabel";
    h.textContent = GUIDE_LABELS[part];
    const ul = document.createElement("ul");
    ul.className = "guideList";
    arr.forEach(txt => {
      const li = document.createElement("li");
      li.textContent = txt;
      ul.appendChild(li);
    });
    block.append(h, ul);
    box.appendChild(block);
  });
  const note = document.createElement("div");
  note.className = "guideNote";
  note.textContent = "Esta guía es solo apoyo visual. No se guarda en el acta.";
  box.appendChild(note);
  return box;
}

/* =====================================================================
   RENDER SECTIONS
===================================================================== */
function renderSections(){
  if (!sectionsWrap || !currentMeeting) return;
  sectionsWrap.innerHTML = "";

  const defs = getSectionDefs();

  defs.forEach(def => {
    const sec = currentMeeting.sections[def.key] || ensureSectionShape(null);
    currentMeeting.sections[def.key] = sec;

    const card = document.createElement("div");
    card.className = "section";
    card.dataset.key = def.key;

    const header = document.createElement("div");
    header.className = "sectionHead";

    const title = document.createElement("div");
    title.className = "sectionTitle";
    title.textContent = def.title;
    if (def.description){
      const hint = document.createElement("div");
      hint.className = "sectionHint";
      hint.textContent = def.description;
      title.appendChild(hint);
    }

    const controls = document.createElement("div");
    controls.className = "sectionControls";

    const sel = document.createElement("select");
    sel.className = "input selectStatus";
    STATUS_OPTIONS.forEach(o => {
      const op = document.createElement("option");
      op.value = o; op.textContent = o; sel.appendChild(op);
    });
    sel.value = migrateStatus(sec.status);
    sel.onchange = () => {
      sec.status = sel.value;
      updateSectionWarning(card, def.key);
      debounceSave();
      renderActionsAndPrompt();
    };
    sel.onblur = () => saveNow({ reason: "Estado guardado", silentOk: true });

    const saveBtn = document.createElement("button");
    saveBtn.type = "button"; saveBtn.className = "btn small"; saveBtn.textContent = "Guardar sección";
    saveBtn.onclick = async () => { await saveNow({ reason: "Sección guardada" }); renderActionsAndPrompt(); };

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button"; toggleBtn.className = "btn small ghost"; toggleBtn.textContent = "Contraer";
    toggleBtn.onclick = () => toggleSectionBody(def.key);

    controls.append(sel, saveBtn, toggleBtn);
    header.append(title, controls);

    const body = document.createElement("div");
    body.className = "sectionBody";
    body.dataset.open = "1";

    // Aviso suave: contenido aunque está "No aplica"
    const warn = document.createElement("div");
    warn.className = "sectionWarn hidden";
    warn.textContent = "⚠️ Esta sección tiene contenido aunque está marcada como No aplica.";
    body.appendChild(warn);

    // Guía del facilitador (plegable)
    const guide = FACILITATOR_GUIDES[def.key];
    if (guide){
      const guideToggle = document.createElement("button");
      guideToggle.type = "button";
      guideToggle.className = "btn small guideToggle";
      guideToggle.textContent = "💬 Guía para conducir esta sección";
      const guideNode = buildGuideNode(guide);
      guideNode.classList.add("hidden");
      guideToggle.onclick = () => {
        const open = !guideNode.classList.contains("hidden");
        guideNode.classList.toggle("hidden", open);
        guideToggle.classList.toggle("active", !open);
      };
      body.append(guideToggle, guideNode);
    }

    const ta = document.createElement("textarea");
    ta.className = "textarea";
    ta.rows = 4;
    ta.placeholder = "Notas de esta sección…";
    ta.value = sec.notes;
    ta.oninput = () => {
      sec.notes = ta.value;
      updateSectionWarning(card, def.key);
      debounceSave();
      renderActionsAndPrompt();
    };
    ta.onblur = () => saveNow({ reason: "Notas guardadas", silentOk: true });

    const baseText = getBaseSectionText(getTemplate(), def.key);
    if (baseText){
      const baseBox = document.createElement("div");
      baseBox.className = "baseTextBox";
      const baseCopy = document.createElement("div");
      baseCopy.className = "baseTextCopy";
      const baseLabel = document.createElement("div");
      baseLabel.className = "baseTextLabel";
      baseLabel.textContent = "Texto base sugerido";
      const basePreview = document.createElement("div");
      basePreview.className = "baseTextPreview";
      basePreview.textContent = baseText;
      const useBaseBtn = document.createElement("button");
      useBaseBtn.type = "button";
      useBaseBtn.className = "btn small baseTextButton";
      useBaseBtn.textContent = "Usar texto base";
      useBaseBtn.onclick = () => {
        if (safeTrim(ta.value) && ta.value !== baseText){
          const replace = window.confirm("Esta sección ya tiene notas. ¿Quieres reemplazarlas por el texto base?");
          if (!replace) return;
        }
        ta.value = baseText;
        sec.notes = baseText;
        if (statusIsNoRevisado(sec.status) || statusIsNoAplica(sec.status)){
          sec.status = "🟢 Bien / Sostenido";
          sel.value = sec.status;
        }
        updateSectionWarning(card, def.key);
        debounceSave();
        renderActionsAndPrompt();
        showToast("Texto base aplicado. Puedes editarlo si lo necesitas.");
        ta.focus();
      };
      baseCopy.append(baseLabel, basePreview);
      baseBox.append(baseCopy, useBaseBtn);
      body.appendChild(baseBox);
    }

    // Acuerdos por sección
    const actionsWrap = document.createElement("div");
    actionsWrap.className = "secActions";

    const actionsHead = document.createElement("div");
    actionsHead.className = "secActionsHead";
    const actionsTitle = document.createElement("div");
    actionsTitle.className = "secActionsTitle";
    actionsTitle.textContent = "Acuerdos de esta sección";
    const addBtn = document.createElement("button");
    addBtn.type = "button"; addBtn.className = "btn small"; addBtn.textContent = "+ Agregar acuerdo";
    addBtn.onclick = () => {
      addAction(def.key, def.title);
      renderSections();
      renderActionsAndPrompt();
      debounceSave();
    };
    actionsHead.append(actionsTitle, addBtn);

    const actionsListLocal = document.createElement("div");
    actionsListLocal.className = "secActionsList";
    if (!sec.actions.length){
      const empty = document.createElement("div");
      empty.className = "emptySmall";
      empty.textContent = "Sin acuerdos por ahora.";
      actionsListLocal.appendChild(empty);
    } else {
      sec.actions.forEach(action => {
        actionsListLocal.appendChild(renderActionRow(def.key, def.title, action));
      });
    }
    actionsWrap.append(actionsHead, actionsListLocal);

    body.append(ta, actionsWrap);
    card.append(header, body);
    sectionsWrap.appendChild(card);

    updateSectionWarning(card, def.key);
  });
}

function updateSectionWarning(card, key){
  const sec = currentMeeting?.sections?.[key];
  const warn = card.querySelector(".sectionWarn");
  if (!warn || !sec) return;
  const show = statusIsNoAplica(sec.status) && sectionHasContent(sec);
  warn.classList.toggle("hidden", !show);
}

function toggleSectionBody(sectionKey, forceOpen = null){
  const node = sectionsWrap?.querySelector(`.section[data-key="${CSS.escape(sectionKey)}"] .sectionBody`);
  const btn = sectionsWrap?.querySelector(`.section[data-key="${CSS.escape(sectionKey)}"] .sectionControls .btn.ghost`);
  if (!node) return;
  const open = node.dataset.open === "1";
  const next = forceOpen === null ? !open : !!forceOpen;
  node.dataset.open = next ? "1" : "0";
  node.style.display = next ? "" : "none";
  if (btn) btn.textContent = next ? "Contraer" : "Expandir";
}

/* =====================================================================
   ACTIONS
===================================================================== */
function addAction(sectionKey, sectionTitle){
  const sec = currentMeeting.sections[sectionKey];
  if (!sec) return;
  sec.actions = Array.isArray(sec.actions) ? sec.actions : [];
  sec.actions.push(normalizeAction({ id: nowId() }, sectionKey, sectionTitle));
}

function deleteAction(sectionKey, actionId){
  const sec = currentMeeting.sections[sectionKey];
  if (!sec?.actions) return;
  sec.actions = sec.actions.filter(a => a.id !== actionId);
}

function consolidateActions(m){
  const out = [];
  const defs = normalizeSectionConfig(m).filter(s =>
    s.enabled !== false && s.visible !== false && s.archived !== true
  );
  defs.forEach(s => {
    const sec = m.sections?.[s.key];
    if (!sec) return;
    (sec.actions || []).forEach(a => {
      const norm = normalizeAction(a, s.key, s.title);
      if (actionHasContent(norm)) out.push(norm);
    });
  });
  return out;
}

function selectFrom(options, value, onChange){
  const sel = document.createElement("select");
  sel.className = "input";
  options.forEach(o => {
    const op = document.createElement("option");
    op.value = o; op.textContent = o; sel.appendChild(op);
  });
  sel.value = value;
  sel.onchange = onChange;
  sel.onblur = () => saveNow({ silentOk: true });
  return sel;
}

function renderActionRow(sectionKey, sectionTitle, action){
  const a = normalizeAction(action, sectionKey, sectionTitle);

  const row = document.createElement("div");
  row.className = "actionRow";

  // Fila 1: acción / tipo / responsable
  const title = document.createElement("input");
  title.className = "input"; title.placeholder = "Acción / acuerdo";
  title.value = a.title;
  title.oninput = () => { a.title = title.value; syncAction(sectionKey, a); };
  title.onblur = () => saveNow({ silentOk: true });

  const type = selectFrom(ACTION_TYPES, a.type, () => { a.type = typeEl.value; syncAction(sectionKey, a); });
  const typeEl = type;

  const owner = document.createElement("input");
  owner.className = "input"; owner.placeholder = "Responsable";
  owner.value = a.owner;
  owner.oninput = () => { a.owner = owner.value; syncAction(sectionKey, a); };
  owner.onblur = () => saveNow({ silentOk: true });

  const grid1 = document.createElement("div");
  grid1.className = "actionGrid g3";
  grid1.append(title, type, owner);

  // Fila 2: fecha compromiso / fecha seguimiento / prioridad / estado
  const due = document.createElement("input");
  due.className = "input"; due.type = "date"; due.title = "Fecha compromiso";
  due.value = a.dueDateISO || "";
  due.oninput = () => { a.dueDateISO = due.value; syncAction(sectionKey, a); };
  due.onblur = () => saveNow({ silentOk: true });

  const follow = document.createElement("input");
  follow.className = "input"; follow.type = "date"; follow.title = "Fecha de seguimiento";
  follow.value = a.followUpDateISO || "";
  follow.oninput = () => { a.followUpDateISO = follow.value; syncAction(sectionKey, a); };
  follow.onblur = () => saveNow({ silentOk: true });

  const priority = selectFrom(ACTION_PRIORITIES, a.priority, () => { a.priority = priorityEl.value; syncAction(sectionKey, a); });
  const priorityEl = priority;

  const status = selectFrom(ACTION_STATUS, a.status, () => { a.status = statusEl.value; syncAction(sectionKey, a); });
  const statusEl = status;

  const grid2 = document.createElement("div");
  grid2.className = "actionGrid g4";
  grid2.append(due, follow, priority, status);

  // Fila 3: evidencia esperada / detalles
  const evidence = document.createElement("input");
  evidence.className = "input"; evidence.placeholder = "Evidencia esperada (¿cómo sabremos que mejoró?)";
  evidence.value = a.expectedEvidence;
  evidence.oninput = () => { a.expectedEvidence = evidence.value; syncAction(sectionKey, a); };
  evidence.onblur = () => saveNow({ silentOk: true });

  const details = document.createElement("textarea");
  details.className = "textarea"; details.rows = 2; details.placeholder = "Detalles (opcional)";
  details.value = a.details;
  details.oninput = () => { a.details = details.value; syncAction(sectionKey, a); };
  details.onblur = () => saveNow({ silentOk: true });

  const del = document.createElement("button");
  del.type = "button"; del.className = "btn small ghost"; del.textContent = "Eliminar";
  del.onclick = () => {
    deleteAction(sectionKey, a.id);
    renderSections(); renderActionsAndPrompt(); debounceSave();
  };

  const footer = document.createElement("div");
  footer.className = "actionFooter";
  footer.append(del);

  row.append(grid1, grid2, evidence, details, footer);
  return row;
}

function syncAction(sectionKey, actionObj){
  const sec = currentMeeting.sections[sectionKey];
  if (!sec?.actions) return;
  const idx = sec.actions.findIndex(x => (x.id || "") === actionObj.id);
  if (idx >= 0) sec.actions[idx] = actionObj;
  else sec.actions.push(actionObj);
  renderActionsAndPrompt();
  debounceSave();
}

function renderActionsAndPrompt(){
  if (!currentMeeting) return;
  const actions = consolidateActions(currentMeeting);
  currentMeeting.actionItems = actions;

  actionsEmpty && actionsEmpty.classList.toggle("hidden", actions.length > 0);
  actionsList && actionsList.classList.toggle("hidden", actions.length === 0);

  if (actionsList){
    actionsList.innerHTML = "";
    actions.forEach(a => {
      const item = document.createElement("div");
      item.className = "actionItem";
      const metaBits = [
        a.status,
        a.priority ? "prioridad " + a.priority : "",
        a.dueDateISO ? "compromiso " + a.dueDateISO : "",
        a.followUpDateISO ? "seguimiento " + a.followUpDateISO : ""
      ].filter(Boolean).join(" · ");
      item.innerHTML = `
        <div class="actionTop">
          <div class="actionTitle">${escapeHtml(a.title || "—")}</div>
          <div class="actionMeta">${escapeHtml(metaBits)}</div>
        </div>
        <div class="actionSub">
          <div class="actionSec">${escapeHtml(a.sectionTitle || a.sectionKey || "")} · ${escapeHtml(a.type)}</div>
          <div class="actionOwner">${escapeHtml(a.owner || "")}</div>
        </div>
        ${a.expectedEvidence ? `<div class="actionDetails"><b>Evidencia:</b> ${escapeHtml(a.expectedEvidence)}</div>` : ``}
        ${a.details ? `<div class="actionDetails">${escapeHtml(a.details)}</div>` : ``}
      `;
      actionsList.appendChild(item);
    });
  }

  if (btnCopyActions) btnCopyActions.disabled = actions.length === 0;

  if (promptPreview){
    try{
      promptPreview.value = buildPrompt({ ...currentMeeting, actionItems: actions });
    }catch(err){
      console.error("Prompt build failed:", err);
      promptPreview.value = "⚠️ Error creando el prompt. Revisa prompt.js.";
      setPill("error");
    }
  }
  if (btnCopyPrompt) btnCopyPrompt.disabled = !currentMeetingId;
}

/* =====================================================================
   FRASES GUÍA GENERALES (render)
===================================================================== */
function renderGeneralGuide(){
  if (!generalGuideBody) return;
  generalGuideBody.innerHTML = "";
  Object.entries(GENERAL_GUIDE_PHRASES).forEach(([cat, phrases]) => {
    const block = document.createElement("div");
    block.className = "guideBlock";
    const h = document.createElement("div");
    h.className = "guideLabel";
    h.textContent = cat;
    const ul = document.createElement("ul");
    ul.className = "guideList";
    phrases.forEach(p => {
      const li = document.createElement("li");
      li.textContent = p;
      ul.appendChild(li);
    });
    block.append(h, ul);
    generalGuideBody.appendChild(block);
  });
}

/* =====================================================================
   VALIDACIONES AL FINALIZAR
===================================================================== */
function validateForFinal(){
  const errors = [];
  const warnings = [];
  const m = currentMeeting;
  if (!m) return { errors: ["No hay reunión abierta."], warnings };

  if (!safeTrim(m.employeeName)) errors.push("Falta el nombre del trabajador.");
  if (!safeTrim(m.dateISO)) errors.push("Falta la fecha.");
  if (!safeTrim(m.role)) errors.push("Falta el cargo.");
  if (!safeTrim(m.meetingKind)) errors.push("Falta seleccionar el tipo de reunión.");

  const actions = consolidateActions(m);
  if (actions.some(a => !safeTrim(a.owner)))
    warnings.push("Hay acuerdos sin responsable asignado.");
  if (actions.some(a => !safeTrim(a.dueDateISO) && !safeTrim(a.followUpDateISO)))
    warnings.push("Hay acuerdos sin fecha de compromiso ni de seguimiento.");

  // Secciones con notas pero estado No revisado / No aplica
  const defs = getSectionDefs();
  const flagged = defs.filter(d => {
    const sec = m.sections?.[d.key];
    return sec && sectionHasContent(sec) && (statusIsNoRevisado(sec.status) || statusIsNoAplica(sec.status));
  });
  if (flagged.length)
    warnings.push(`Hay ${flagged.length} sección(es) con contenido pero marcadas como "No revisado" o "No aplica".`);

  // Palabras del trabajador / docente
  const palabrasKey = getTemplate() === "docente" ? "palabrasDocente" : "palabrasTrabajador";
  const palabras = m.sections?.[palabrasKey];
  if (!palabras || !sectionHasContent(palabras))
    warnings.push('No se registraron "Palabras del trabajador".');

  // Cierre (solo admin tiene sección de cierre)
  const cierre = m.sections?.cierre;
  if (getTemplate() === "admin" && (!cierre || !sectionHasContent(cierre)))
    warnings.push("No se registró cierre ni observaciones finales.");

  return { errors, warnings };
}

async function finalizeMeeting(){
  if (!currentMeetingId || !currentMeeting){ showToast("Primero abre una reunión"); return; }

  const { errors, warnings } = validateForFinal();
  if (errors.length){
    window.alert("No se puede marcar como FINAL todavía:\n\n• " + errors.join("\n• "));
    return;
  }
  if (warnings.length){
    const ok = window.confirm(
      "Antes de finalizar, revisa estas advertencias:\n\n• " + warnings.join("\n• ") +
      "\n\n¿Deseas marcar como FINAL de todos modos?"
    );
    if (!ok) return;
  }

  currentMeeting.status = "final";
  currentMeeting.finalizedAt = new Date().toISOString();
  currentMeeting.finalizedBy = currentUserEmail || "";
  renderAll();
  await saveNow({ reason: "Marcada como FINAL" });
}

async function setStatus(next){
  if (!currentMeetingId || !currentMeeting){ showToast("Primero abre una reunión"); return; }
  if (next === "final") return finalizeMeeting();
  currentMeeting.status = next;
  renderAll();
  await saveNow({ reason: "Volvió a DRAFT" });
}

/* =====================================================================
   BACKUP / DUPLICAR
===================================================================== */
function backupJson(){
  if (!currentMeeting){ showToast("Abre una reunión primero"); return; }
  const data = JSON.stringify({ id: currentMeetingId, ...currentMeeting }, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeName = normEmployeeKey(currentMeeting.employeeName).replace(/\s+/g, "-") || "acta";
  a.href = url;
  a.download = `respaldo-${safeName}-${safeTrim(currentMeeting.dateISO) || isoToday()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("Respaldo JSON descargado ✅");
}

async function duplicateMeeting(){
  if (!currentMeeting){ showToast("Abre una reunión primero"); return; }
  const ok = window.confirm("¿Crear una nueva reunión con los datos base de este trabajador (sin notas ni acuerdos)?");
  if (!ok) return;
  await createMeeting({
    template: getTemplate(),
    employeeName: currentMeeting.employeeName,
    role: currentMeeting.role,
    coordinator: currentMeeting.coordinator,
    coordinators: currentMeeting.coordinators,
    area: currentMeeting.area,
    place: currentMeeting.place,
    attendeesText: currentMeeting.coordinator,
    attendees: currentMeeting.coordinators,
    meetingFrame: currentMeeting.meetingFrame
  });
}

/* =====================================================================
   SECTION CONFIG MODAL  (igual que antes, compatible)
===================================================================== */
function openSectionsConfigModal(){
  if (!currentMeetingId || !currentMeeting){ showToast("Primero crea o abre una reunion"); return; }
  let draft = getAllSectionDefsForConfig().map(x => ({ ...x }));

  const backdrop = document.createElement("div");
  backdrop.className = "modalBackdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");

  const modal = document.createElement("div");
  modal.className = "modalPanel sectionConfigPanel";
  const close = () => backdrop.remove();

  const title = document.createElement("div");
  title.className = "modalTitle"; title.textContent = "Configurar secciones";

  const desc = document.createElement("p");
  desc.className = "muted";
  desc.textContent = "Edita el nombre, la descripcion, el orden, la visibilidad y si cada seccion aplica para esta reunion. Las secciones ocultas no saldran en el acta.";

  const addBox = document.createElement("div");
  addBox.className = "configAddBox";
  const addTitle = document.createElement("input");
  addTitle.className = "input"; addTitle.placeholder = "Nombre de la nueva seccion";
  const addDescription = document.createElement("textarea");
  addDescription.className = "textarea"; addDescription.rows = 2; addDescription.placeholder = "Descripcion o guia interna opcional";
  const addOrder = document.createElement("input");
  addOrder.className = "input"; addOrder.type = "number"; addOrder.min = "1"; addOrder.placeholder = "Orden";
  const addSection = document.createElement("button");
  addSection.type = "button"; addSection.className = "btn"; addSection.textContent = "+ Agregar seccion";
  addBox.append(addTitle, addDescription, addOrder, addSection);

  const rows = document.createElement("div");
  rows.className = "configRows";

  function renderRows(){
    rows.innerHTML = "";
    draft.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "configRow";

      const visible = document.createElement("input");
      visible.type = "checkbox";
      visible.checked = item.visible !== false && item.enabled !== false;
      visible.onchange = () => { item.visible = visible.checked; item.enabled = visible.checked; };

      const input = document.createElement("input");
      input.className = "input"; input.value = item.title; input.placeholder = "Nombre de la seccion";
      input.oninput = () => { item.title = input.value; };

      const description = document.createElement("textarea");
      description.className = "textarea configDescription"; description.rows = 2;
      description.value = item.description || ""; description.placeholder = "Descripcion o guia interna opcional";
      description.oninput = () => { item.description = description.value; };

      const appliesWrap = document.createElement("label");
      appliesWrap.className = "configCheck";
      const applies = document.createElement("input");
      applies.type = "checkbox"; applies.checked = item.applies !== false;
      applies.onchange = () => { item.applies = applies.checked; };
      appliesWrap.append(applies, document.createTextNode(" Aplica"));

      const up = document.createElement("button");
      up.type = "button"; up.className = "btn small ghost"; up.textContent = "Subir"; up.disabled = index === 0;
      up.onclick = () => { [draft[index-1], draft[index]] = [draft[index], draft[index-1]]; renderRows(); };

      const down = document.createElement("button");
      down.type = "button"; down.className = "btn small ghost"; down.textContent = "Bajar"; down.disabled = index === draft.length - 1;
      down.onclick = () => { [draft[index+1], draft[index]] = [draft[index], draft[index+1]]; renderRows(); };

      const remove = document.createElement("button");
      remove.type = "button"; remove.className = "btn small ghost"; remove.textContent = item.custom ? "Quitar" : "Ocultar";
      remove.onclick = () => {
        if (item.custom){
          draft = draft.filter(x => x.key !== item.key); renderRows(); return;
        }
        item.visible = false; item.enabled = false; visible.checked = false;
      };

      const label = document.createElement("div");
      label.className = "configKey";
      label.textContent = item.custom ? item.key + " - personalizada" : item.key;

      row.append(visible, input, description, appliesWrap, up, down, remove, label);
      rows.appendChild(row);
    });
  }

  addSection.onclick = () => {
    const sectionTitle = safeTrim(addTitle.value);
    if (!sectionTitle){ showToast("Escribe el nombre de la nueva seccion"); addTitle.focus(); return; }
    const key = makeSectionKey(sectionTitle, [
      ...draft.map(x => x.key),
      ...Object.keys(currentMeeting.sections || {})
    ]);
    const newSection = {
      key, title: sectionTitle, description: safeTrim(addDescription.value),
      enabled: true, visible: true, applies: true, archived: false, custom: true, order: draft.length
    };
    const desiredOrder = Number(addOrder.value);
    if (Number.isFinite(desiredOrder) && desiredOrder > 0) draft.splice(Math.min(desiredOrder - 1, draft.length), 0, newSection);
    else draft.push(newSection);
    addTitle.value = ""; addDescription.value = ""; addOrder.value = "";
    renderRows();
  };

  const actions = document.createElement("div");
  actions.className = "row modalActions";
  const reset = document.createElement("button");
  reset.type = "button"; reset.className = "btn ghost"; reset.textContent = "Restablecer plantilla";
  reset.onclick = () => { draft = defaultSectionConfig(getTemplate()).map(x => ({ ...x })); renderRows(); };
  const cancel = document.createElement("button");
  cancel.type = "button"; cancel.className = "btn ghost"; cancel.textContent = "Cancelar"; cancel.onclick = close;
  const apply = document.createElement("button");
  apply.type = "button"; apply.className = "btn primary"; apply.textContent = "Guardar cambios";
  apply.onclick = async () => {
    currentMeeting.sectionConfig = draft.map((item, index) => ({
      key: item.key,
      title: safeTrim(item.title) || getSectionTitleByKey(currentMeeting, item.key),
      description: safeTrim(item.description || ""),
      enabled: item.visible !== false && item.enabled !== false,
      visible: item.visible !== false && item.enabled !== false,
      applies: item.applies !== false,
      archived: item.archived === true,
      custom: item.custom === true,
      order: index
    }));
    currentMeeting.sectionConfig.forEach(cfg => {
      if (!currentMeeting.sections[cfg.key]) currentMeeting.sections[cfg.key] = ensureSectionShape(null);
      const sec = currentMeeting.sections?.[cfg.key];
      if (!sec?.actions) return;
      sec.actions = sec.actions.map(a => normalizeAction(a, cfg.key, cfg.title));
    });
    currentMeeting = normalizeMeeting(currentMeeting);
    renderAll();
    await saveNow({ reason: "Configuracion de secciones guardada" });
    close();
  };

  actions.append(reset, document.createElement("div"), cancel, apply);
  actions.children[1].className = "spacer";

  modal.append(title, desc, addBox, rows, actions);
  backdrop.appendChild(modal);
  backdrop.addEventListener("click", e => { if (e.target === backdrop) close(); });
  document.body.appendChild(backdrop);
  renderRows();
  addTitle.focus();
}

/* =====================================================================
   CONFIGURACIÓN DE LISTAS (trabajadores, cargos, coordinadores)
===================================================================== */
const CONFIG_DOC_ID = "app";

function normalizeList(arr){
  const seen = new Set();
  return (Array.isArray(arr) ? arr : [])
    .map(v => safeTrim(v))
    .filter(v => {
      if (!v) return false;
      const k = v.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k); return true;
    })
    .sort((a, b) => a.localeCompare(b, "es"));
}

async function loadAppConfig(){
  try{
    const snap = await getDoc(doc(db, "config", CONFIG_DOC_ID));
    const d = snap.exists() ? snap.data() : {};
    appConfig = {
      workers: normalizeList(d.workers),
      roles: normalizeList(d.roles),
      coordinators: normalizeList(d.coordinators)
    };
  }catch(e){
    console.error("No se pudo cargar la configuración", e);
    appConfig = { workers: [], roles: [], coordinators: [] };
  }
  populatePeopleSelects();
}

async function saveAppConfig(){
  await setDoc(doc(db, "config", CONFIG_DOC_ID), {
    workers: appConfig.workers,
    roles: appConfig.roles,
    coordinators: appConfig.coordinators,
    updatedBy: currentUserEmail || "",
    updatedAt: serverTimestamp()
  });
}

// Rellena un <select> con las opciones dadas, conservando el valor actual
// (aunque no esté en la lista, para no perder datos de actas anteriores).
function fillSelect(sel, options, currentValue){
  if (!sel) return;
  const val = safeTrim(currentValue);
  sel.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = ""; ph.textContent = "Selecciona…";
  sel.appendChild(ph);

  const all = options.slice();
  if (val && !all.some(o => o.toLowerCase() === val.toLowerCase())) all.push(val);

  all.forEach(o => {
    const op = document.createElement("option");
    op.value = o; op.textContent = o;
    sel.appendChild(op);
  });
  sel.value = val;
}

function fillCoordinatorChecks(container, options, currentValues){
  if (!container) return;
  const selected = normalizeList(currentValues);
  const all = normalizeList([...options, ...selected]);
  container.innerHTML = "";
  if (!all.length){
    const empty = document.createElement("div");
    empty.className = "emptySmall";
    empty.textContent = "Agrega coordinadores en Configurar listas.";
    container.appendChild(empty);
    return;
  }
  all.forEach(o => {
    const label = document.createElement("label");
    label.className = "checkOption";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = o;
    input.checked = selected.some(v => v.toLowerCase() === o.toLowerCase());
    const text = document.createElement("span");
    text.textContent = o;
    label.append(input, text);
    container.appendChild(label);
  });
}

function checkedValues(container){
  return Array.from(container?.querySelectorAll('input[type="checkbox"]:checked') || [])
    .map(input => input.value)
    .filter(Boolean);
}

function syncMeetingCoordinators(values){
  if (!currentMeeting) return;
  currentMeeting.coordinators = normalizeList(values);
  currentMeeting.coordinator = currentMeeting.coordinators.join(", ");
  currentMeeting.attendees = currentMeeting.coordinators.slice();
  currentMeeting.attendeesText = currentMeeting.coordinator;
}

function populatePeopleSelects(){
  fillSelect(fEmployeeName, appConfig.workers, currentMeeting?.employeeName);
  fillSelect(fRole, appConfig.roles, currentMeeting?.role);
  fillCoordinatorChecks(fCoordinator, appConfig.coordinators, currentMeeting?.coordinators || parseAttendees(currentMeeting?.coordinator));
}

// Busca el periodo de la última acta de un trabajador y devuelve el mes siguiente.
function suggestedPeriodForWorker(name){
  const key = normEmployeeKey(name);
  if (!key) return "";
  const prior = (lastMeetingList || [])
    .filter(m => m.id !== currentMeetingId)
    .filter(m => normEmployeeKey(m.employeeName) === key)
    .sort((a, b) => safeTrim(b.dateISO).localeCompare(safeTrim(a.dateISO)));
  for (const m of prior){
    const next = nextMonthLabelFromLabel(m.periodLabel);
    if (next) return next;
  }
  return "";
}

/* ---- Modal de configuración de listas ---- */
function openConfigListsModal(){
  const backdrop = document.createElement("div");
  backdrop.className = "modalBackdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");

  const modal = document.createElement("div");
  modal.className = "modalPanel sectionConfigPanel";

  const title = document.createElement("div");
  title.className = "modalTitle";
  title.textContent = "Configurar listas";

  const desc = document.createElement("p");
  desc.className = "muted tiny";
  desc.textContent = "Agrega o quita trabajadores, cargos y coordinadores. Se comparten para todas las actas.";

  // Estado editable local (se aplica al guardar)
  const draft = {
    workers: appConfig.workers.slice(),
    roles: appConfig.roles.slice(),
    coordinators: appConfig.coordinators.slice()
  };

  const listsWrap = document.createElement("div");
  listsWrap.className = "configListsWrap";

  function buildGroup(label, key){
    const box = document.createElement("div");
    box.className = "configGroup";

    const h = document.createElement("div");
    h.className = "label"; h.textContent = label;

    const chips = document.createElement("div");
    chips.className = "configChips";

    function renderChips(){
      chips.innerHTML = "";
      if (!draft[key].length){
        const em = document.createElement("div");
        em.className = "emptySmall"; em.textContent = "Sin elementos aún.";
        chips.appendChild(em);
      }
      draft[key].forEach((val, idx) => {
        const chip = document.createElement("span");
        chip.className = "configChip";
        const t = document.createElement("span"); t.textContent = val;
        const x = document.createElement("button");
        x.type = "button"; x.className = "configChipX"; x.textContent = "✕";
        x.title = "Quitar";
        x.onclick = () => { draft[key].splice(idx, 1); renderChips(); };
        chip.append(t, x);
        chips.appendChild(chip);
      });
    }

    const addRow = document.createElement("div");
    addRow.className = "row configAddRow";
    const input = document.createElement("input");
    input.className = "input"; input.placeholder = `Agregar ${label.toLowerCase()}…`;
    const addBtn = document.createElement("button");
    addBtn.type = "button"; addBtn.className = "btn small primary"; addBtn.textContent = "Agregar";
    function doAdd(){
      const v = safeTrim(input.value);
      if (!v) return;
      if (!draft[key].some(o => o.toLowerCase() === v.toLowerCase())){
        draft[key] = normalizeList([...draft[key], v]);
      }
      input.value = ""; renderChips(); input.focus();
    }
    addBtn.onclick = doAdd;
    input.onkeydown = (e) => { if (e.key === "Enter"){ e.preventDefault(); doAdd(); } };
    addRow.append(input, addBtn);

    box.append(h, chips, addRow);
    renderChips();
    listsWrap.appendChild(box);
  }

  buildGroup("Trabajadores", "workers");
  buildGroup("Cargos", "roles");
  buildGroup("Coordinadores", "coordinators");

  const actions = document.createElement("div");
  actions.className = "row modalActions";
  const cancel = document.createElement("button");
  cancel.type = "button"; cancel.className = "btn ghost"; cancel.textContent = "Cancelar";
  const save = document.createElement("button");
  save.type = "button"; save.className = "btn primary"; save.textContent = "Guardar";

  function close(){ backdrop.remove(); document.removeEventListener("keydown", onKey); }
  function onKey(e){ if (e.key === "Escape") close(); }

  cancel.onclick = close;
  save.onclick = async () => {
    appConfig = {
      workers: normalizeList(draft.workers),
      roles: normalizeList(draft.roles),
      coordinators: normalizeList(draft.coordinators)
    };
    populatePeopleSelects();
    save.disabled = true; save.textContent = "Guardando…";
    try{
      await saveAppConfig();
      showToast("Listas actualizadas ✅");
      close();
    }catch(e){
      console.error(e);
      showToast("No se pudieron guardar las listas");
      save.disabled = false; save.textContent = "Guardar";
    }
  };

  actions.append(cancel, save);
  modal.append(title, desc, listsWrap, actions);
  backdrop.appendChild(modal);
  backdrop.addEventListener("click", e => { if (e.target === backdrop) close(); });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(backdrop);
}

/* =====================================================================
   FORM + EVENTS
===================================================================== */
function bindForm(){
  if (fDate){
    fDate.oninput = () => {
      if (!currentMeeting) return;
      const prevAuto = prevMonthLabel(currentMeeting.dateISO);
      currentMeeting.dateISO = fDate.value || isoToday();
      const auto = prevMonthLabel(currentMeeting.dateISO);
      const current = (currentMeeting.periodLabel || "").trim();
      if (auto && (current === "" || current === prevAuto)){
        currentMeeting.periodLabel = auto;
        if (fPeriod) fPeriod.value = auto;
      }
      debounceSave();
      renderActionsAndPrompt();
    };
    fDate.onblur = () => saveNow({ silentOk: true });
  }

  if (fPeriod){
    fPeriod.oninput = () => { if (!currentMeeting) return; currentMeeting.periodLabel = fPeriod.value; debounceSave(); renderActionsAndPrompt(); };
    fPeriod.onblur = () => saveNow({ silentOk: true });
  }

  if (fEmployeeName){
    fEmployeeName.onchange = () => {
      if (!currentMeeting) return;
      currentMeeting.employeeName = fEmployeeName.value;
      currentMeeting.employeeKey = normEmployeeKey(fEmployeeName.value);

      // Autocompleta el periodo con el mes siguiente a la última acta del trabajador.
      const suggested = suggestedPeriodForWorker(fEmployeeName.value);
      if (suggested){
        currentMeeting.periodLabel = suggested;
        if (fPeriod) fPeriod.value = suggested;
      }

      // Refresca acuerdos anteriores para el trabajador seleccionado.
      currentMeeting.previousActionsReview = [];
      seedPreviousActionsReview();
      renderPreviousActions();

      renderActionsAndPrompt();
      saveNow({ reason: "Datos generales guardados", silentOk: true });
    };
  }

  if (fRole){
    fRole.onchange = () => {
      if (!currentMeeting) return;
      currentMeeting.role = fRole.value;
      saveNow({ silentOk: true });
    };
  }

  if (fCoordinator){
    fCoordinator.onchange = () => {
      if (!currentMeeting) return;
      syncMeetingCoordinators(checkedValues(fCoordinator));
      renderActionsAndPrompt();
      saveNow({ silentOk: true });
    };
  }

  if (fArea){
    fArea.onchange = () => {
      if (!currentMeeting) return;
      currentMeeting.area = fArea.value;
      if (currentMeeting.template === "admin" && fArea.value === "academica"){
        currentMeeting.template = "docente";
        currentMeeting.sectionConfig = normalizeSectionConfig(currentMeeting);
        if (fTemplate) fTemplate.value = "docente";
        renderAll();
      }
      debounceSave();
    };
    fArea.onblur = () => saveNow({ silentOk: true });
  }

  if (fTemplate){
    fTemplate.onchange = () => {
      if (!currentMeeting) return;
      const next = TEMPLATES[fTemplate.value] ? fTemplate.value : "admin";
      currentMeeting.template = next;
      currentMeeting.sectionConfig = normalizeSectionConfig(currentMeeting);
      renderAll();
      debounceSave();
    };
    fTemplate.onblur = () => saveNow({ silentOk: true });
  }

  if (fPlace){
    fPlace.oninput = () => { if (!currentMeeting) return; currentMeeting.place = fPlace.value; debounceSave(); };
    fPlace.onblur = () => saveNow({ silentOk: true });
  }

  if (fMeetingKind){
    fMeetingKind.onchange = () => {
      if (!currentMeeting) return;
      currentMeeting.meetingKind = fMeetingKind.value;
      renderKindBadgeAndAlert();
      renderActionsAndPrompt();
      debounceSave();
    };
    fMeetingKind.onblur = () => saveNow({ silentOk: true });
  }

  if (fObjective){
    fObjective.oninput = () => { if (!currentMeeting) return; currentMeeting.objective = fObjective.value; debounceSave(); renderActionsAndPrompt(); };
    fObjective.onblur = () => saveNow({ silentOk: true });
  }

  if (fMeetingFrame){
    fMeetingFrame.oninput = () => { if (!currentMeeting) return; currentMeeting.meetingFrame = fMeetingFrame.value; debounceSave(); renderActionsAndPrompt(); };
    fMeetingFrame.onblur = () => saveNow({ silentOk: true });
  }
}

async function copyText(text){
  try{
    await navigator.clipboard.writeText(text);
    showToast("Copiado ✅");
  }catch{
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.left = "-9999px";
    document.body.appendChild(ta); ta.select(); document.execCommand("copy");
    document.body.removeChild(ta);
    showToast("Copiado ✅");
  }
}

function wireButtons(){
  btnNew && (btnNew.onclick = () => createMeeting());
  btnNewEmpty && (btnNewEmpty.onclick = () => createMeeting());
  btnConfigLists && (btnConfigLists.onclick = openConfigListsModal);
  btnConfigureSections && (btnConfigureSections.onclick = openSectionsConfigModal);
  btnClearLocal && (btnClearLocal.onclick = clearLocalDraft);
  btnBackupJson && (btnBackupJson.onclick = backupJson);
  btnDuplicate && (btnDuplicate.onclick = duplicateMeeting);

  btnFinalize && (btnFinalize.onclick = () => setStatus("final"));
  btnUnfinalize && (btnUnfinalize.onclick = () => setStatus("draft"));

  btnCopyPrompt && (btnCopyPrompt.onclick = () => promptPreview && copyText(promptPreview.value || ""));

  btnCopyActions && (btnCopyActions.onclick = () => {
    if (!currentMeeting) return;
    const actions = consolidateActions(currentMeeting);
    const txt = actions.map(a => [
      `• ${a.title || "—"}`,
      a.type ? `Tipo: ${a.type}` : "",
      a.owner ? `Resp: ${a.owner}` : "",
      a.dueDateISO ? `Compromiso: ${a.dueDateISO}` : "",
      a.followUpDateISO ? `Seguimiento: ${a.followUpDateISO}` : "",
      a.priority ? `Prioridad: ${a.priority}` : "",
      a.status ? `Estado: ${a.status}` : "",
      a.expectedEvidence ? `Evidencia: ${a.expectedEvidence}` : "",
      a.sectionTitle ? `Sección: ${a.sectionTitle}` : ""
    ].filter(Boolean).join(" | ")).join("\n");
    copyText(txt);
  });

  btnRefreshPrompt && (btnRefreshPrompt.onclick = () => renderActionsAndPrompt());
  btnSelectPrompt && (btnSelectPrompt.onclick = () => { if (!promptPreview) return; promptPreview.focus(); promptPreview.select(); });

  btnExpandAll && (btnExpandAll.onclick = () => getSectionDefs().forEach(s => toggleSectionBody(s.key, true)));
  btnCollapseAll && (btnCollapseAll.onclick = () => getSectionDefs().forEach(s => toggleSectionBody(s.key, false)));

  if (btnToggleGeneralGuide && generalGuideBody){
    btnToggleGeneralGuide.onclick = () => {
      const open = !generalGuideBody.classList.contains("hidden");
      generalGuideBody.classList.toggle("hidden", open);
      btnToggleGeneralGuide.classList.toggle("active", !open);
      btnToggleGeneralGuide.textContent = open ? "Mostrar frases" : "Ocultar frases";
    };
  }
}

function wireSearch(){
  qEmployee && (qEmployee.oninput = () => applyMeetingListFilter());
  fltKind && (fltKind.onchange = () => applyMeetingListFilter());
  fltStatus && (fltStatus.onchange = () => applyMeetingListFilter());
}

window.onbeforeunload = e => { if (!dirty) return; e.preventDefault(); e.returnValue = ""; };
window.addEventListener("online", () => {
  if (!currentMeetingId) return setPill("idle");
  setPill(dirty ? "saving" : "idle");
});
window.addEventListener("offline", () => setPill("offline"));

/* =====================================================================
   AUTH
===================================================================== */
const isAllowedEmail = (email) => !!email && ALLOWED_EMAILS.includes(email.toLowerCase());
let appBootstrapped = false;

async function bootstrapApp(){
  if (appBootstrapped) return;
  appBootstrapped = true;
  setPill("idle");
  bindForm();
  wireButtons();
  wireSearch();
  populateFilters();
  renderGeneralGuide();
  currentMeetingId = null;
  currentMeeting = null;
  renderAll();
  btnCopyPrompt && (btnCopyPrompt.disabled = true);
  await loadAppConfig();
  await listMeetings();
}

function populateFilters(){
  // El HTML ya trae la opción placeholder; aquí solo añadimos los tipos.
  if (fMeetingKind && fMeetingKind.options.length <= 1){
    MEETING_KINDS.forEach(k => {
      const op = document.createElement("option"); op.value = k; op.textContent = k; fMeetingKind.appendChild(op);
    });
  }
  if (fltKind && fltKind.options.length <= 1){
    MEETING_KINDS.forEach(k => {
      const op = document.createElement("option"); op.value = k; op.textContent = k; fltKind.appendChild(op);
    });
  }
}

function showAuthGate(){
  authGate?.classList.remove("hidden");
  userChip?.classList.add("hidden");
  btnLogout?.classList.add("hidden");
}
function hideAuthGate(){ authGate?.classList.add("hidden"); }
function showAuthError(msg){ if (authError){ authError.textContent = msg; authError.classList.remove("hidden"); } }
function clearAuthError(){ authError?.classList.add("hidden"); }

function wireAuth(){
  if (btnGoogleLogin){
    btnGoogleLogin.onclick = async () => {
      clearAuthError();
      btnGoogleLogin.disabled = true;
      try{ await signInWithPopup(auth, googleProvider); }
      catch(e){
        console.error(e);
        if (e?.code !== "auth/popup-closed-by-user" && e?.code !== "auth/cancelled-popup-request")
          showAuthError("No se pudo iniciar sesión. Intenta de nuevo.");
      }finally{ btnGoogleLogin.disabled = false; }
    };
  }
  if (btnLogout){
    btnLogout.onclick = async () => { try{ await signOut(auth); } catch(e){ console.error(e); } };
  }

  onAuthStateChanged(auth, async (user) => {
    if (user && isAllowedEmail(user.email)){
      currentUserEmail = user.email;
      clearAuthError();
      hideAuthGate();
      if (userChip){ userChip.textContent = user.email; userChip.classList.remove("hidden"); }
      btnLogout?.classList.remove("hidden");
      await bootstrapApp();
    } else if (user){
      const intento = user.email || "";
      await signOut(auth);
      showAuthGate();
      showAuthError(`El correo ${intento} no está autorizado para usar esta app.`);
    } else {
      currentUserEmail = "";
      showAuthGate();
    }
  });
}

/* =====================================================================
   INIT
===================================================================== */
(function init(){ wireAuth(); })();
