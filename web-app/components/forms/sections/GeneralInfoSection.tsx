import { ProviderFormData } from '../ProviderForm';

interface GeneralInfoSectionProps {
  data: ProviderFormData;
  onChange: (updates: Partial<ProviderFormData>) => void;
  errors: Record<string, string>;
}

export default function GeneralInfoSection({ data, onChange, errors }: GeneralInfoSectionProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-4">
        General Information
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            First Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={data.firstName}
            onChange={(e) => onChange({ firstName: e.target.value })}
            className={`w-full px-3 py-2 border rounded-lg dark:bg-slate-800 dark:text-white ${
              errors.firstName ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'
            }`}
            placeholder="John"
          />
          {errors.firstName && <p className="text-red-500 text-sm mt-1">{errors.firstName}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Last Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={data.lastName}
            onChange={(e) => onChange({ lastName: e.target.value })}
            className={`w-full px-3 py-2 border rounded-lg dark:bg-slate-800 dark:text-white ${
              errors.lastName ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'
            }`}
            placeholder="Smith"
          />
          {errors.lastName && <p className="text-red-500 text-sm mt-1">{errors.lastName}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Middle Name
          </label>
          <input
            type="text"
            value={data.middleName || ''}
            onChange={(e) => onChange({ middleName: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-800 dark:text-white"
            placeholder="Michael"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            NPI <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={data.npi}
            onChange={(e) => onChange({ npi: e.target.value })}
            className={`w-full px-3 py-2 border rounded-lg dark:bg-slate-800 dark:text-white ${
              errors.npi ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'
            }`}
            placeholder="1234567890"
            maxLength={10}
          />
          {errors.npi && <p className="text-red-500 text-sm mt-1">{errors.npi}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Email <span className="text-red-500">*</span>
          </label>
          <input
            type="email"
            value={data.email}
            onChange={(e) => onChange({ email: e.target.value })}
            className={`w-full px-3 py-2 border rounded-lg dark:bg-slate-800 dark:text-white ${
              errors.email ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'
            }`}
            placeholder="john.smith@example.com"
          />
          {errors.email && <p className="text-red-500 text-sm mt-1">{errors.email}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Phone
          </label>
          <input
            type="tel"
            value={data.phone}
            onChange={(e) => onChange({ phone: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-800 dark:text-white"
            placeholder="(555) 123-4567"
          />
        </div>
      </div>
    </div>
  );
}
