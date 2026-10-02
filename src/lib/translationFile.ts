import { countChars } from "./textUtils";
import { detectFileType, parseSrt, rebuildSrt, parseJson, rebuildJson, MAX_TRANSLATION_CHARS } from "./fileParser";

// The backend may substitute a longer ===VANISHTRANS_SEGMENT_{i}=== marker when
// the default one collides with source text; estimating with the worst case keeps
// a file that passes here from tripping the backend's MAX_INPUT_CHARS check.
const WORST_CASE_SEGMENT_MARKER = "\n\n===VANISHTRANS_SEGMENT_1000===\n\n";

/** Parsing/reassembly is independent of requests and UI state. */
export function prepareTranslationFile(filename: string, content: string) {
  const type = detectFileType(filename);
  let segments: string[];
  let rebuild: (translated: string[]) => string;
  if (type === "srt") {
    const blocks = parseSrt(content);
    if (!blocks.length) throw new Error("未找到有效的字幕块");
    segments = blocks.filter((block) => block.text.trim()).map((block) => block.text);
    rebuild = (translated) => {
      let index = 0;
      return rebuildSrt(blocks.map((block) => block.text.trim()
        ? { ...block, text: translated[index++] ?? block.text } : block));
    };
  } else if (type === "json") {
    const parsed = parseJson(content);
    if (!parsed.length) throw new Error("JSON 中没有可翻译的文本");
    segments = parsed.map((segment) => segment.text);
    rebuild = (translated) => rebuildJson(content, new Map(parsed.flatMap((segment, index) =>
      translated[index] === undefined ? [] : [[segment.path, translated[index]]])));
  } else {
    throw new Error(`不支持的文件类型: ${filename}`);
  }
  if (!segments.length) throw new Error("文件中没有可翻译的文本");
  const length = countChars(segments.join(WORST_CASE_SEGMENT_MARKER));
  if (length > MAX_TRANSLATION_CHARS) {
    throw new Error(`文件内容过长（批处理共 ${length.toLocaleString()} 字符），最多支持 ${MAX_TRANSLATION_CHARS.toLocaleString()} 字符`);
  }
  return { segments, rebuild };
}
