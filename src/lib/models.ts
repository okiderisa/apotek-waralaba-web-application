export type Role = "Admin" | "Apoteker" | "Kasir";

export type MedicineCategory =
  | "OTC"
  | "OOT"
  | "OKT"
  | "NSAID"
  | "Opioid"
  | "Narkotika";

export type Medicine = {
  id: string;
  barcode?: string;
  name: string;
  category: MedicineCategory;
  batchNo: string;
  expiryDate: string; // YYYY-MM-DD
  stock: number;
  minStock: number;
  buyPrice: number;
  sellPrice: number;
  createdAt: number;
  updatedAt: number;
};

export type Supplier = {
  id: string;
  name: string;
  address: string;
  contact: string;
  createdAt: number;
  updatedAt: number;
};

export type Purchase = {
  id: string;
  date: string; // YYYY-MM-DD
  supplierId: string;
  invoiceNo: string;
  medicineId: string;
  batchNo: string;
  quantity: number;
  unitPrice: number;
  ppnPercent: number;
  category: MedicineCategory;
  total: number;
  createdAt: number;
};

export type Sale = {
  id: string;
  date: string; // YYYY-MM-DD
  customerName: string;
  prescriptionCount: number;
  doctorName: string;
  prescriptionPrice: number;
  medicineId: string;
  category: MedicineCategory;
  quantity: number;
  unitPrice: number;
  total: number;
  createdAt: number;
};

export type SPItem = {
  medicineName: string;
  category: MedicineCategory;
  quantity: number;
};

export type SPOrder = {
  id: string;
  spNumber: string;
  date: string;
  supplierId: string;
  items: SPItem[];
  totalItems: number;
  createdAt: number;
};

export type Shift = {
  id: string;
  psaName: string;
  apjName: string;
  ttkName: string;
  schedule: string; // free text / JSON-lite
  sipaValidUntil: string; // YYYY-MM-DD
  siaPermit: string;
  createdAt: number;
  updatedAt: number;
};

export type Settings = {
  pharmacyName: string;
  adminName: string;
  themeBrandRgb: string; // e.g. "16 185 129"
  themeAccentRgb: string; // e.g. "59 130 246"
  layout: "Compact" | "Comfort";
  receiptFooter: string;
  printer: {
    paper: "58mm" | "80mm" | "A4";
    showLogo: boolean;
  };
};

export type User = {
  id: string;
  fullName: string;
  email?: string;
  phone?: string;
  passwordHash: string;
  role: Role;
  createdAt: number;
};

export type PasswordReset = {
  id: string;
  identifier: string; // email / phone
  otp: string;
  expiresAt: number;
  createdAt: number;
};

export type AuditLog = {
  id: string;
  at: number;
  userId?: string;
  action: string;
  entity?: string;
  entityId?: string;
  detail?: string;
};

export type AppData = {
  version: 1;
  settings: Settings;
  users: User[];
  session: { userId: string } | null;
  passwordResets: PasswordReset[];
  medicines: Medicine[];
  suppliers: Supplier[];
  purchases: Purchase[];
  sales: Sale[];
  spOrders: SPOrder[];
  shifts: Shift[];
  auditLogs: AuditLog[];
};

export function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export function todayISO(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function addDaysISO(iso: string, days: number) {
  const dt = new Date(iso + "T00:00:00");
  dt.setDate(dt.getDate() + days);
  return todayISO(dt);
}

export function parseISODate(iso: string) {
  // Interpret as local date.
  const dt = new Date(iso + "T00:00:00");
  return dt;
}

export function formatIDR(amount: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export function hashPassword(pw: string) {
  // Lightweight demo hash (not for production). Keeps build dependency-free.
  let h = 2166136261;
  for (let i = 0; i < pw.length; i++) {
    h ^= pw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv1a_${(h >>> 0).toString(16)}`;
}

export function isEmail(v: string) {
  return /.+@.+\..+/.test(v);
}

export function onlyDigits(v: string) {
  return v.replace(/\D+/g, "");
}

export function startOfWeekISO(iso: string) {
  const d = parseISODate(iso);
  const day = d.getDay(); // 0 Sun..6
  const diff = (day === 0 ? -6 : 1) - day; // Monday as start
  d.setDate(d.getDate() + diff);
  return todayISO(d);
}

export function endOfWeekISO(iso: string) {
  const start = parseISODate(startOfWeekISO(iso));
  start.setDate(start.getDate() + 6);
  return todayISO(start);
}

export function monthKey(iso: string) {
  return iso.slice(0, 7); // YYYY-MM
}
