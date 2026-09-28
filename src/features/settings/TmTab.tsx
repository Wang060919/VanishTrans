import { useState } from "react";
import TmPanel from "../TmPanel";

/** Translation memory tab: search state lives here so switching tabs resets nothing else. */
export default function TmTab() {
  const [search, setSearch] = useState("");
  return (
    <section className="settings-section" style={{ padding: 0, overflow: "hidden" }} aria-label="翻译记忆">
      <TmPanel searchQuery={search} onSearchChange={setSearch} />
    </section>
  );
}
