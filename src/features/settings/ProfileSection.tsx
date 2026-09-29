import { Trash2 } from "lucide-react";
import { useState } from "react";
import type { ServiceProfile } from "../../types";
import ProfileSelect from "./ProfileSelect";

interface ProfileSectionProps {
  profiles: ServiceProfile[];
  baseUrl: string;
  model: string;
  onSaveProfile: (profile: ServiceProfile) => Promise<ServiceProfile[]>;
  onDeleteProfile: (name: string) => Promise<ServiceProfile[]>;
  onApplyProfile: (name: string) => Promise<ServiceProfile>;
  notifyError: (error: unknown) => void;
}

export default function ProfileSection({ profiles, baseUrl, model, onSaveProfile,
  onDeleteProfile, onApplyProfile, notifyError }: ProfileSectionProps) {
  const [profileName, setProfileName] = useState("");
  const [selected, setSelected] = useState("");
  const [naming, setNaming] = useState(false);
  const [pending, setPending] = useState(false);
  const selection = profiles.some((profile) => profile.name === selected) ? selected : "";

  const run = async (operation: () => Promise<unknown>) => {
    setPending(true);
    try { await operation(); } catch (error) { notifyError(error); }
    finally { setPending(false); }
  };
  const save = () => run(async () => {
    const name = profileName.trim();
    if (!name) return;
    await onSaveProfile({ name, baseUrl: baseUrl.trim(), model: model.trim() });
    setSelected(name);
    setProfileName("");
    setNaming(false);
  });

  return (
    <div className="settings-profiles">
      <div className="profile-toolbar">
        {profiles.length > 0 ? <>
          <ProfileSelect profiles={profiles} value={selection} disabled={pending} onChange={setSelected} />
          <button type="button" className="secondary-button" disabled={!selection || pending}
            onClick={() => void run(() => onApplyProfile(selection))}>应用</button>
          <button type="button" className="text-action text-action--danger"
            aria-label={"删除配置 " + selection} disabled={!selection || pending}
            onClick={() => void run(() => onDeleteProfile(selection))}><Trash2 size={14} /></button>
        </> : <span className="setting-hint">常用服务配置</span>}
        <button type="button" className="text-action profile-save-action" aria-expanded={naming}
          disabled={pending} onClick={() => setNaming(!naming)}>{naming ? "取消" : "另存为配置"}</button>
      </div>
      {naming && <form className="profile-naming" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label htmlFor="profile-name">配置名称</label>
        <div className="setting-inline">
          <input id="profile-name" type="text" value={profileName} disabled={pending}
            onChange={(event) => setProfileName(event.target.value)} placeholder="例如：日常翻译" />
          <button type="submit" className="secondary-button" disabled={pending || !profileName.trim()}>保存配置</button>
        </div>
        <p className="setting-hint">仅保存服务地址和模型，不包含 API Key。</p>
      </form>}
    </div>
  );
}
