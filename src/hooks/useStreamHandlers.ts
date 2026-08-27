import { useCallback } from "react";
import { isCompletedRequest, isCurrentRequest } from "../lib/translationState";

interface UseStreamHandlersProps {
  requestIdRef: React.MutableRefObject<number>;
  completedRequestIdRef: React.MutableRefObject<number | null>;
  setOutputText: (updater: (prev: string) => string) => void;
  setStreaming: (streaming: boolean) => void;
}

/**
 * Hook for handling streaming translation events from Tauri.
 * Single responsibility: process stream chunks and completion events.
 */
export function useStreamHandlers({
  requestIdRef,
  completedRequestIdRef,
  setOutputText,
  setStreaming,
}: UseStreamHandlersProps) {
  // Handle streaming chunk from Tauri event
  const handleStreamChunk = useCallback(
    (payload: { requestId: number; chunk: string }) => {
      if (
        !isCurrentRequest(payload.requestId, requestIdRef) ||
        isCompletedRequest(payload.requestId, completedRequestIdRef)
      ) {
        return;
      }
      setOutputText((prev) => prev + payload.chunk);
    },
    [requestIdRef, completedRequestIdRef, setOutputText]
  );

  // Handle stream completion from Tauri event
  const handleStreamDone = useCallback(
    (payload: { requestId: number; fullText: string }) => {
      if (!isCurrentRequest(payload.requestId, requestIdRef)) return;

      // Mark this request as completed
      completedRequestIdRef.current = payload.requestId;

      // Chunks can be delayed or coalesced, so use authoritative final payload
      setOutputText(() => payload.fullText);
      setStreaming(false);
    },
    [requestIdRef, completedRequestIdRef, setOutputText, setStreaming]
  );

  return {
    handleStreamChunk,
    handleStreamDone,
  };
}
