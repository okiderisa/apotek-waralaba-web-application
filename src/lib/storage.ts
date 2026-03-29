import {
  type AppData,
  type Medicine,
  type Supplier,
  type User,
  uid,
  todayISO,
  addDaysISO,
  hashPassword,
} from "./models";

const KEY = "doors-pharmacy:data:v1";

export function loadData(): AppData {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as AppData;
      if (parsed?.version === 1) return parsed;
    } catch {
      // ignore
    }
  }
  const seeded = seedData();
  saveData(seeded);
  return seeded;
}

export function saveData(data: AppData) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function clearAllData() {
  localStorage.removeItem(KEY);
}

function seedData(): AppData {
  const now = Date.now();

  const admin: User = {
    id: uid("usr"),
    fullName: "Admin Doors Pharmacy",
    email: "admin@doorspharmacy.local",
    phone: "081234567890",
    passwordHash: hashPassword("admin123"),
    role: "Admin",
    createdAt: now,
  };

  const suppliers: Supplier[] = [
    {
      id: uid("sup"),
      name: "PT Sehat Sentosa (PBF)",
      address: "Jl. Kesehatan No. 10, Jakarta",
      contact: "+62 812-0000-1111",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid("sup"),
      name: "CV Farma Nusantara (PBF)",
      address: "Jl. Apoteker No. 21, Bandung",
      contact: "+62 811-2222-3333",
      createdAt: now,
      updatedAt: now,
    },
  ];

  const meds: Medicine[] = [
    {
      id: uid("med"),
      barcode: "899999000001",
      name: "Paracetamol 500mg",
      category: "OTC",
      batchNo: "BATCH-PCM-01",
      expiryDate: addDaysISO(todayISO(), 180),
      stock: 120,
      minStock: 25,
      buyPrice: 800,
      sellPrice: 1500,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid("med"),
      barcode: "899999000002",
      name: "Amoxicillin 500mg",
      category: "OKT",
      batchNo: "BATCH-AMX-03",
      expiryDate: addDaysISO(todayISO(), 90),
      stock: 40,
      minStock: 20,
      buyPrice: 1200,
      sellPrice: 2500,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid("med"),
      barcode: "899999000003",
      name: "Ibuprofen 400mg",
      category: "NSAID",
      batchNo: "BATCH-IBU-02",
      expiryDate: addDaysISO(todayISO(), 35),
      stock: 18,
      minStock: 20,
      buyPrice: 1100,
      sellPrice: 2200,
      createdAt: now,
      updatedAt: now,
    },
  ];

  return {
    version: 1,
    settings: {
      pharmacyName: "Doors Pharmacy",
      adminName: "Admin",
      themeBrandRgb: "16 185 129",
      themeAccentRgb: "59 130 246",
      layout: "Comfort",
      receiptFooter: "Terima kasih. Semoga lekas sembuh.",
      printer: {
        paper: "80mm",
        showLogo: true,
      },
    },
    users: [admin],
    session: null,
    passwordResets: [],
    medicines: meds,
    suppliers,
    purchases: [],
    sales: [],
    spOrders: [],
    shifts: [],
    auditLogs: [
      {
        id: uid("log"),
        at: now,
        userId: admin.id,
        action: "SEED_DATA",
        detail: "Initial seed created (admin/admin123).",
      },
    ],
  };
}
