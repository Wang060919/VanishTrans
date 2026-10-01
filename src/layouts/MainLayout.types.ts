import type React from "react";
import type { GlossaryEntry, HotkeyEntry, ServiceProfile } from "../types";
import type { LangDirection } from "../hooks/useTranslation";

export interface MainLayoutShellProps {
  embedded?: boolean;
  notices?: string[];
  onDismissNotice?: (message: string) => void;
  onCollapse?: () => void | Promise<void>;
  onScreenshot?: () => void | Promise<void>;
  onWindowDragStart?: () => boolean | void;
  onWindowDragEnd?: () => void;
  onWindowMoved?: () => void | Promise<void>;
}

export interface MainLayoutTranslationProps {
  inputText: string;
  onInputChange: (v: string) => void;
  outputText: string;
  translationError?: string | null;
  loading: boolean;
  streaming: boolean;
  direction: LangDirection;
  onDirectionChange: (d: LangDirection) => void;
  glowActive: boolean;
  onClearGlow: () => void;
  /** "清空" resets the whole session: input, output, error and file status. */
  onClear: () => void;
  onTranslate: (forceRefresh?: boolean) => void;
  onCancelTranslation?: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  fileStatus: string | null;
  onTranslateFile: (filename: string, content: string) => void;
  translationKey: number;
}

export interface MainLayoutConfigProps {
  baseUrl: string;
  onBaseUrlChange: (v: string) => void;
  model: string;
  onModelChange: (v: string) => void;
  hasStoredApiKey: boolean;
  apiKeyUpdate: string | null;
  onApiKeyChange: (v: string | null) => void;
  onSaveConfig: (forcedApiKey?: string) => Promise<void>;
  glossary: GlossaryEntry[];
  onGlossaryChange: (entries: GlossaryEntry[]) => Promise<void>;
  hotkeys: HotkeyEntry[];
  hotkeyLabels: Record<string, string>;
  onHotkeysChange: (entries: HotkeyEntry[]) => Promise<void>;
  profiles: ServiceProfile[];
  onSaveProfile: (profile: ServiceProfile) => Promise<ServiceProfile[]>;
  onDeleteProfile: (name: string) => Promise<ServiceProfile[]>;
  onApplyProfile: (name: string) => Promise<ServiceProfile>;
  onTestConnection: () => Promise<string>;
  loggingEnabled: boolean;
  onSetLogging: (enabled: boolean) => Promise<void>;
  freeTranslation: boolean;
  onSetFreeTranslation: (enabled: boolean) => Promise<void>;
}

export interface MainLayoutProps {
  shell?: MainLayoutShellProps;
  pinned: boolean;
  onPin: () => void;
  translation: MainLayoutTranslationProps;
  config: MainLayoutConfigProps;
}
