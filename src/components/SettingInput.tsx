import { ChangeEvent, FocusEvent, InputHTMLAttributes } from "react";

interface SettingInputProps {
  label: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: InputHTMLAttributes<HTMLInputElement>["type"];
}

export default function SettingInput({ label, value, onChange, onBlur, placeholder, type = "text" }: SettingInputProps) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-medium text-text-muted">{label}</label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
        className="w-full text-[12px] border border-border-subtle rounded-lg px-3 py-1.5 bg-[#f8f8f8] dark:bg-surface-overlay focus:outline-none focus:ring-2 focus:ring-primary-soft focus:border-primary-border placeholder:text-text-ghost transition-all"
      />
    </div>
  );
}
