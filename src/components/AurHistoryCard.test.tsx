import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AurHistoryCard } from "./AurHistoryCard";
import * as api from "../api";

vi.mock("../api", () => ({
  getAurHistoryLog: vi.fn(),
}));

const mockEntries: api.AurHistoryEntry[] = [
  {
    id: "aur-1795291267",
    timestamp: "2026-11-21T22:01:07+0200",
    operation: "upgrade",
    packages: ["lib32-imlib2"],
    status: "failed",
    exit_code: 1,
    duration_secs: 526,
    error: "AUR operation failed with exit code 1",
    has_log: true,
  },
  {
    id: "aur-1795280000",
    timestamp: "2026-11-21T19:00:00+0200",
    operation: "install",
    packages: ["google-chrome"],
    status: "completed",
    exit_code: 0,
    duration_secs: 45,
    has_log: true,
  },
];

describe("AurHistoryCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when entries list is empty and not loading", () => {
    const { container } = render(<AurHistoryCard entries={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the AUR operations history card with entries", () => {
    render(<AurHistoryCard entries={mockEntries} />);
    expect(screen.getByText("AUR Operations History")).toBeInTheDocument();
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    expect(screen.getByText("lib32-imlib2")).toBeInTheDocument();
    expect(screen.getByText("google-chrome")).toBeInTheDocument();
    expect(screen.getByText("Upgrade")).toBeInTheDocument();
    expect(screen.getByText("Install")).toBeInTheDocument();
    expect(screen.getByText("Failed (1)")).toBeInTheDocument();
    expect(screen.getByText("Success")).toBeInTheDocument();
  });

  it("filters entries according to searchQuery", () => {
    render(<AurHistoryCard entries={mockEntries} searchQuery="imlib" />);
    expect(screen.getByText("lib32-imlib2")).toBeInTheDocument();
    expect(screen.queryByText("google-chrome")).not.toBeInTheDocument();
  });

  it("toggles card body on collapse/expand", () => {
    render(<AurHistoryCard entries={mockEntries} />);
    expect(screen.getByText("lib32-imlib2")).toBeInTheDocument();

    const collapseButton = screen.getByLabelText("Collapse AUR operations history");
    fireEvent.click(collapseButton);

    expect(screen.queryByText("lib32-imlib2")).not.toBeInTheDocument();

    const expandButton = screen.getByLabelText("Expand AUR operations history");
    fireEvent.click(expandButton);

    expect(screen.getByText("lib32-imlib2")).toBeInTheDocument();
  });

  it("opens modal and displays build log when 'Build log' button is clicked", async () => {
    vi.mocked(api.getAurHistoryLog).mockResolvedValueOnce({
      id: "aur-1795291267",
      log: "Linking libarchive_test failed with undefined reference to blake2sp_update",
    });

    render(<AurHistoryCard entries={mockEntries} />);
    const logButtons = screen.getAllByRole("button", { name: /view build log/i });
    fireEvent.click(logButtons[0]);

    expect(await screen.findByText(/AUR Build Log: lib32-imlib2/i)).toBeInTheDocument();
    expect(
      await screen.findByText(/Linking libarchive_test failed with undefined reference to blake2sp_update/i)
    ).toBeInTheDocument();

    const closeButtons = screen.getAllByRole("button", { name: /close/i });
    fireEvent.click(closeButtons[0]);

    await waitFor(() => {
      expect(screen.queryByText(/AUR Build Log: lib32-imlib2/i)).not.toBeInTheDocument();
    });
  });
});
