// Registro de negocios de Connecticut (datos abiertos, Socrata): altas nuevas con correo → candidatos a web demo.
// Dataset "Business Master": https://data.ct.gov/resource/n7gp-d28j.json · mismos filtros que web-creator-360 (src/services/ctRegistry.js).

export const API_URL = "https://data.ct.gov/resource/n7gp-d28j.json";

// Correos de gestorías / agentes registrados: son de la agencia, no del dueño
export const DOMINIOS_GESTORIA = new RegExp(
  "incfile|zenbusiness|legalzoom|cscglobal|cscinfo|northwestregisteredagent|registeredagentsinc|" +
    "wolterskluwer|cogencyglobal|tailorbrands|swyftfilings|usa-llc-filing|corporatedocfiling|incorp\\.com|" +
    "unitedagentgroup|corpcreations|rasi\\.com|bizee|northwest|registeredagent|harborcompliance|" +
    "inc-?authority|mycompanyworks|govdocs|compliance",
  "i",
);

// Sector por prefijo NAICS (el código de 6 cifras va dentro del texto: "Janitorial Services (561720)")
export const SECTORES: Record<string, string[]> = {
  construccion: ["2361", "2362", "238"],
  limpieza: ["561720", "561740", "561790"],
  jardineria: ["561730"],
  belleza: ["8121"],
  comida: ["722", "3118"],
  transporte: ["484", "4921", "4922", "4885"],
  taxes: ["5412"],
  auto: ["8111", "4411", "4412"],
  seguros: ["5242"],
  salud: ["621"],
  eventos: ["5413", "7113", "5419", "8129"],
};
// Holdings, alquiler de inmuebles, vehículos de inversión: no compran una web
export const NAICS_EXCLUIR = ["5311", "5239", "5511", "5251", "5259"];
export const RE_NO_OPERATIVA = /holding|propert|investment|funding|rentals|realty|capital|equity|trust\b|limited liability partnership|enterprise management/i;
export const RE_ESPANOL = /servicios|latin[oa]|hispan|familia|nuestra|\blos\b|\blas\b|\bdel\b|\bel\b|y\s+m[aá]s|limpieza|construccion|jardin|panaderia|taqueria|belleza|mudanza|mecanica|seguros|boricua|sabor|cocina|\bcasa\b|\bmi\s/i;

export const APELLIDOS = `
garcia rodriguez martinez hernandez lopez gonzalez perez sanchez ramirez torres flores rivera
gomez diaz reyes morales cruz ortiz gutierrez chavez ramos ruiz alvarez mendoza vasquez vazquez
castillo jimenez moreno romero herrera medina aguilar garza castro vargas fernandez guzman munoz
mendez salazar soto delgado pena rios alvarado sandoval contreras valdez guerrero ortega estrada
nunez maldonado vega dominguez luna rojas figueroa cabrera espinoza espinosa carrillo avila acosta
campos cervantes navarro fuentes marquez cortez cortes santiago rosales padilla molina suarez
juarez salinas solis cardenas pacheco miranda ibarra velasquez velazquez arias zamora orozco
cisneros trujillo calderon montoya benitez barrera villarreal rosario colon serrano duran ochoa
galvan hidalgo bautista paredes pineda zuniga macias valencia ayala beltran esquivel quintero
robles ponce rangel escobar bermudez villanueva gallegos mejia osorio tapia cuevas arellano
camacho lozano palacios quintana pizarro zapata rincon andrade barajas bonilla caballero
carrasco corona enriquez esparza gallardo granados guevara huerta lucero magana olivares
pantoja quiroz renteria rubio saldana santana segura tovar urbina zavala zepeda aguirre
arroyo bustamante chacon cordova cuellar duarte echeverria escamilla fajardo jaramillo
medrano montalvo murillo najera noriega ocampo perales quezada saenz sepulveda toledo uribe
valenzuela zarate carranza portillo henriquez amaya gonzales rodrigues machado betancourt
quinones feliciano melendez negron velez rosado burgos matos marrero irizarry pagan
`.trim().split(/\s+/);

export const limpiar = (t: unknown) => String(t ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export const codigoNaics = (t: unknown) => String(t ?? "").match(/(\d{6})/)?.[1] ?? "";
export function sectorDe(naics: string): string {
  for (const [nombre, prefijos] of Object.entries(SECTORES)) if (prefijos.some((p) => naics.startsWith(p))) return nombre;
  return "";
}
export const titleCase = (s: unknown) => String(s ?? "").toLowerCase().replace(/(^|[^a-zà-ÿ])([a-zà-ÿ])/g, (_, pre, ch) => pre + ch.toUpperCase());

export function senalesLatinas(nombre: string, email: string): { reasons: string[]; nameMatch: boolean } {
  const reasons: string[] = [];
  const m = limpiar(nombre).match(RE_ESPANOL);
  if (m) reasons.push(`nombre: '${m[0].trim()}'`);
  const local = limpiar(String(email).split("@")[0]);
  const tokens = new Set(local.split(/[^a-z]+/));
  const letras = local.replace(/[^a-z]/g, "");
  const hit = APELLIDOS.find((a) => tokens.has(a))
    || APELLIDOS.find((a) => a.length >= 5 && (letras.startsWith(a) || letras.endsWith(a)))
    || APELLIDOS.find((a) => a.length >= 7 && letras.includes(a));
  if (hit) reasons.push(`email: ${hit}`);
  return { reasons, nameMatch: Boolean(m) };
}

export type Candidate = {
  ct_id: string; name: string; email: string; city: string; zip: string; registered: string | null;
  naics: string; sector: string; latino: boolean; notes: string | null;
};
export type Stats = { raw: number; noEmail: number; gestoria: number; shared: number; noOperativa: number; noLatino: number; kept: number };

/** Filas del registro → candidatos, con los filtros del repo original en el mismo orden. */
export function classifyRegistrations(rows: any[], { latinOnly = false } = {}): { leads: Candidate[]; stats: Stats } {
  const stats: Stats = { raw: rows.length, noEmail: 0, gestoria: 0, shared: 0, noOperativa: 0, noLatino: 0, kept: 0 };
  // Un correo repetido en 4+ altas del lote es de una gestoría
  const repeats = new Map<string, number>();
  for (const f of rows) { const k = String(f.business_email_address ?? "").trim().toLowerCase(); repeats.set(k, (repeats.get(k) ?? 0) + 1); }
  const leads: Candidate[] = [];
  for (const f of rows) {
    let email = String(f.business_email_address ?? "").trim();
    if (!email.includes("@")) { stats.noEmail++; continue; }
    if (DOMINIOS_GESTORIA.test(email)) {
      const alt = String(f.category_survey_email_address ?? "").trim();
      if (alt.includes("@") && !DOMINIOS_GESTORIA.test(alt)) email = alt;
      else { stats.gestoria++; continue; }
    }
    if ((repeats.get(email.toLowerCase()) ?? 0) >= 4) { stats.shared++; continue; }
    const naics = codigoNaics(f.naics_code);
    if (NAICS_EXCLUIR.some((p) => naics.startsWith(p)) || RE_NO_OPERATIVA.test(f.name ?? "")) { stats.noOperativa++; continue; }
    const signal = senalesLatinas(f.name ?? "", email);
    if (latinOnly && !signal.reasons.length) { stats.noLatino++; continue; }
    leads.push({
      ct_id: String(f.accountnumber ?? ""), name: String(f.name ?? ""), email: email.toLowerCase(),
      city: titleCase(f.billingcity), zip: String(f.billingpostalcode ?? "").slice(0, 5),
      registered: String(f.date_registration ?? "").slice(0, 10) || null,
      naics: String(f.naics_code ?? ""), sector: sectorDe(naics) || "otro",
      latino: signal.reasons.length > 0,
      notes: signal.reasons.length ? `señal latina: ${signal.reasons.join(" + ")}` : null,
    });
    stats.kept++;
  }
  leads.sort((a, b) => String(b.registered).localeCompare(String(a.registered)));
  return { leads, stats };
}

/** Altas activas con correo desde `since` (YYYY-MM-DD), las más nuevas primero. Una sola página (cabe en los límites del worker). */
export async function fetchRegistrations(since: string, limit = 2000, appToken?: string): Promise<any[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error(`fecha inválida: ${since}`);
  const params = new URLSearchParams({
    $where: `status = 'Active' AND business_email_address IS NOT NULL AND date_registration >= '${since}T00:00:00'`,
    $order: "date_registration DESC, accountnumber",
    $limit: String(limit),
  });
  const res = await fetch(`${API_URL}?${params}`, { headers: { Accept: "application/json", ...(appToken ? { "X-App-Token": appToken } : {}) } });
  if (!res.ok) throw new Error(`data.ct.gov respondió ${res.status}`);
  return res.json();
}

// Correos gratuitos: el dominio no dice nada de su web
export const FREE_MAIL = /@(gmail|yahoo|hotmail|outlook|live|aol|icloud|me|msn|comcast|att|sbcglobal|verizon|protonmail|proton|ymail|mail|gmx)\./i;
