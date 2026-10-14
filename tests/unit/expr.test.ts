import { describe, expect, it } from 'vitest';
import { compileExpr, parseCondition } from '../../src/effects/expr';

describe('compileExpr', () => {
  it('rechnet mit Punkt vor Strich, Klammern und Funktionen', () => {
    expect(compileExpr('1 + 2 * 3').evaluate({})).toBe(7);
    expect(compileExpr('(1 + 2) * 3').evaluate({})).toBe(9);
    expect(compileExpr('-radius / 2').evaluate({ radius: 10 })).toBe(-5);
    expect(compileExpr('max(distance + softness, 3)').evaluate({ distance: 500, softness: 200 })).toBe(700);
    expect(compileExpr('sqrt(abs(x))').evaluate({ x: -16 })).toBe(4);
  });

  it('liefert die verwendeten Namen', () => {
    expect(compileExpr('a + max(b, 2) * a').identifiers.sort()).toEqual(['a', 'b']);
  });

  it('wirft bei Syntaxfehlern und unbekannten Funktionen', () => {
    expect(() => compileExpr('1 +')).toThrow();
    expect(() => compileExpr('foo(1)')).toThrow();
    expect(() => compileExpr('1 2')).toThrow();
    expect(() => compileExpr('a; alert(1)')).toThrow();
  });
});

describe('parseCondition', () => {
  it('versteht bool, Negation, = und !=', () => {
    expect(parseCondition('duotone').test(true)).toBe(true);
    expect(parseCondition('!duotone').test(true)).toBe(false);
    expect(parseCondition('mode=hue').test('hue')).toBe(true);
    expect(parseCondition('grain!=0').test(0)).toBe(false);
    expect(parseCondition('grain!=0').test(12)).toBe(true);
  });
});
