import { describe, expect, it } from 'vitest';
import {
  canRedo,
  canUndo,
  createHistory,
  jump,
  present,
  push,
  redo,
  sealCoalescing,
  undo,
} from '../../src/state/history';

describe('History', () => {
  it('undo/redo', () => {
    let h = createHistory('a');
    h = push(h, '1', 'b');
    h = push(h, '2', 'c');
    expect(present(h)).toBe('c');
    h = undo(h);
    expect(present(h)).toBe('b');
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(present(h)).toBe('c');
    h = undo(undo(h));
    expect(present(h)).toBe('a');
    expect(canUndo(h)).toBe(false);
  });

  it('verwirft die Zukunft bei neuer Änderung', () => {
    let h = push(push(createHistory('a'), '1', 'b'), '2', 'c');
    h = push(undo(h), '3', 'x');
    expect(h.entries.map((e) => e.state)).toEqual(['a', 'b', 'x']);
    expect(canRedo(h)).toBe(false);
  });

  it('fasst eine Reglergeste zu einem Eintrag zusammen', () => {
    let h = createHistory(0);
    for (let v = 1; v <= 50; v++) h = push(h, 'Radius', v, 'param:r');
    expect(h.entries).toHaveLength(2);
    expect(present(h)).toBe(50);
    h = sealCoalescing(h);
    h = push(h, 'Radius', 60, 'param:r');
    expect(h.entries).toHaveLength(3);
    h = undo(h);
    expect(present(h)).toBe(50);
    h = undo(h);
    expect(present(h)).toBe(0);
  });

  it('fasst nach Undo nicht mit einem alten Eintrag zusammen', () => {
    let h = push(createHistory(0), 'R', 1, 'k');
    h = push(h, 'X', 2);
    h = undo(h); // aktuell: 1 (k)
    h = push(h, 'R', 5, 'k');
    expect(h.entries.map((e) => e.state)).toEqual([0, 1, 5]);
  });

  it('hält das Limit ein (mindestens 200 Schritte)', () => {
    let h = createHistory(0, 'start', 250);
    for (let i = 1; i <= 400; i++) h = push(h, 'n', i);
    expect(h.entries).toHaveLength(250);
    expect(present(h)).toBe(400);
    for (let i = 0; i < 249; i++) h = undo(h);
    expect(present(h)).toBe(151);
    expect(canUndo(h)).toBe(false);
  });

  it('springt zu beliebigen Einträgen', () => {
    let h = push(push(createHistory('a'), '1', 'b'), '2', 'c');
    h = jump(h, 0);
    expect(present(h)).toBe('a');
    h = jump(h, 99);
    expect(present(h)).toBe('c');
  });
});
