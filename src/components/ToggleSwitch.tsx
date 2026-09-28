interface ToggleSwitchProps {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

/** Shared on/off switch (role="switch") used across settings tabs. */
export default function ToggleSwitch({ id, checked, onChange, disabled = false }: ToggleSwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className="toggle-switch"
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-thumb" />
    </button>
  );
}
