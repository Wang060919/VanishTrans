import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

const listeners: Record<string, (event: { payload: unknown }) => void> = {};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((eventName: string, cb: (event: { payload: unknown }) => void) => {
    listeners[eventName] = cb;
    return Promise.resolve(() => {
      delete listeners[eventName];
    });
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({ label: "main" })),
}));

import { invoke } from "@tauri-apps/api/core";

const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

function emit(eventName: string, payload: unknown = undefined) {
  listeners[eventName]?.({ payload });
}

describe("App", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    for (const key of Object.keys(listeners)) delete listeners[key];
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_api_config") {
        return Promise.resolve({ baseUrl: "https://api.openai.com", hasApiKey: false, model: "gpt-4o-mini" });
      }
      if (cmd === "cleanup_clipboard_text") {
        return Promise.resolve("hello world");
      }
      if (cmd === "translate_stream") {
        // Simulate streaming: emit chunks then resolve
        setTimeout(() => {
          emit("translate-stream-chunk", "你好");
          emit("translate-stream-chunk", "世界");
          emit("translate-stream-done", "你好世界");
        }, 0);
        return Promise.resolve("你好世界");
      }
      return Promise.resolve(undefined);
    });
  });

  it("loads saved API config on mount", async () => {
    render(<App />);
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("get_api_config");
    });
  });

  it("preserves a stored API key when saving another setting", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_api_config") {
        return Promise.resolve({ baseUrl: "https://api.openai.com", hasApiKey: true, model: "gpt-4o-mini" });
      }
      return Promise.resolve(undefined);
    });

    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("get_api_config"));

    await user.click(screen.getByRole("button", { name: "打开设置" }));
    const modelInput = screen.getByDisplayValue("gpt-4o-mini");
    await user.clear(modelInput);
    await user.type(modelInput, "gpt-4.1-mini");
    await user.tab();

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("set_api_config", {
        baseUrl: "https://api.openai.com",
        apiKey: null,
        model: "gpt-4.1-mini",
      });
    });
  });

  it("translates clipboard text received via shortcut-translate event", async () => {
    render(<App />);
    await waitFor(() => expect(listeners["shortcut-translate"]).toBeDefined());

    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "read_clipboard_safe") return Promise.resolve("hello world");
      if (cmd === "cleanup_clipboard_text") return Promise.resolve("hello world");
      if (cmd === "translate_stream") {
        setTimeout(() => {
          emit("translate-stream-chunk", "你好");
          emit("translate-stream-chunk", "世界");
          emit("translate-stream-done", "你好世界");
        }, 0);
        return Promise.resolve("你好世界");
      }
      if (cmd === "get_api_config") {
        return Promise.resolve({ baseUrl: "https://api.openai.com", hasApiKey: false, model: "gpt-4o-mini" });
      }
      return Promise.resolve(undefined);
    });

    emit("shortcut-translate");

    await waitFor(() => {
      expect(screen.getByText(/你好/)).toBeInTheDocument();
    });
    expect(mockedInvoke).toHaveBeenCalledWith(
      "translate_stream",
      expect.objectContaining({ text: "hello world" }),
    );
  });

  it("skips translation when clipboard content is our own", async () => {
    render(<App />);
    await waitFor(() => expect(listeners["shortcut-translate"]).toBeDefined());

    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "read_clipboard_safe") return Promise.reject("SKIP_OWN_CONTENT");
      if (cmd === "get_api_config") {
        return Promise.resolve({ baseUrl: "https://api.openai.com", hasApiKey: false, model: "gpt-4o-mini" });
      }
      return Promise.resolve(undefined);
    });

    emit("shortcut-translate");

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("read_clipboard_safe");
    });
    expect(mockedInvoke).not.toHaveBeenCalledWith(
      "translate_stream",
      expect.anything(),
    );
  });

  it("translates OCR text received via ocr-translate event", async () => {
    render(<App />);
    await waitFor(() => expect(listeners["ocr-translate"]).toBeDefined());

    emit("ocr-translate", "scanned text");

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith(
        "translate_stream",
        expect.objectContaining({ text: "hello world" }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText(/你好/)).toBeInTheDocument();
    });
  });

  it("sends the current direction to translate_stream", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("get_api_config"));

    const sourceLanguage = screen.getByRole("combobox", { name: "源语言" });
    await user.selectOptions(sourceLanguage, "zh");

    const textarea = screen.getByPlaceholderText("输入、粘贴或拖入文件");
    await user.type(textarea, "some text{enter}");

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith(
        "translate_stream",
        expect.objectContaining({ direction: "zh2en" }),
      );
    });
  });

  it("shows an error when translation fails", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_api_config") {
        return Promise.resolve({ baseUrl: "https://api.openai.com", hasApiKey: false, model: "gpt-4o-mini" });
      }
      if (cmd === "cleanup_clipboard_text") return Promise.resolve("hello");
      if (cmd === "translate_stream") return Promise.reject("请先在设置中配置 API Key");
      return Promise.resolve(undefined);
    });

    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("get_api_config"));

    const textarea = screen.getByPlaceholderText("输入、粘贴或拖入文件");
    await user.type(textarea, "hello{enter}");

    await waitFor(() => {
      expect(screen.getByText(/请先在设置中配置 API Key/)).toBeInTheDocument();
    });
  });
  it("exposes the branded compact workspace through accessible controls", async () => {
    render(<App />);
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("get_api_config"));

    expect(screen.getByLabelText("VanishTrans")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "翻译文本" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开历史记录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开设置" })).toBeInTheDocument();
    expect(screen.queryByText("⚙")).not.toBeInTheDocument();
    expect(screen.queryByText("📋")).not.toBeInTheDocument();
    expect(screen.queryByText("📌")).not.toBeInTheDocument();
  });

  it("keeps settings and history in mutually exclusive overlay drawers", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_api_config") {
        return Promise.resolve({ baseUrl: "https://api.openai.com", hasApiKey: false, model: "gpt-4o-mini" });
      }
      if (cmd === "get_history") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("get_api_config"));

    await user.click(screen.getByRole("button", { name: "打开设置" }));
    expect(screen.getByRole("dialog", { name: "设置" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开历史记录" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "翻译历史" })).toBeInTheDocument());
    expect(screen.queryByRole("dialog", { name: "设置" })).not.toBeInTheDocument();
  });
});
