// Schichtplan (Spec „Effekte“ 7.6): Malreihenfolge in Schritten je Maltechnik. Jede Fläche der Malplan-Analyse wird
// einem Schritt zugeordnet (nach Helligkeit, Größe und Technik); ein Schritt zeigt, was neu hinzukommt, und den Stand.
// Öl/Acryl/Gouache: Untermalung → große dunkle Flächen → große helle Flächen → Mitteltöne → Details → Lichter/Akzente.
// Aquarell: Vorzeichnung → helle Lasur → Mitteltöne → dunkle Töne → Details/Akzente (Papierweiß bleibt stehen).
// Bleistift/Kohle: Umrisse → große Tonwertmassen → Mitteltöne → dunkelste Töne → Details. Rein und getestet.

import type { Analysis } from './analysis';
import type { Technique } from './model';

export type PlanStep = {
  title: string;
  description: string;
  /** Darstellung: 'contour' = nur Umrisse, 'underpainting' = einfarbige Tonwertuntermalung, 'paint' = Flächen */
  kind: 'contour' | 'underpainting' | 'paint';
};

export type LayerPlan = {
  steps: PlanStep[];
  /** Schritt je Fläche (−1 = nie bemalt, z. B. Papierweiß im Aquarell) */
  regionStep: Int8Array;
};

function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))] ?? 0;
}

export function buildPlan(a: Analysis, technique: Technique): LayerPlan {
  const regs = a.regions;
  const total = regs.reduce((s, r) => s + r.area, 0) || 1;
  const L = regs.map((r) => r.lab[0]);
  // Flächengröße relativ zur Bildfläche: groß ≥ 1,5 %, klein < 0,25 %
  const share = regs.map((r) => r.area / total);
  const big = (i: number) => (share[i] ?? 0) >= 0.015;
  const small = (i: number) => (share[i] ?? 0) < 0.0025;
  // Helligkeitsgrenzen flächengewichtet über die Flächenmittel
  const weighted: number[] = [];
  regs.forEach((r, i) => {
    const n = Math.max(1, Math.round((share[i] ?? 0) * 400));
    for (let k = 0; k < n; k++) weighted.push(r.lab[0]);
  });
  const q33 = quantile(weighted, 0.33);
  const q50 = quantile(weighted, 0.5);
  const q66 = quantile(weighted, 0.66);
  const hi = quantile(L, 0.9);
  const lo = quantile(L, 0.06);
  const regionStep = new Int8Array(regs.length);

  if (technique === 'watercolor') {
    const steps: PlanStep[] = [
      {
        kind: 'contour',
        title: 'Vorzeichnung',
        description: 'Leichte Umrisse der Hauptformen mit hartem Bleistift.',
      },
      {
        kind: 'paint',
        title: 'Erste Lasur: helle Töne',
        description: 'Großzügig nass in nass, hellste Farbtöne. Weiße Stellen bleiben Papier.',
      },
      {
        kind: 'paint',
        title: 'Mitteltöne',
        description: 'Nach dem Trocknen die mittleren Töne lasieren, Kanten setzen.',
      },
      {
        kind: 'paint',
        title: 'Dunkle Töne',
        description: 'Dunkle Flächen in kräftigerer Mischung, wenig Wasser.',
      },
      {
        kind: 'paint',
        title: 'Details und Akzente',
        description: 'Kleine dunkle Formen und Akzente mit feinem Pinsel, zuletzt.',
      },
    ];
    regs.forEach((r, i) => {
      const l = r.lab[0];
      if (l >= 0.95)
        regionStep[i] = -1; // Papierweiß
      else if (small(i) && l < q50) regionStep[i] = 4;
      else if (l >= q66) regionStep[i] = 1;
      else if (l >= q33) regionStep[i] = 2;
      else regionStep[i] = 3;
    });
    return { steps, regionStep };
  }

  if (technique === 'pencil') {
    const steps: PlanStep[] = [
      { kind: 'contour', title: 'Umrisse', description: 'Proportionen und Hauptformen leicht anlegen.' },
      {
        kind: 'paint',
        title: 'Große Tonwertmassen',
        description: 'Große dunkle Flächen flächig anlegen (Seite der Mine).',
      },
      { kind: 'paint', title: 'Mitteltöne', description: 'Mittlere Werte aufbauen, Übergänge verwischen.' },
      {
        kind: 'paint',
        title: 'Dunkelste Töne',
        description: 'Tiefste Schatten mit weicher Mine verdichten.',
      },
      {
        kind: 'paint',
        title: 'Details und Kanten',
        description: 'Kleine Formen, harte Kanten, Lichter mit dem Radierer.',
      },
    ];
    regs.forEach((r, i) => {
      const l = r.lab[0];
      if (l >= 0.95) regionStep[i] = -1;
      else if (small(i)) regionStep[i] = 4;
      else if (l < q33 && big(i)) regionStep[i] = 1;
      else if (l < q33) regionStep[i] = 3;
      else regionStep[i] = 2;
    });
    return { steps, regionStep };
  }

  // Öl, Acryl, Gouache: dunkel → hell, groß → klein
  const steps: PlanStep[] = [
    {
      kind: 'underpainting',
      title: 'Untermalung',
      description:
        'Dünne, einfarbige Tonwertuntermalung (z. B. Umbra mit Lösungsmittel/Wasser) der ganzen Fläche.',
    },
    {
      kind: 'paint',
      title: 'Blocking-in: dunkle Flächen',
      description: 'Große dunkle Formen flächig in ihrer Grundfarbe.',
    },
    {
      kind: 'paint',
      title: 'Blocking-in: helle Flächen',
      description: 'Große helle Formen anlegen, Kanten noch offen lassen.',
    },
    { kind: 'paint', title: 'Mitteltöne', description: 'Mittlere Formen und Übergänge, Farbe deckender.' },
    {
      kind: 'paint',
      title: 'Details',
      description: 'Kleine Formen mit kleinerem Pinsel, harte Kanten setzen.',
    },
    {
      kind: 'paint',
      title: 'Lichter und Akzente',
      description: 'Hellste Lichter pastos und dunkelste Akzente zum Schluss.',
    },
  ];
  regs.forEach((r, i) => {
    const l = r.lab[0];
    if (small(i) && (l >= hi || l <= lo)) regionStep[i] = 5;
    else if (small(i)) regionStep[i] = 4;
    else if (big(i)) regionStep[i] = l < q50 ? 1 : 2;
    else regionStep[i] = 3;
  });
  return { steps, regionStep };
}

/** Flächen, die in Schritt k neu hinzukommen, und solche, die bis dahin bemalt sind. */
export function stepMasks(plan: LayerPlan, k: number): { done: Uint8Array; added: Uint8Array } {
  const n = plan.regionStep.length;
  const done = new Uint8Array(n);
  const added = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const s = plan.regionStep[i] ?? -1;
    if (s >= 0 && s <= k) done[i] = 1;
    if (s === k) added[i] = 1;
  }
  return { done, added };
}
