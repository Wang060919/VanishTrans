import { useId, type ChangeEvent, type FocusEvent, type InputHTMLAttributes } from "react";

interface SettingInputProps {
  label: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: InputHTMLAttributes<HTMLInputElement>["type"];
}

export default function SettingInput({ label, value, onChange, onBlur, placeholder, type = "text" }: SettingInputProps) {
  const id = useId();
  return (
    <div className="setting-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} value={value} onChange={onChange} onBlur={onBlur} placeholder={placeholder} />
    </div>
  );
}
