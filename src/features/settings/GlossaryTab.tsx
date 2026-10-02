import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GlossaryEntry } from "../../types";

interface DraftRow {
  id: number;
  entry: GlossaryEntry;
}

interface GlossaryTabProps {
  glossary: GlossaryEntry[];
  onGlossaryChange: (entries: GlossaryEntry[]) => Promise<void>;
  notifyError: (error: unknown) => void;
}

/**
 * Glossary tab: pinned source→target terms. Edits are debounced (400ms)
 * and flushed on unmount so no keystroke is lost.
 */
export default function GlossaryTab({ glossary, onGlossaryChange, notifyError }: GlossaryTabProps) {
  const nextRowId = useRef(0);
  const [draftRows, setDraftRows] = useState<DraftRow[]>(() =>
    glossary.map((entry) => ({ id: nextRowId.current++, entry }))
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef(glossary);
  const onChangeRef = useRef(onGlossaryChange);
  const userEditedRef = useRef(false);

  useEffect(() => {
    onChangeRef.current = onGlossaryChange;
  }, [onGlossaryChange]);

  useEffect(() => {
    if (!userEditedRef.current) setDraftRows(glossary.map((entry) => ({ id: nextRowId.current++, entry })));
  }, [glossary]);

  // Flush the pending debounced edit before the tab unmounts.
  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        void onChangeRef.current(draftRef.current).catch(() => {});
      }
    },
    []
  );

  const persist = useCallback(
    async (entries: GlossaryEntry[]) => {
      try {
        await onGlossaryChange(entries);
      } catch (error) {
        notifyError(error);
      }
    },
    [notifyError, onGlossaryChange]
  );

  const scheduleSave = useCallback(
    (entries: GlossaryEntry[]) => {
      draftRef.current = entries;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void persist(draftRef.current);
      }, 400);
    },
    [persist]
  );

  const updateEntry = useCallback(
    (index: number, patch: Partial<GlossaryEntry>) => {
      userEditedRef.current = true;
      const next = draftRows.map((row, i) =>
        i === index ? { ...row, entry: { ...row.entry, ...patch } } : row
      );
      setDraftRows(next);
      scheduleSave(next.map((row) => row.entry));
    },
    [draftRows, scheduleSave]
  );

  const addTerm = useCallback(() => {
    userEditedRef.current = true;
    const next = [...draftRows, { id: nextRowId.current++, entry: { source: "", target: "" } }];
    setDraftRows(next);
    // Persist through the same debounced flow so an unmount flush does not
    // silently drop a freshly added row (empty rows are saved literally).
    scheduleSave(next.map((row) => row.entry));
  }, [draftRows, scheduleSave]);

  const deleteTerm = useCallback(
    (index: number) => {
      userEditedRef.current = true;
      const next = draftRows.filter((_, i) => i !== index);
      setDraftRows(next);
      scheduleSave(next.map((row) => row.entry));
    },
    [draftRows, scheduleSave]
  );

  return (
    <section className="settings-section" aria-labelledby="glossary-settings-title">
      <div className="settings-section-heading settings-section-heading--action">
        <div><h3 id="glossary-settings-title">固定术语</h3><p>为品牌名和专业词汇指定稳定译法。</p></div>
        <button type="button" className="secondary-button" onClick={addTerm}>
          <Plus size={14} aria-hidden="true" />
          添加
        </button>
      </div>
      {draftRows.length === 0 ? (
        <div className="settings-empty">还没有术语。添加后会在翻译提示中自动应用。</div>
      ) : (
        <div className="glossary-list">
          {draftRows.map(({ id, entry }, index) => (
            <div className="glossary-row" key={id}>
              <input
                aria-label={`术语原文 ${index + 1}`}
                value={entry.source}
                onChange={(event) => updateEntry(index, { source: event.target.value })}
                placeholder="原文"
              />
              <span>→</span>
              <input
                aria-label={`术语译文 ${index + 1}`}
                value={entry.target}
                onChange={(event) => updateEntry(index, { target: event.target.value })}
                placeholder="译文"
              />
              <button type="button" aria-label={`删除术语 ${index + 1}`} onClick={() => deleteTerm(index)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
