const minColumnWidth = 10;
const maxColumnWidth = 60;

// Saves a table as an .xlsx file from the browser: a bold header that stays in view, every cell
// as text (so a long ID is not rounded), and each column as wide as its longest cell.
export async function downloadExcel(fileName: string, header: readonly string[], rows: readonly (readonly string[])[]): Promise<void> {
  // Only loaded when something is actually exported.
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const columns = header.map((title, index) => {
    const longest = Math.max(title.length, ...rows.map((row) => Math.max(...(row[index] ?? "").split("\n").map((line) => line.length))));
    return { width: Math.min(maxColumnWidth, Math.max(minColumnWidth, longest + 2)) };
  });
  const sheetData = [
    header.map((value) => ({ value, type: String, fontWeight: "bold" as const })),
    // A cell longer than its column wraps instead of being cut off.
    ...rows.map((row) => row.map((value, index) => ({ value, type: String, wrap: value.length + 2 > (columns[index]?.width ?? maxColumnWidth) || value.includes("\n") }))),
  ];
  await writeExcelFile(sheetData, { columns, stickyRowsCount: 1 }).toFile(fileName);
}

// "Họp nhóm hằng tuần" → "hop-nhom-hang-tuan", for file names.
export function slug(text: string, maxLength = 40): string {
  const folded = text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/giu, "d").toLowerCase();
  return folded.replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, maxLength).replace(/-+$/u, "");
}
