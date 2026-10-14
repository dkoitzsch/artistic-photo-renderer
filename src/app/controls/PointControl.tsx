export function PointControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  const field = (i: 0 | 1) => (
    <input
      className="number-input"
      type="number"
      aria-label={`${label} ${i === 0 ? 'x' : 'y'}`}
      value={Math.round(value[i])}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (!Number.isFinite(n)) return;
        onChange(i === 0 ? [n, value[1]] : [value[0], n]);
      }}
    />
  );
  return (
    <div className="control-row">
      <span className="control-label">{label}</span>
      <span className="point-control">
        x {field(0)} y {field(1)}
      </span>
    </div>
  );
}
