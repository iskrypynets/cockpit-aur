import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LogViewer } from "./LogViewer";

const SCROLL_HEIGHT = 1000;
const CLIENT_HEIGHT = 300;

function sizeLog(el: HTMLElement, scrollHeight = SCROLL_HEIGHT) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => CLIENT_HEIGHT });
}

function scrollTo(el: HTMLElement, top: number) {
  el.scrollTop = top;
  fireEvent.scroll(el);
}

describe("LogViewer", () => {
  afterEach(() => cleanup());

  it("is a focusable, silent log region with a label", () => {
    render(<LogViewer log="line" aria-label="Upgrade output" />);
    const log = screen.getByRole("log", { name: "Upgrade output" });
    expect(log).toHaveAttribute("tabindex", "0");
    expect(log).toHaveAttribute("aria-live", "off");
  });

  it("defaults the label to Output", () => {
    render(<LogViewer log="line" />);
    expect(screen.getByRole("log", { name: "Output" })).toBeInTheDocument();
  });

  it("follows new output while at the bottom", () => {
    const { rerender } = render(<LogViewer log="a" />);
    const log = screen.getByRole("log");
    sizeLog(log);
    rerender(<LogViewer log={"a\nb"} />);
    expect(log.scrollTop).toBe(SCROLL_HEIGHT);
    expect(screen.queryByRole("button", { name: "Jump to latest" })).not.toBeInTheDocument();
  });

  it("keeps following within 24 px of the bottom", () => {
    const { rerender } = render(<LogViewer log="a" />);
    const log = screen.getByRole("log");
    sizeLog(log);
    scrollTo(log, SCROLL_HEIGHT - CLIENT_HEIGHT - 20);
    rerender(<LogViewer log={"a\nb"} />);
    expect(log.scrollTop).toBe(SCROLL_HEIGHT);
  });

  it("keeps scrollTop and offers Jump to latest after scrolling up, and resumes on click", () => {
    const { rerender } = render(<LogViewer log="a" />);
    const log = screen.getByRole("log");
    sizeLog(log);
    scrollTo(log, 100);

    sizeLog(log, SCROLL_HEIGHT + 200);
    rerender(<LogViewer log={"a\nb"} />);
    expect(log.scrollTop).toBe(100);

    fireEvent.click(screen.getByRole("button", { name: "Jump to latest" }));
    expect(log.scrollTop).toBe(SCROLL_HEIGHT + 200);
    expect(screen.queryByRole("button", { name: "Jump to latest" })).not.toBeInTheDocument();
    expect(log).toHaveFocus();

    sizeLog(log, SCROLL_HEIGHT + 400);
    rerender(<LogViewer log={"a\nb\nc"} />);
    expect(log.scrollTop).toBe(SCROLL_HEIGHT + 400);
  });

  it("copies log to clipboard and displays Copied state", async () => {
    let clipboardText = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          clipboardText = text;
        },
      },
    });
    // Set isSecureContext
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });

    render(<LogViewer log="sample log output" />);
    const copyBtn = screen.getByRole("button", { name: "Copy log" });
    expect(copyBtn).toBeInTheDocument();

    fireEvent.click(copyBtn);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(clipboardText).toBe("sample log output");
  });

  it("falls back to execCommand copy when clipboard API is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    let execCommandCalled = false;
    let commandArg = "";
    document.execCommand = (cmd: string) => {
      execCommandCalled = true;
      commandArg = cmd;
      return true;
    };

    render(<LogViewer log="fallback log output" />);
    const copyBtn = screen.getByRole("button", { name: "Copy log" });

    fireEvent.click(copyBtn);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(execCommandCalled).toBe(true);
    expect(commandArg).toBe("copy");
  });

  it("downloads log as txt file on clicking Download button", () => {
    let clickedHref = "";
    let downloadAttr = "";
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = () => "blob:test";
    URL.revokeObjectURL = () => {};

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clickedHref = this.href;
      downloadAttr = this.download;
    });

    render(<LogViewer log="downloadable log" />);
    const downloadBtn = screen.getByRole("button", { name: "Download log" });
    fireEvent.click(downloadBtn);

    expect(clickSpy).toHaveBeenCalled();
    expect(clickedHref).toBe("blob:test");
    expect(downloadAttr).toMatch(/^cockpit-aur-log-.*\.txt$/);

    clickSpy.mockRestore();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("shares log via navigator.share when available", async () => {
    let sharedPayload: any = null;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (payload: any) => {
        sharedPayload = payload;
      },
    });

    render(<LogViewer log="shareable log" aria-label="Build Output" />);
    const shareBtn = screen.getByRole("button", { name: "Share log" });
    expect(shareBtn).toBeInTheDocument();

    fireEvent.click(shareBtn);
    expect(sharedPayload).toEqual({
      title: "Build Output",
      text: "shareable log",
    });
  });
});
