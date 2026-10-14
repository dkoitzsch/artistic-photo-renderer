export function EnumControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const segmented = options.length <= 3;
  return (
    <div className="control-row">
      <span className="control-label">{label}</span>
      {segmented ? (
        <span className="segmented" role="radiogroup" aria-label={label}>
          {options.map((o) => (
            <button
              key={o.value}
              role="radio"
              aria-checked={o.value === value}
              className={o.value === value ? 'active' : ''}
              onClick={() => {
                onChange(o.value);
              }}
            >
              {o.label}
            </button>
          ))}
        </span>
      ) : (
        <select
          className="select"
          aria-label={label}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
