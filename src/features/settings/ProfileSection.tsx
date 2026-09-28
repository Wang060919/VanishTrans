import { Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import type { ServiceProfile } from "../../types";

interface ProfileSectionProps {
  profiles: ServiceProfile[];
  baseUrl: string;
  model: string;
  onSaveProfile: (profile: ServiceProfile) => Promise<ServiceProfile[]>;
  onDeleteProfile: (name: string) => Promise<ServiceProfile[]>;
  onApplyProfile: (name: string) => Promise<ServiceProfile>;
  notifySaved: () => void;
  notifyError: (error: unknown) => void;
}

/** Save current connection as a named profile + existing profile list. */
export default function ProfileSection({
  profiles,
  baseUrl,
  model,
  onSaveProfile,
  onDeleteProfile,
  onApplyProfile,
  notifySaved,
  notifyError,
}: ProfileSectionProps) {
  const [profileName, setProfileName] = useState("");

  const handleSave = useCallback(async () => {
    const name = profileName.trim();
    if (!name) {
      notifyError(new Error("请输入档案名称"));
      return;
    }
    try {
      await onSaveProfile({ name, baseUrl: baseUrl.trim(), model: model.trim() });
      setProfileName("");
      notifySaved();
    } catch (error) {
      notifyError(error);
    }
  }, [baseUrl, model, notifyError, notifySaved, onSaveProfile, profileName]);

  const handleApply = useCallback(
    async (name: string) => {
      try {
        await onApplyProfile(name);
      } catch (error) {
        notifyError(error);
      }
    },
    [notifyError, onApplyProfile]
  );

  const handleDelete = useCallback(
    async (name: string) => {
      try {
        await onDeleteProfile(name);
      } catch (error) {
        notifyError(error);
      }
    },
    [notifyError, onDeleteProfile]
  );

  return (
    <>
      <div className="setting-field">
        <label htmlFor="profile-name">保存为服务档案</label>
        <div className="setting-inline">
          <input
            id="profile-name"
            type="text"
            value={profileName}
            onChange={(event) => setProfileName(event.target.value)}
            placeholder="如：OpenAI / DeepSeek / 本地 Ollama"
          />
          <button type="button" className="secondary-button" onClick={() => void handleSave()}>
            保存档案
          </button>
        </div>
      </div>
      {profiles.length > 0 && (
        <div className="profile-list">
          {profiles.map((profile) => (
            <div className="profile-row" key={profile.name}>
              <span className="profile-name">{profile.name}</span>
              <span className="profile-meta">{profile.baseUrl} · {profile.model}</span>
              <button type="button" className="secondary-button" onClick={() => void handleApply(profile.name)}>
                应用
              </button>
              <button
                type="button"
                className="text-action text-action--danger"
                aria-label={`删除档案 ${profile.name}`}
                onClick={() => void handleDelete(profile.name)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
