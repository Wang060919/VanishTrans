import type { useLinuxOcr } from "../hooks/useLinuxOcr";

type Props = { ocr: ReturnType<typeof useLinuxOcr>; onApply: (text: string) => void; disabled: boolean };
export default function LinuxOcrPreview({ ocr, onApply, disabled }: Props) {
  return <section aria-label="Linux 截图 OCR">
    <label>OCR 语言代码 <input value={ocr.language} disabled={ocr.busy} maxLength={80}
      onChange={(event) => ocr.setLanguage(event.target.value)} placeholder="eng 或 chi_sim+eng" /></label>
    <p>需要本机 Tesseract 及对应语言包。系统截图窗口可取消；图片仅在本机识别，不自动上传或翻译。</p>
    {ocr.busy && <p role="status">等待系统截图或正在本机识别…</p>}
    {ocr.error && <p role="alert">{ocr.error}</p>}
    {ocr.text !== null && <div>
      <label>OCR 预览<textarea value={ocr.text} onChange={(event) => ocr.setText(event.target.value)} /></label>
      <button type="button" disabled={disabled} onClick={() => { if (ocr.text !== null) onApply(ocr.text); ocr.dismiss(); }}>替换输入文本（不自动翻译）</button>
      <button type="button" onClick={ocr.dismiss}>丢弃识别结果</button>
    </div>}
  </section>;
}
