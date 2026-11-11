// Plantillas precompiladas (npm run sites las regenera desde templates/sites/*.html).
import type { Compiled } from "../sitegen.ts";
import barberia from "./barberia.json";
import belleza from "./belleza.json";
import comida from "./comida.json";
import construccion from "./construccion.json";
import general from "./general.json";
import jardineria from "./jardineria.json";
import limpieza from "./limpieza.json";

export const SITES = { barberia, belleza, comida, construccion, general, jardineria, limpieza } as unknown as Record<string, Compiled>;
