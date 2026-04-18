import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { ThemeProvider } from "../../src/theme/context.js";
import { DataTable, type ColumnDef } from "../../src/primitives/DataTable.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

interface Row {
  id: string;
  name: string;
  value: string;
}

const ROWS: Row[] = [
  { id: "1", name: "alpha", value: "100" },
  { id: "2", name: "bravo", value: "200" },
  { id: "3", name: "charlie", value: "300" },
];

const COLUMNS: ColumnDef<Row>[] = [
  { id: "name", header: "NAME", width: 10, render: (r) => r.name },
  { id: "value", header: "VALUE", width: 10, render: (r) => r.value },
];

function renderTable(props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  return render(
    <ThemeProvider>
      <DataTable<Row>
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        {...props}
      />
    </ThemeProvider>,
  );
}

describe("DataTable", () => {
  describe("header", () => {
    it("showHeader=true renders column headers", () => {
      const { lastFrame } = renderTable({ showHeader: true });
      const frame = stripAnsi(lastFrame() ?? "");
      expect(frame).toContain("NAME");
      expect(frame).toContain("VALUE");
    });

    it("showHeader=false hides headers", () => {
      const { lastFrame } = renderTable({ showHeader: false });
      const frame = stripAnsi(lastFrame() ?? "");
      expect(frame).not.toContain("NAME");
      expect(frame).not.toContain("VALUE");
      expect(frame).toContain("alpha");
    });
  });

  describe("cursor glyph", () => {
    it("cursorIndex=1 shows default glyph at that row", () => {
      const { lastFrame } = renderTable({ cursorIndex: 1 });
      const frame = stripAnsi(lastFrame() ?? "");
      expect(frame).toContain("›");
    });

    it("cursorIndex=-1 shows no glyph", () => {
      const { lastFrame } = renderTable({ cursorIndex: -1 });
      const frame = stripAnsi(lastFrame() ?? "");
      expect(frame).not.toContain("›");
    });

    it("custom cursorGlyph", () => {
      const { lastFrame } = renderTable({ cursorIndex: 0, cursorGlyph: "▶" });
      const frame = stripAnsi(lastFrame() ?? "");
      expect(frame).toContain("▶");
    });
  });

  describe("empty state", () => {
    it("rows=[] with emptyState renders it", () => {
      const { lastFrame } = renderTable({
        rows: [],
        emptyState: <Text>no data</Text>,
      });
      const frame = stripAnsi(lastFrame() ?? "");
      expect(frame).toContain("no data");
    });

    it("rows=[] without emptyState does not crash", () => {
      const { lastFrame } = renderTable({ rows: [] });
      expect(lastFrame()).toBeDefined();
    });
  });

  describe("renderCell", () => {
    it("column with renderCell uses ReactNode", () => {
      const columns: ColumnDef<Row>[] = [
        {
          id: "name",
          header: "NAME",
          width: 10,
          render: (r) => r.name,
          renderCell: (r) => <Text color="green">C{r.id}</Text>,
        },
      ];
      const { lastFrame } = renderTable({ columns });
      const frame = stripAnsi(lastFrame() ?? "");
      expect(frame).toContain("C1");
    });
  });

  describe("windowed rendering", () => {
    it("height limits visible rows", () => {
      const rows: Row[] = Array.from({ length: 5 }, (_, i) => ({
        id: String(i),
        name: `row${i}`,
        value: String(i),
      }));
      const { lastFrame } = renderTable({ rows, height: 4, cursorIndex: 0 });
      const frame = stripAnsi(lastFrame() ?? "");
      expect(frame).toContain("row0");
      expect(frame).not.toContain("row4");
    });

    it("height=undefined shows all rows", () => {
      const { lastFrame } = renderTable({});
      const frame = stripAnsi(lastFrame() ?? "");
      expect(frame).toContain("alpha");
      expect(frame).toContain("bravo");
      expect(frame).toContain("charlie");
    });
  });
});
