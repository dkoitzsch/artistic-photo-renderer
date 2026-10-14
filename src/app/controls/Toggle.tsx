export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="control-row">
      <span className="control-label">{label}</span>
      <button
        role="switch"
        aria-checked={value}
        aria-label={label}
        className={`switch${value ? ' on' : ''}`}
        onClick={() => {
          onChange(!value);
        }}
      >
        <span className="switch-knob" />
      </button>
    </div>
  );
}
