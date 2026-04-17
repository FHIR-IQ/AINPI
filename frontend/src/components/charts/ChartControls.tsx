'use client';

interface SelectOption {
  value: string;
  label: string;
}

interface ChartSelectProps {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}

export function ChartSelect({ label, value, options, onChange }: ChartSelectProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs font-medium text-gray-500 whitespace-nowrap">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-sm border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary-500"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

interface ChartHeaderProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode; // dropdown controls
}

export function ChartHeader({ title, subtitle, children }: ChartHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
    </div>
  );
}
