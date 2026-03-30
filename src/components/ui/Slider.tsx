interface SliderProps {
  label: string
  value: number | undefined
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
  formatValue?: (v: number) => string
  accentClass?: string
}

export default function Slider({
  label,
  value,
  min = 1,
  max = 10,
  step = 1,
  onChange,
  formatValue,
  accentClass = 'accent-brand',
}: SliderProps) {
  const display = value != null ? (formatValue ? formatValue(value) : String(value)) : '—'

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between items-center">
        <span className="text-sm text-ink-muted">{label}</span>
        <span className="text-sm font-semibold text-ink">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value ?? min}
        onChange={e => onChange(Number(e.target.value))}
        className={`w-full h-2 rounded-full bg-surface-raised appearance-none cursor-pointer ${accentClass}`}
      />
      <div className="flex justify-between text-xs text-ink-faint">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}
