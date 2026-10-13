import type { Story, StoryDefault } from "@ladle/react";
import { useMemo, useState } from "react";
import { HISTORY_RECORDS } from "../../.ladle/fixtures";
import HistoryPanel from "../features/HistoryPanel";
import type { TranslationRecord } from "../types";

export default {
  title: "翻译历史",
  meta: { windowLabel: "main" },
} satisfies StoryDefault;

interface HistoryFixtureProps {
  records?: TranslationRecord[];
  initialSearch?: string;
}

function HistoryFixture({ records = HISTORY_RECORDS, initialSearch = "" }: HistoryFixtureProps) {
  const [items, setItems] = useState(() => records.map((record) => ({ ...record })));
  const [search, setSearch] = useState(initialSearch);
  const matchingRecords = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query
      ? items.filter((record) => `${record.original}\n${record.translated}`.toLocaleLowerCase().includes(query))
      : items;
  }, [items, search]);

  return (
    <div className="vt-window-frame native-ui" style={{ width: 640, height: 560 }}>
      <HistoryPanel
        records={matchingRecords}
        search={search}
        onSearch={setSearch}
        onDelete={(id) => setItems((current) => current.filter((record) => record.id !== id))}
        onClear={() => setItems([])}
      />
    </div>
  );
}

export const Records: Story = () => <HistoryFixture />;
Records.storyName = "已有记录";

export const Empty: Story = () => <HistoryFixture records={[]} />;
Empty.storyName = "空状态";

export const NoMatches: Story = () => <HistoryFixture initialSearch="没有匹配的词" />;
NoMatches.storyName = "无搜索结果";
