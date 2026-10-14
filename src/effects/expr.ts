// Kleiner, sicherer Ausdrucks-Auswerter (kein eval) für "reach" und "visibleIf" im Manifest.
// Grammatik: expr := term (('+'|'-') term)* ; term := unary (('*'|'/') unary)* ;
// unary := '-' unary | atom ; atom := number | ident | ident '(' expr (',' expr)* ')' | '(' expr ')'

const FUNCTIONS: Record<string, (...a: number[]) => number> = {
  max: Math.max,
  min: Math.min,
  abs: Math.abs,
  sqrt: Math.sqrt,
};

type Token = { kind: 'num'; value: number } | { kind: 'id'; value: string } | { kind: 'op'; value: string };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_]\w*)|([-+*/(),]))/y;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new Error(`Unerwartetes Zeichen an Position ${pos}: "${src.slice(pos, pos + 8)}"`);
    if (m[1] !== undefined) tokens.push({ kind: 'num', value: Number(m[1]) });
    else if (m[2] !== undefined) tokens.push({ kind: 'id', value: m[2] });
    else if (m[3] !== undefined) tokens.push({ kind: 'op', value: m[3] });
    pos = re.lastIndex;
  }
  return tokens;
}

export type Scope = Record<string, number>;

/** Parst einmal und liefert eine Auswertungsfunktion; wirft bei Syntaxfehlern. */
export function compileExpr(src: string): { evaluate: (scope: Scope) => number; identifiers: string[] } {
  const tokens = tokenize(src);
  let i = 0;
  const identifiers = new Set<string>();
  const peek = () => tokens[i];
  const eat = (op: string) => {
    const t = tokens[i];
    if (t?.kind !== 'op' || t.value !== op) throw new Error(`"${op}" erwartet`);
    i++;
  };

  type Node = (s: Scope) => number;

  const atom = (): Node => {
    const t = tokens[i++];
    if (!t) throw new Error('Ausdruck endet unerwartet');
    if (t.kind === 'num') return () => t.value;
    if (t.kind === 'op' && t.value === '(') {
      const e = expr();
      eat(')');
      return e;
    }
    if (t.kind === 'id') {
      const next = peek();
      if (next?.kind === 'op' && next.value === '(') {
        const fn = FUNCTIONS[t.value];
        if (!fn) throw new Error(`Unbekannte Funktion "${t.value}"`);
        i++;
        const args: Node[] = [expr()];
        while (peek()?.kind === 'op' && peek()?.value === ',') {
          i++;
          args.push(expr());
        }
        eat(')');
        return (s) => fn(...args.map((a) => a(s)));
      }
      identifiers.add(t.value);
      return (s) => {
        const v = s[t.value];
        if (v === undefined) throw new Error(`Unbekannter Name "${t.value}"`);
        return v;
      };
    }
    throw new Error(`Unerwartetes "${t.value}"`);
  };
  const unary = (): Node => {
    const t = peek();
    if (t?.kind === 'op' && t.value === '-') {
      i++;
      const u = unary();
      return (s) => -u(s);
    }
    return atom();
  };
  const term = (): Node => {
    let left = unary();
    for (let t = peek(); t?.kind === 'op' && (t.value === '*' || t.value === '/'); t = peek()) {
      i++;
      const l = left;
      const r = unary();
      left = t.value === '*' ? (s) => l(s) * r(s) : (s) => l(s) / r(s);
    }
    return left;
  };
  const expr = (): Node => {
    let left = term();
    for (let t = peek(); t?.kind === 'op' && (t.value === '+' || t.value === '-'); t = peek()) {
      i++;
      const l = left;
      const r = term();
      left = t.value === '+' ? (s) => l(s) + r(s) : (s) => l(s) - r(s);
    }
    return left;
  };

  const root = expr();
  if (i !== tokens.length) throw new Error(`Unerwartetes "${String(tokens[i]?.value)}"`);
  return { evaluate: root, identifiers: [...identifiers] };
}

/**
 * Sichtbarkeitsbedingung: "key" (bool wahr), "!key" (bool falsch), "key=value" bzw. "key!=value" (enum).
 */
export function parseCondition(src: string): { key: string; test: (v: unknown) => boolean } {
  const s = src.trim();
  const m = /^([A-Za-z_]\w*)\s*(!=|=)\s*([\w-]+)$/.exec(s);
  if (m) {
    const [, key = '', op, value] = m;
    return { key, test: (v) => (op === '=' ? String(v) === value : String(v) !== value) };
  }
  const b = /^(!?)([A-Za-z_]\w*)$/.exec(s);
  if (b) {
    const [, neg, key = ''] = b;
    return { key, test: (v) => (neg ? !v : Boolean(v)) };
  }
  throw new Error(`Ungültige Bedingung "${src}"`);
}
