// Erzeugt den passenden Regler aus einer Parameterbeschreibung des Manifests.

import { DEFAULT_TEXT_LENGTH, type ParamSpec, type ParamValue, type Rgb } from '../../effects/manifest';
import { paletteOf } from '../../effects/layout';
import { ImageControl } from './ImageControl';
import { PaletteControl } from './PaletteControl';
import { SeedControl } from './SeedControl';
import { ColorControl } from './ColorControl';
import { EnumControl } from './EnumControl';
import { PointControl } from './PointControl';
import { Slider } from './Slider';
import { TextControl } from './TextControl';
import { Toggle } from './Toggle';

export function ParamControl({
  spec,
  value,
  onChange,
  onGestureEnd,
  extractPalette,
}: {
  spec: ParamSpec;
  value: ParamValue | undefined;
  onChange: (v: ParamValue, gesture: boolean) => void;
  onGestureEnd: () => void;
  /** für Paletten-Parameter: Palette aus der Ebene bzw. einer Bilddatei gewinnen */
  extractPalette?: (count: number, file?: File) => Promise<Rgb[] | null>;
}) {
  const v = value ?? spec.default;
  switch (spec.type) {
    case 'int':
    case 'float':
      return (
        <Slider
          label={spec.label}
          hint={spec.hint}
          value={typeof v === 'number' ? v : spec.default}
          min={spec.min}
          max={spec.max}
          defaultValue={spec.default}
          step={spec.step ?? (spec.type === 'int' ? 1 : undefined)}
          scale={spec.scale ?? 'linear'}
          unit={spec.unit}
          onChange={onChange}
          onGestureEnd={onGestureEnd}
          testId={`param-${spec.key}`}
        />
      );
    case 'angle':
      return (
        <Slider
          label={spec.label}
          hint={spec.hint}
          value={typeof v === 'number' ? v : spec.default}
          min={0}
          max={360}
          defaultValue={spec.default}
          step={1}
          unit="°"
          onChange={onChange}
          onGestureEnd={onGestureEnd}
          testId={`param-${spec.key}`}
        />
      );
    case 'bool':
      return (
        <Toggle
          label={spec.label}
          value={typeof v === 'boolean' ? v : spec.default}
          onChange={(b) => {
            onChange(b, false);
          }}
        />
      );
    case 'enum':
      return (
        <EnumControl
          label={spec.label}
          value={typeof v === 'string' ? v : spec.default}
          options={spec.options}
          onChange={(s) => {
            onChange(s, false);
          }}
        />
      );
    case 'color':
      return (
        <ColorControl
          label={spec.label}
          value={Array.isArray(v) && v.length === 3 && typeof v[0] === 'number' ? (v as Rgb) : spec.default}
          onChange={(c) => {
            onChange(c, false);
          }}
        />
      );
    case 'point':
      return (
        <PointControl
          label={spec.label}
          value={
            Array.isArray(v) && v.length === 2 && typeof v[0] === 'number'
              ? (v as [number, number])
              : spec.default
          }
          onChange={(p) => {
            onChange(p, false);
          }}
        />
      );
    case 'seed':
      return (
        <SeedControl
          label={spec.label}
          value={typeof v === 'number' ? v : spec.default}
          onChange={(n) => {
            onChange(n, false);
          }}
          testId={`param-${spec.key}`}
        />
      );
    case 'palette':
      return (
        <PaletteControl
          label={spec.label}
          value={paletteOf(v, spec.default)}
          onChange={(list) => {
            onChange(list, false);
          }}
          testId={`param-${spec.key}`}
          {...(extractPalette ? { extract: extractPalette } : {})}
        />
      );
    case 'text':
      return (
        <TextControl
          label={spec.label}
          value={typeof v === 'string' ? v : spec.default}
          maxLength={spec.maxLength ?? DEFAULT_TEXT_LENGTH}
          onChange={(t) => {
            onChange(t, false);
          }}
          testId={`param-${spec.key}`}
        />
      );
    case 'image':
      return (
        <ImageControl
          label={spec.label}
          value={typeof v === 'string' ? v : ''}
          onChange={(id) => {
            onChange(id, false);
          }}
          testId={`param-${spec.key}`}
          notice={spec.notice}
        />
      );
  }
}
