import { type Medicine, type MedicineCategory, uid, todayISO } from "./models";

function escapeCell(v: string) {
  const s = String(v ?? "");
  if (/[\n\r",]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadText(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportMedicinesCSV(medicines: Medicine[]) {
  const headers = [
    "name",
    "category",
    "batchNo",
    "expiryDate",
    "stock",
    "minStock",
    "buyPrice",
    "sellPrice",
    "barcode",
  ];
  const rows = medicines.map((m) => [
    m.name,
    m.category,
    m.batchNo,
    m.expiryDate,
    String(m.stock),
    String(m.minStock),
    String(m.buyPrice),
    String(m.sellPrice),
    m.barcode ?? "",
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.map(escapeCell).join(","))].join("\n");
  downloadText(`stock-obat_${todayISO()}.csv`, csv, "text/csv");
}

// Very small CSV parser: handles commas, quotes, newlines.
export function parseCSV(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    // ignore empty trailing rows
    if (row.length === 1 && row[0] === "") {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      pushCell();
      continue;
    }

    if (ch === "\n") {
      pushCell();
      pushRow();
      continue;
    }

    if (ch === "\r") {
      continue;
    }

    cell += ch;
  }

  pushCell();
  pushRow();
  return rows;
}

const CAT: MedicineCategory[] = ["OTC", "OOT", "OKT", "NSAID", "Opioid", "Narkotika"];

export function importMedicinesFromCSV(text: string): { medicines: Medicine[]; warnings: string[] } {
  const rows = parseCSV(text);
  if (rows.length < 2) return { medicines: [], warnings: ["CSV kosong atau tidak valid."] };

  const header = rows[0].map((h) => h.trim());
  const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  const required = ["name", "category", "batchNo", "expiryDate", "stock", "buyPrice", "sellPrice"];
  const missing = required.filter((r) => idx(r) === -1);
  if (missing.length) {
    return { medicines: [], warnings: [`Kolom wajib tidak ditemukan: ${missing.join(", ")}`] };
  }

  const warnings: string[] = [];
  const now = Date.now();

  const medicines: Medicine[] = rows.slice(1).map((r, line) => {
    const get = (col: string) => r[idx(col)]?.trim?.() ?? "";
    const name = get("name");
    let category = get("category") as MedicineCategory;
    if (!CAT.includes(category)) {
      warnings.push(`Baris ${line + 2}: category '${category}' tidak dikenal. Menggunakan 'OTC'.`);
      category = "OTC";
    }
    const batchNo = get("batchNo");
    const expiryDate = get("expiryDate") || todayISO();
    const stock = Number(get("stock") || 0);
    const minStock = Number(get("minStock") || 0);
    const buyPrice = Number(get("buyPrice") || 0);
    const sellPrice = Number(get("sellPrice") || 0);
    const barcode = get("barcode") || undefined;

    return {
      id: uid("med"),
      name,
      category,
      batchNo,
      expiryDate,
      stock,
      minStock,
      buyPrice,
      sellPrice,
      barcode,
      createdAt: now,
      updatedAt: now,
    };
  });

  return { medicines, warnings };
}
