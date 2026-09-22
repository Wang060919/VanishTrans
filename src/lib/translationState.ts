/** Each window owns one lifecycle shared by text, stream and file operations. */
export class TranslationRequestLifecycle {
  private sequence: number;
  private active = false;
  constructor(initialSequence = 0) { this.sequence = initialSequence; }
  begin(): number { this.active = true; return ++this.sequence; }
  isCurrent(requestId: number): boolean { return requestId === this.sequence; }
  acceptsResult(requestId: number): boolean { return this.isCurrent(requestId) && this.active; }
  complete(requestId: number): boolean {
    if (!this.acceptsResult(requestId)) return false;
    this.active = false;
    return true;
  }
  invalidate(): void { ++this.sequence; this.active = false; }
}
let translationIdCounter = 0;
export function generateTranslationKey(): number { return ++translationIdCounter; }
