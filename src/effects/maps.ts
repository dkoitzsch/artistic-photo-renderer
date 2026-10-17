// Gemeinsame Konstanten der Analysekarten (GPU: render/core.ts + shaders/analysis.wgsl, Worker: cpuAnalysis.ts,
// Dienst: ml-service/src/ml_service/analysis.py).

/** Glättung des Strukturtensors für „edges“ (σ in Original-px). */
export const EDGE_SIGMA = 2;
/** Glättung der beiden Strukturtensoren für „flow“ (σ in Original-px); J = J(nah) + FLOW_FAR_WEIGHT · J(fern). */
export const FLOW_SIGMA_NEAR = 6;
export const FLOW_SIGMA_FAR = 24;
export const FLOW_FAR_WEIGHT = 0.25;

/** Reichweite der Kantenkarte in px (volle Auflösung): Sobel + Glättung 3σ. */
export const EDGE_MAP_REACH = 8;
/** Reichweite des Richtungsfelds in px (volle Auflösung): Sobel + Glättung 3σ der fernen Stufe. */
export const FLOW_MAP_REACH = 3 * FLOW_SIGMA_FAR + 2;
