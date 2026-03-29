import React, { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "./utils/cn";
import {
  type AppData,
  type AuditLog,
  type Medicine,
  type MedicineCategory,
  type Purchase,
  type Role,
  type Sale,
  type Settings,
  type Shift,
  type SPOrder,
  type Supplier,
  type User,
  addDaysISO,
  endOfWeekISO,
  formatIDR,
  hashPassword,
  isEmail,
  monthKey,
  onlyDigits,
  startOfWeekISO,
  todayISO,
  uid,
} from "./lib/models";
import { loadData, saveData, clearAllData } from "./lib/storage";
import { exportMedicinesCSV, importMedicinesFromCSV } from "./lib/csv";
import { printHtml } from "./lib/print";

type Route =
  | { kind: "landing" }
  | { kind: "login" }
  | { kind: "register" }
  | { kind: "forgot" }
  | { kind: "reset" }
  | { kind: "app"; page: AppPage };

type AppPage =
  | "dashboard"
  | "stock"
  | "pembelian"
  | "penjualan"
  | "administrasi"
  | "laporan"
  | "keuangan"
  | "supplier"
  | "settings"
  | "shift"
  | "info"
  | "audit";

function parseHashRoute(): Route {
  const hash = (location.hash || "").replace(/^#/, "");
  const path = hash.startsWith("/") ? hash : `/${hash}`;

  if (path === "/" || path === "//" || path === "") return { kind: "landing" };
  if (path.startsWith("/login")) return { kind: "login" };
  if (path.startsWith("/register")) return { kind: "register" };
  if (path.startsWith("/forgot")) return { kind: "forgot" };
  if (path.startsWith("/reset")) return { kind: "reset" };

  if (path.startsWith("/app")) {
    const parts = path.split("/").filter(Boolean);
    const page = (parts[1] || "dashboard") as AppPage;
    const allowed: AppPage[] = [
      "dashboard",
      "stock",
      "pembelian",
      "penjualan",
      "administrasi",
      "laporan",
      "keuangan",
      "supplier",
      "settings",
      "shift",
      "info",
      "audit",
    ];
    return { kind: "app", page: allowed.includes(page) ? page : "dashboard" };
  }

  return { kind: "landing" };
}

function nav(to: string) {
  location.hash = to.startsWith("#") ? to : `#${to}`;
}

function useHashRoute() {
  const [route, setRoute] = useState<Route>(() => parseHashRoute());
  useEffect(() => {
    const onChange = () => setRoute(parseHashRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function fmtDateHuman(iso: string) {
  try {
    return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(
      new Date(iso + "T00:00:00")
    );
  } catch {
    return iso;
  }
}

type Toast = { id: string; type: "success" | "error" | "info"; title: string; detail?: string };

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = (t: Omit<Toast, "id">) => {
    const id = uid("toast");
    setToasts((prev) => [...prev, { id, ...t }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 3800);
  };
  return { toasts, push };
}

function applyTheme(settings: Settings) {
  const root = document.documentElement;
  root.style.setProperty("--brand", settings.themeBrandRgb);
  root.style.setProperty("--brand-2", settings.themeAccentRgb);
}

function categorizeEthical(cat: MedicineCategory) {
  return cat !== "OTC";
}

function sum(nums: number[]) {
  return nums.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}

function safeNum(v: unknown, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export default function App() {
  const route = useHashRoute();
  const { toasts, push } = useToasts();

  const [data, setData] = useState<AppData>(() => {
    const d = loadData();
    return d;
  });

  useEffect(() => {
    applyTheme(data.settings);
  }, [data.settings]);

  useEffect(() => {
    saveData(data);
  }, [data]);

  const me = useMemo(() => {
    if (!data.session) return null;
    return data.users.find((u) => u.id === data.session?.userId) ?? null;
  }, [data.session, data.users]);

  const actions = useMemo(() => {
    const log = (entry: Omit<AuditLog, "id" | "at">) => {
      setData((prev) => ({
        ...prev,
        auditLogs: [
          { id: uid("log"), at: Date.now(), ...entry },
          ...prev.auditLogs,
        ].slice(0, 500),
      }));
    };

    const setSettings = (patch: Partial<Settings>) => {
      setData((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
      log({ userId: prevSessionUserId(), action: "UPDATE_SETTINGS" });
    };

    const prevSessionUserId = () => (data.session ? data.session.userId : undefined);

    const login = (identifier: string, password: string) => {
      const idf = identifier.trim().toLowerCase();
      const pwHash = hashPassword(password);

      const user = data.users.find((u) => {
        const email = (u.email || "").toLowerCase();
        const phone = onlyDigits(u.phone || "");
        const cmpPhone = onlyDigits(idf);
        return email === idf || phone === cmpPhone;
      });

      if (!user || user.passwordHash !== pwHash) {
        push({
          type: "error",
          title: "Login gagal",
          detail: "Periksa kembali email/no. HP dan password.",
        });
        log({ action: "LOGIN_FAILED", detail: `identifier=${identifier}` });
        return false;
      }

      setData((prev) => ({ ...prev, session: { userId: user.id } }));
      push({ type: "success", title: `Selamat datang, ${user.fullName}!` });
      log({ userId: user.id, action: "LOGIN" });
      nav("/app/dashboard");
      return true;
    };

    const logout = () => {
      const userId = prevSessionUserId();
      setData((prev) => ({ ...prev, session: null }));
      push({ type: "info", title: "Anda telah logout." });
      log({ userId, action: "LOGOUT" });
      nav("/");
    };

    const register = (p: { fullName: string; identifier: string; password: string; role?: Role }) => {
      const identifier = p.identifier.trim();
      if (!identifier) {
        push({ type: "error", title: "Email / No. HP wajib diisi." });
        return false;
      }

      const email = isEmail(identifier) ? identifier.toLowerCase() : undefined;
      const phone = !isEmail(identifier) ? onlyDigits(identifier) : undefined;

      const exists = data.users.some((u) => {
        if (email && u.email?.toLowerCase() === email) return true;
        if (phone && onlyDigits(u.phone || "") === phone) return true;
        return false;
      });
      if (exists) {
        push({ type: "error", title: "Akun sudah terdaftar." });
        return false;
      }

      const user: User = {
        id: uid("usr"),
        fullName: p.fullName.trim() || "Pengguna",
        email,
        phone,
        passwordHash: hashPassword(p.password),
        role: p.role ?? "Kasir",
        createdAt: Date.now(),
      };

      setData((prev) => ({ ...prev, users: [user, ...prev.users] }));
      push({ type: "success", title: "Pendaftaran berhasil", detail: "Silakan login." });
      log({ userId: user.id, action: "REGISTER" });
      nav("/login");
      return true;
    };

    const requestReset = (identifier: string, channel: "Email" | "WhatsApp") => {
      const idf = identifier.trim().toLowerCase();
      const user = data.users.find((u) => {
        const email = (u.email || "").toLowerCase();
        const phone = onlyDigits(u.phone || "");
        const cmpPhone = onlyDigits(idf);
        return email === idf || phone === cmpPhone;
      });

      if (!user) {
        push({ type: "error", title: "Akun tidak ditemukan" });
        return { ok: false as const };
      }

      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const reset = {
        id: uid("rst"),
        identifier: idf,
        otp,
        createdAt: Date.now(),
        expiresAt: Date.now() + 10 * 60 * 1000,
      };

      setData((prev) => ({
        ...prev,
        passwordResets: [reset, ...prev.passwordResets].slice(0, 20),
      }));

      // Demo only: show OTP to user.
      push({
        type: "info",
        title: `OTP terkirim via ${channel}`,
        detail: `Kode OTP (demo): ${otp} (berlaku 10 menit)`,
      });

      if (channel === "WhatsApp") {
        const msg = encodeURIComponent(`OTP reset password Doors Pharmacy System: ${otp}`);
        const phone = onlyDigits(user.phone || "") || "";
        const url = phone ? `https://wa.me/${phone}?text=${msg}` : `https://wa.me/?text=${msg}`;
        window.open(url, "_blank", "noopener,noreferrer");
      }

      log({ userId: user.id, action: "REQUEST_PASSWORD_RESET", detail: channel });
      nav("/reset");
      return { ok: true as const };
    };

    const confirmReset = (identifier: string, otp: string, newPassword: string) => {
      const idf = identifier.trim().toLowerCase();
      const match = data.passwordResets.find((r) => r.identifier === idf && r.otp === otp);
      if (!match) {
        push({ type: "error", title: "OTP salah atau tidak ditemukan" });
        return false;
      }
      if (Date.now() > match.expiresAt) {
        push({ type: "error", title: "OTP sudah kedaluwarsa" });
        return false;
      }

      const userIdx = data.users.findIndex((u) => {
        const email = (u.email || "").toLowerCase();
        const phone = onlyDigits(u.phone || "");
        const cmpPhone = onlyDigits(idf);
        return email === idf || phone === cmpPhone;
      });
      if (userIdx === -1) {
        push({ type: "error", title: "Akun tidak ditemukan" });
        return false;
      }

      setData((prev) => {
        const users = [...prev.users];
        users[userIdx] = { ...users[userIdx], passwordHash: hashPassword(newPassword) };
        return {
          ...prev,
          users,
          passwordResets: prev.passwordResets.filter((r) => r.id !== match.id),
        };
      });

      push({ type: "success", title: "Password berhasil direset", detail: "Silakan login." });
      log({ userId: data.users[userIdx]?.id, action: "RESET_PASSWORD" });
      nav("/login");
      return true;
    };

    const upsertMedicine = (m: Omit<Medicine, "createdAt" | "updatedAt" | "id"> & { id?: string }) => {
      const now = Date.now();
      setData((prev) => {
        if (m.id) {
          const medicines = prev.medicines.map((x) =>
            x.id === m.id
              ? {
                  ...x,
                  ...m,
                  stock: safeNum(m.stock, x.stock),
                  minStock: safeNum(m.minStock, x.minStock),
                  buyPrice: safeNum(m.buyPrice, x.buyPrice),
                  sellPrice: safeNum(m.sellPrice, x.sellPrice),
                  updatedAt: now,
                }
              : x
          );
          return { ...prev, medicines };
        }
        const med: Medicine = {
          id: uid("med"),
          createdAt: now,
          updatedAt: now,
          ...m,
          stock: safeNum(m.stock, 0),
          minStock: safeNum(m.minStock, 0),
          buyPrice: safeNum(m.buyPrice, 0),
          sellPrice: safeNum(m.sellPrice, 0),
        };
        return { ...prev, medicines: [med, ...prev.medicines] };
      });
      log({ userId: prevSessionUserId(), action: "UPSERT_MEDICINE", entity: "Medicine", entityId: m.id });
      push({ type: "success", title: "Data obat tersimpan" });
    };

    const deleteMedicine = (id: string) => {
      setData((prev) => ({ ...prev, medicines: prev.medicines.filter((m) => m.id !== id) }));
      log({ userId: prevSessionUserId(), action: "DELETE_MEDICINE", entity: "Medicine", entityId: id });
      push({ type: "info", title: "Obat dihapus" });
    };

    const addPurchase = (p: Omit<Purchase, "id" | "createdAt" | "total">) => {
      const total = Math.round(p.quantity * p.unitPrice * (1 + p.ppnPercent / 100));
      const purchase: Purchase = { id: uid("pur"), createdAt: Date.now(), total, ...p };
      setData((prev) => {
        const medicines = prev.medicines.map((m) => {
          if (m.id !== p.medicineId) return m;
          return {
            ...m,
            stock: m.stock + p.quantity,
            batchNo: p.batchNo || m.batchNo,
            updatedAt: Date.now(),
          };
        });
        return { ...prev, purchases: [purchase, ...prev.purchases], medicines };
      });
      log({ userId: prevSessionUserId(), action: "ADD_PURCHASE", entity: "Purchase", entityId: purchase.id });
      push({ type: "success", title: "Transaksi pembelian tersimpan" });
      return purchase;
    };

    const addSale = (s: Omit<Sale, "id" | "createdAt" | "total">) => {
      const total =
        Math.round(s.quantity * s.unitPrice + s.prescriptionCount * s.prescriptionPrice);
      const sale: Sale = { id: uid("sal"), createdAt: Date.now(), total, ...s };

      // Validate stock
      const med = data.medicines.find((m) => m.id === s.medicineId);
      if (!med) {
        push({ type: "error", title: "Obat tidak ditemukan" });
        return { ok: false as const };
      }
      if (med.stock < s.quantity) {
        push({
          type: "error",
          title: "Stok tidak mencukupi",
          detail: `Stok tersedia: ${med.stock}`,
        });
        return { ok: false as const };
      }

      setData((prev) => {
        const medicines = prev.medicines.map((m) =>
          m.id === s.medicineId
            ? { ...m, stock: m.stock - s.quantity, updatedAt: Date.now() }
            : m
        );
        return { ...prev, sales: [sale, ...prev.sales], medicines };
      });

      log({ userId: prevSessionUserId(), action: "ADD_SALE", entity: "Sale", entityId: sale.id });
      push({ type: "success", title: "Transaksi penjualan tersimpan" });
      return { ok: true as const, sale };
    };

    const upsertSupplier = (s: Omit<Supplier, "createdAt" | "updatedAt" | "id"> & { id?: string }) => {
      const now = Date.now();
      setData((prev) => {
        if (s.id) {
          const suppliers = prev.suppliers.map((x) =>
            x.id === s.id ? { ...x, ...s, updatedAt: now } : x
          );
          return { ...prev, suppliers };
        }
        const sup: Supplier = {
          id: uid("sup"),
          createdAt: now,
          updatedAt: now,
          ...s,
        };
        return { ...prev, suppliers: [sup, ...prev.suppliers] };
      });
      log({ userId: prevSessionUserId(), action: "UPSERT_SUPPLIER", entity: "Supplier", entityId: s.id });
      push({ type: "success", title: "Supplier tersimpan" });
    };

    const deleteSupplier = (id: string) => {
      setData((prev) => ({ ...prev, suppliers: prev.suppliers.filter((s) => s.id !== id) }));
      log({ userId: prevSessionUserId(), action: "DELETE_SUPPLIER", entity: "Supplier", entityId: id });
      push({ type: "info", title: "Supplier dihapus" });
    };

    const addSPOrder = (p: { date: string; supplierId: string; items: { medicineName: string; category: MedicineCategory; quantity: number }[] }) => {
      const date = p.date;
      const ymd = date.split("-").join("");
      const sameDay = data.spOrders.filter((o) => o.date === date).length;
      const spNumber = `SP-${ymd}-${String(sameDay + 1).padStart(4, "0")}`;
      const totalItems = sum(p.items.map((i) => i.quantity));
      const order: SPOrder = {
        id: uid("sp"),
        spNumber,
        date,
        supplierId: p.supplierId,
        items: p.items,
        totalItems,
        createdAt: Date.now(),
      };
      setData((prev) => ({ ...prev, spOrders: [order, ...prev.spOrders] }));
      log({ userId: prevSessionUserId(), action: "ADD_SP", entity: "SPOrder", entityId: order.id });
      push({ type: "success", title: "Surat Pesanan tersimpan" });
      return order;
    };

    const upsertShift = (s: Omit<Shift, "createdAt" | "updatedAt" | "id"> & { id?: string }) => {
      const now = Date.now();
      setData((prev) => {
        if (s.id) {
          const shifts = prev.shifts.map((x) => (x.id === s.id ? { ...x, ...s, updatedAt: now } : x));
          return { ...prev, shifts };
        }
        const shift: Shift = { id: uid("shf"), createdAt: now, updatedAt: now, ...s };
        return { ...prev, shifts: [shift, ...prev.shifts] };
      });
      log({ userId: prevSessionUserId(), action: "UPSERT_SHIFT", entity: "Shift", entityId: s.id });
      push({ type: "success", title: "Shift tersimpan" });
    };

    const deleteShift = (id: string) => {
      setData((prev) => ({ ...prev, shifts: prev.shifts.filter((s) => s.id !== id) }));
      log({ userId: prevSessionUserId(), action: "DELETE_SHIFT", entity: "Shift", entityId: id });
      push({ type: "info", title: "Shift dihapus" });
    };

    const backupJSON = () => {
      const payload = JSON.stringify(data, null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `doors-pharmacy_backup_${todayISO()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      log({ userId: prevSessionUserId(), action: "BACKUP_EXPORT" });
      push({ type: "success", title: "Backup diexport" });
    };

    const restoreJSON = async (file: File) => {
      const txt = await file.text();
      try {
        const parsed = JSON.parse(txt) as AppData;
        if (!parsed || parsed.version !== 1) throw new Error("Format tidak didukung");
        setData(parsed);
        push({ type: "success", title: "Backup berhasil dipulihkan" });
        log({ userId: prevSessionUserId(), action: "BACKUP_RESTORE" });
      } catch (e) {
        push({ type: "error", title: "Gagal restore", detail: String(e) });
      }
    };

    const factoryReset = () => {
      clearAllData();
      const d = loadData();
      setData(d);
      push({ type: "info", title: "Data direset ke kondisi awal (seed)." });
      nav("/");
    };

    return {
      login,
      logout,
      register,
      requestReset,
      confirmReset,
      setSettings,
      upsertMedicine,
      deleteMedicine,
      addPurchase,
      addSale,
      upsertSupplier,
      deleteSupplier,
      addSPOrder,
      upsertShift,
      deleteShift,
      backupJSON,
      restoreJSON,
      factoryReset,
      log,
    };
  }, [data, push]);

  const computed = useMemo(() => {
    const totalStock = sum(data.medicines.map((m) => m.stock));
    const today = todayISO();
    const salesToday = sum(data.sales.filter((s) => s.date === today).map((s) => s.total));
    const purchasesToday = sum(
      data.purchases.filter((p) => p.date === today).map((p) => p.total)
    );

    const lowStock = data.medicines
      .filter((m) => m.stock <= (m.minStock ?? 0))
      .sort((a, b) => a.stock - b.stock);

    const expiringSoon = data.medicines
      .filter((m) => m.expiryDate <= addDaysISO(today, 30))
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

    const last7 = Array.from({ length: 7 }, (_, i) => {
      const d = addDaysISO(today, -6 + i);
      const total = sum(data.sales.filter((s) => s.date === d).map((s) => s.total));
      return { date: d, total };
    });

    return { totalStock, salesToday, purchasesToday, lowStock, expiringSoon, last7 };
  }, [data.medicines, data.sales, data.purchases]);

  // Guard: if user enters /app without session
  useEffect(() => {
    if (route.kind === "app" && !me) nav("/login");
  }, [route.kind, me]);

  return (
    <div className="min-h-screen">
      <ToastViewport toasts={toasts} />

      {route.kind !== "app" ? (
        <PublicShell settings={data.settings}>
          {route.kind === "landing" && (
            <Landing
              settings={data.settings}
              onLogin={() => nav("/login")}
              onRegister={() => nav("/register")}
            />
          )}
          {route.kind === "login" && (
            <LoginPage
              settings={data.settings}
              onLogin={(i, p) => actions.login(i, p)}
              onGoRegister={() => nav("/register")}
              onForgot={() => nav("/forgot")}
            />
          )}
          {route.kind === "register" && (
            <RegisterPage
              onRegister={(p) => actions.register(p)}
              onGoLogin={() => nav("/login")}
            />
          )}
          {route.kind === "forgot" && (
            <ForgotPage
              onRequest={(idf, ch) => actions.requestReset(idf, ch)}
              onGoLogin={() => nav("/login")}
            />
          )}
          {route.kind === "reset" && (
            <ResetPage
              onConfirm={(idf, otp, pw) => actions.confirmReset(idf, otp, pw)}
              onGoLogin={() => nav("/login")}
            />
          )}
        </PublicShell>
      ) : (
        <AppShell
          me={me}
          settings={data.settings}
          lowStockCount={computed.lowStock.length}
          expiringCount={computed.expiringSoon.length}
          page={route.page}
          onNavigate={(p) => nav(`/app/${p}`)}
          onLogout={() => actions.logout()}
        >
          {route.page === "dashboard" && (
            <DashboardPage
              settings={data.settings}
              stats={computed}
              sales={data.sales}
              purchases={data.purchases}
              medicines={data.medicines}
              onGoStock={() => nav("/app/stock")}
              onGoSales={() => nav("/app/penjualan")}
              onGoPurchases={() => nav("/app/pembelian")}
            />
          )}
          {route.page === "stock" && (
            <StockPage
              medicines={data.medicines}
              onUpsert={actions.upsertMedicine}
              onDelete={actions.deleteMedicine}
              onExport={() => exportMedicinesCSV(data.medicines)}
              onImport={async (file) => {
                const text = await file.text();
                const { medicines, warnings } = importMedicinesFromCSV(text);
                if (warnings.length) {
                  push({ type: "info", title: "Import selesai (peringatan)", detail: warnings[0] });
                }
                if (medicines.length) {
                  setData((prev) => ({ ...prev, medicines: [...medicines, ...prev.medicines] }));
                  actions.log({ userId: data.session?.userId, action: "IMPORT_MEDICINES", detail: `${medicines.length} row(s)` });
                  push({ type: "success", title: "Import berhasil", detail: `${medicines.length} obat ditambahkan.` });
                }
              }}
            />
          )}
          {route.page === "pembelian" && (
            <PurchasesPage
              medicines={data.medicines}
              suppliers={data.suppliers}
              purchases={data.purchases}
              onSave={(p) => actions.addPurchase(p)}
            />
          )}
          {route.page === "penjualan" && (
            <SalesPage
              settings={data.settings}
              medicines={data.medicines}
              sales={data.sales}
              onSave={(s) => actions.addSale(s)}
            />
          )}
          {route.page === "administrasi" && (
            <AdministrasiPage
              settings={data.settings}
              suppliers={data.suppliers}
              spOrders={data.spOrders}
              onSave={(p) => actions.addSPOrder(p)}
            />
          )}
          {route.page === "laporan" && (
            <LaporanPage
              sales={data.sales}
              purchases={data.purchases}
            />
          )}
          {route.page === "keuangan" && (
            <KeuanganPage sales={data.sales} purchases={data.purchases} />
          )}
          {route.page === "supplier" && (
            <SupplierPage
              suppliers={data.suppliers}
              purchases={data.purchases}
              onUpsert={actions.upsertSupplier}
              onDelete={actions.deleteSupplier}
            />
          )}
          {route.page === "settings" && (
            <SettingsPage
              settings={data.settings}
              me={me}
              onUpdate={actions.setSettings}
              onBackup={actions.backupJSON}
              onRestore={actions.restoreJSON}
              onFactoryReset={actions.factoryReset}
            />
          )}
          {route.page === "shift" && (
            <ShiftPage shifts={data.shifts} onUpsert={actions.upsertShift} onDelete={actions.deleteShift} />
          )}
          {route.page === "info" && <InfoPage settings={data.settings} />}
          {route.page === "audit" && (
            <AuditPage logs={data.auditLogs} users={data.users} />
          )}
        </AppShell>
      )}
    </div>
  );
}

function PublicShell({
  children,
  settings,
}: {
  children: React.ReactNode;
  settings: Settings;
}) {
  return (
    <div className="relative">
      <div className="absolute inset-0 -z-10">
        <div className="h-full w-full bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.20),transparent_55%),radial-gradient(ellipse_at_bottom,rgba(59,130,246,0.14),transparent_55%)]" />
      </div>

      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <Brand settings={settings} subtitle="System" />
        <div className="flex items-center gap-2">
          <a
            href="#/login"
            className="rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-white/70"
          >
            Login
          </a>
          <a
            href="#/register"
            className="rounded-xl bg-[rgb(var(--brand))] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-95"
          >
            Daftar
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16">{children}</main>

      <footer className="border-t border-slate-200/60 bg-white/40">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
          <div>© {new Date().getFullYear()} {settings.pharmacyName}. Semua hak dilindungi.</div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-white px-3 py-1 shadow-sm">Modern • Responsive • Offline-ready</span>
            <span className="rounded-full bg-white px-3 py-1 shadow-sm">Demo lokal (LocalStorage)</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Brand({ settings, subtitle }: { settings: Settings; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-10 w-10 place-items-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <Logo />
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold text-slate-900">
          {settings.pharmacyName}
        </div>
        <div className="text-xs text-slate-600">Doors Pharmacy {subtitle ?? ""}</div>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="rgb(var(--brand))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20" />
      <path d="M2 12h20" />
      <path d="M7 7h10v10H7z" opacity="0.15" fill="rgb(var(--brand))" stroke="none" />
    </svg>
  );
}

function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-white/80 p-5 shadow-sm ring-1 ring-slate-200/70 backdrop-blur",
        className
      )}
    >
      {children}
    </div>
  );
}

function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  type,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition focus:outline-none focus:ring-2 focus:ring-[rgb(var(--ring))] focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed";
  const sizes = {
    sm: "px-3 py-2 text-sm",
    md: "px-4 py-2.5 text-sm",
  }[size];
  const variants = {
    primary: "bg-[rgb(var(--brand))] text-white shadow-sm hover:opacity-95",
    secondary: "bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50",
    ghost: "text-slate-700 hover:bg-white",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
  }[variant];
  return (
    <button type={type ?? "button"} disabled={disabled} onClick={onClick} className={cn(base, sizes, variants)}>
      {children}
    </button>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  right,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  right?: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-700">
        <span>{label}</span>
        {right}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-slate-200 outline-none transition focus:ring-2 focus:ring-[rgb(var(--ring))]"
      />
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  hint?: string;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-semibold text-slate-700">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-slate-200 outline-none transition focus:ring-2 focus:ring-[rgb(var(--ring))]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </label>
  );
}

function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "emerald" | "amber" | "rose" | "blue" }) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    rose: "bg-rose-50 text-rose-700 ring-rose-200",
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1", tones[tone])}>
      {children}
    </span>
  );
}

function Modal({
  open,
  title,
  children,
  onClose,
  footer,
  size = "md",
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  if (!open) return null;
  const w = { sm: "max-w-md", md: "max-w-2xl", lg: "max-w-4xl" }[size];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onMouseDown={onClose}>
      <div className={cn("w-full rounded-2xl bg-white shadow-xl ring-1 ring-slate-200", w)} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="text-sm font-bold text-slate-900">{title}</div>
          <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" onClick={onClose}>
            <XIcon />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">{footer}</div> : null}
      </div>
    </div>
  );
}

function ToastViewport({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed right-4 top-4 z-[60] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((t) => {
        const tone =
          t.type === "success"
            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : t.type === "error"
              ? "border-rose-200 bg-rose-50 text-rose-900"
              : "border-slate-200 bg-white text-slate-900";
        return (
          <div key={t.id} className={cn("rounded-2xl border p-3 shadow-sm", tone)}>
            <div className="text-sm font-bold">{t.title}</div>
            {t.detail ? <div className="mt-1 text-sm opacity-80">{t.detail}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

function Landing({
  settings,
  onLogin,
  onRegister,
}: {
  settings: Settings;
  onLogin: () => void;
  onRegister: () => void;
}) {
  return (
    <div className="grid gap-6 pt-10 md:grid-cols-2 md:items-center">
      <div className="space-y-5">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
          <span className="h-2 w-2 rounded-full bg-[rgb(var(--brand))]" />
          Aplikasi manajemen apotek berbasis web
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 md:text-5xl">
          {settings.pharmacyName}
          <span className="block text-transparent bg-clip-text bg-gradient-to-r from-[rgb(var(--brand))] to-[rgb(var(--brand-2))]">
            Doors Pharmacy System
          </span>
        </h1>
        <p className="text-slate-600">
          Kelola stok obat, pembelian, penjualan, administrasi, hingga laporan keuangan —
          cepat, rapi, dan siap digunakan di perangkat desktop maupun mobile.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={onRegister}>
            Daftar
            <ArrowRightIcon />
          </Button>
          <Button variant="secondary" onClick={onLogin}>
            Login
          </Button>
          <a
            href="#/login"
            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-white/70"
          >
            Lihat demo akun
            <Badge tone="blue">admin / admin123</Badge>
          </a>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <MiniFeature title="Notifikasi" desc="Stok minimum & kadaluarsa" />
          <MiniFeature title="Multi-user" desc="Admin • Apoteker • Kasir" />
          <MiniFeature title="Export" desc="CSV + Print (PDF via print)" />
        </div>
      </div>

      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-bold text-slate-900">Ringkasan Sistem</div>
            <div className="mt-1 text-sm text-slate-600">
              Contoh modul utama yang tersedia.
            </div>
          </div>
          <div className="rounded-2xl bg-[rgba(16,185,129,0.10)] p-3">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="rgb(var(--brand))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h18" />
              <path d="M12 3v18" />
              <path d="M7 7h10v10H7z" opacity="0.2" fill="rgb(var(--brand))" stroke="none" />
            </svg>
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          <FeatureRow title="Stock Obat" desc="CRUD + import/export CSV + barcode" />
          <FeatureRow title="Pembelian" desc="Transaksi obat masuk + riwayat" />
          <FeatureRow title="Penjualan" desc="Barang keluar + cetak struk" />
          <FeatureRow title="Administrasi" desc="Surat Pesanan (SP) + print" />
          <FeatureRow title="Laporan" desc="Harian/mingguan/bulanan + export" />
          <FeatureRow title="Keuangan" desc="Neraca & laba/rugi (ringkas)" />
        </div>
      </Card>

      <Card className="md:col-span-2">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <div className="text-sm font-bold text-slate-900">UX & Desain</div>
            <div className="mt-1 text-sm text-slate-600">Clean, modern, dominan hijau–biru, navigasi sidebar + topbar.</div>
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900">Keamanan (Demo)</div>
            <div className="mt-1 text-sm text-slate-600">Autentikasi lokal untuk demo. Siap diintegrasikan ke API REST.</div>
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900">Offline-ready</div>
            <div className="mt-1 text-sm text-slate-600">Data disimpan di LocalStorage (untuk prototipe).</div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function MiniFeature({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-2xl bg-white/70 p-4 ring-1 ring-slate-200">
      <div className="text-sm font-bold text-slate-900">{title}</div>
      <div className="mt-1 text-sm text-slate-600">{desc}</div>
    </div>
  );
}

function FeatureRow({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
      <div>
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="text-sm text-slate-600">{desc}</div>
      </div>
      <div className="rounded-full bg-slate-100 p-2 text-slate-700">
        <ArrowRightIcon />
      </div>
    </div>
  );
}

function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto mt-8 max-w-xl">
      <Card className="p-6">
        <div>
          <div className="text-lg font-extrabold text-slate-900">{title}</div>
          <div className="mt-1 text-sm text-slate-600">{subtitle}</div>
        </div>
        <div className="mt-5">{children}</div>
      </Card>
    </div>
  );
}

function LoginPage({
  settings,
  onLogin,
  onGoRegister,
  onForgot,
}: {
  settings: Settings;
  onLogin: (identifier: string, password: string) => void;
  onGoRegister: () => void;
  onForgot: () => void;
}) {
  const [identifier, setIdentifier] = useState("admin@doorspharmacy.local");
  const [password, setPassword] = useState("admin123");

  return (
    <AuthCard title="Login" subtitle="Masuk untuk mengelola operasional apotek Anda.">
      <div className="grid gap-3">
        <Input label="Username / Email / No. HP" value={identifier} onChange={setIdentifier} placeholder="contoh: admin@... / 08xxxx" />
        <Input label="Password" type="password" value={password} onChange={setPassword} placeholder="••••••••" right={
          <button className="text-xs font-semibold text-[rgb(var(--brand-2))] hover:underline" type="button" onClick={onForgot}>
            Lupa password?
          </button>
        } />
        <Button onClick={() => onLogin(identifier, password)}>
          Login
          <ArrowRightIcon />
        </Button>
        <div className="flex items-center justify-between text-sm">
          <div className="text-slate-600">
            Belum punya akun?
            <button className="ml-2 font-semibold text-[rgb(var(--brand-2))] hover:underline" onClick={onGoRegister}>
              Daftar
            </button>
          </div>
          <div className="text-xs text-slate-500">{settings.pharmacyName}</div>
        </div>
        <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 ring-1 ring-slate-200">
          <div className="font-semibold text-slate-800">Demo akun:</div>
          <div className="mt-1">Email: <span className="font-mono">admin@doorspharmacy.local</span></div>
          <div>Password: <span className="font-mono">admin123</span></div>
        </div>
      </div>
    </AuthCard>
  );
}

function RegisterPage({
  onRegister,
  onGoLogin,
}: {
  onRegister: (p: { fullName: string; identifier: string; password: string; role?: Role }) => void;
  onGoLogin: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState<Role>("Kasir");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  const can = fullName.trim() && identifier.trim() && pw.length >= 6 && pw === pw2;

  return (
    <AuthCard title="Daftar" subtitle="Buat akun baru untuk akses sistem (multi-user).">
      <div className="grid gap-3">
        <Input label="Nama lengkap" value={fullName} onChange={setFullName} placeholder="Nama Anda" />
        <Input label="Email / Nomor Telepon" value={identifier} onChange={setIdentifier} placeholder="contoh: nama@email.com / 08xxxx" />
        <Select
          label="Peran"
          value={role}
          onChange={(v) => setRole(v as Role)}
          options={[
            { value: "Admin", label: "Admin" },
            { value: "Apoteker", label: "Apoteker" },
            { value: "Kasir", label: "Kasir" },
          ]}
          hint="(Demo) Role memengaruhi label akses. Bisa dikembangkan untuk ACL." 
        />
        <Input label="Password" type="password" value={pw} onChange={setPw} placeholder="Minimal 6 karakter" />
        <Input label="Konfirmasi Password" type="password" value={pw2} onChange={setPw2} placeholder="Ulangi password" hint={pw2 && pw !== pw2 ? "Password tidak sama" : undefined} />
        <Button disabled={!can} onClick={() => onRegister({ fullName, identifier, password: pw, role })}>
          Daftar
          <ArrowRightIcon />
        </Button>
        <div className="text-sm text-slate-600">
          Sudah punya akun?
          <button className="ml-2 font-semibold text-[rgb(var(--brand-2))] hover:underline" onClick={onGoLogin}>
            Login
          </button>
        </div>
      </div>
    </AuthCard>
  );
}

function ForgotPage({
  onRequest,
  onGoLogin,
}: {
  onRequest: (identifier: string, channel: "Email" | "WhatsApp") => void;
  onGoLogin: () => void;
}) {
  const [identifier, setIdentifier] = useState("");

  return (
    <AuthCard title="Lupa Password" subtitle="Kirim OTP via Email atau WhatsApp (demo).">
      <div className="grid gap-3">
        <Input label="Email / No. HP" value={identifier} onChange={setIdentifier} placeholder="contoh: admin@... / 08xxxx" />
        <div className="grid gap-2 md:grid-cols-2">
          <Button variant="secondary" onClick={() => onRequest(identifier, "Email")}>Kirim OTP via Email</Button>
          <Button onClick={() => onRequest(identifier, "WhatsApp")}>Kirim OTP via WhatsApp</Button>
        </div>
        <div className="text-sm text-slate-600">
          <button className="font-semibold text-[rgb(var(--brand-2))] hover:underline" onClick={onGoLogin}>
            Kembali ke login
          </button>
        </div>
      </div>
    </AuthCard>
  );
}

function ResetPage({
  onConfirm,
  onGoLogin,
}: {
  onConfirm: (identifier: string, otp: string, newPassword: string) => void;
  onGoLogin: () => void;
}) {
  const [identifier, setIdentifier] = useState("");
  const [otp, setOtp] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  const can = identifier.trim() && otp.trim().length === 6 && pw.length >= 6 && pw === pw2;

  return (
    <AuthCard title="Reset Password" subtitle="Masukkan OTP lalu atur password baru.">
      <div className="grid gap-3">
        <Input label="Email / No. HP" value={identifier} onChange={setIdentifier} placeholder="contoh: admin@... / 08xxxx" />
        <Input label="OTP (6 digit)" value={otp} onChange={(v) => setOtp(onlyDigits(v).slice(0, 6))} placeholder="123456" />
        <Input label="Password baru" type="password" value={pw} onChange={setPw} />
        <Input label="Konfirmasi password baru" type="password" value={pw2} onChange={setPw2} hint={pw2 && pw !== pw2 ? "Password tidak sama" : undefined} />
        <Button disabled={!can} onClick={() => onConfirm(identifier, otp, pw)}>
          Simpan Password
          <ArrowRightIcon />
        </Button>
        <div className="text-sm text-slate-600">
          <button className="font-semibold text-[rgb(var(--brand-2))] hover:underline" onClick={onGoLogin}>
            Kembali ke login
          </button>
        </div>
      </div>
    </AuthCard>
  );
}

function AppShell({
  children,
  me,
  settings,
  page,
  lowStockCount,
  expiringCount,
  onNavigate,
  onLogout,
}: {
  children: React.ReactNode;
  me: User | null;
  settings: Settings;
  page: AppPage;
  lowStockCount: number;
  expiringCount: number;
  onNavigate: (p: AppPage) => void;
  onLogout: () => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const menu: { id: AppPage; label: string; icon: React.ReactNode; badge?: React.ReactNode }[] = [
    { id: "dashboard", label: "Dashboard", icon: <HomeIcon /> },
    { id: "stock", label: "Stock Obat", icon: <PillsIcon />, badge: lowStockCount ? <Badge tone="amber">{lowStockCount} low</Badge> : undefined },
    { id: "pembelian", label: "Pembelian", icon: <ArrowDownIcon /> },
    { id: "penjualan", label: "Penjualan", icon: <ArrowUpIcon /> },
    { id: "administrasi", label: "Administrasi (SP)", icon: <FileIcon /> },
    { id: "laporan", label: "Laporan Apotek", icon: <ReportIcon /> },
    { id: "keuangan", label: "Laporan Keuangan", icon: <WalletIcon /> },
    { id: "supplier", label: "Data Supplier", icon: <TruckIcon /> },
    { id: "shift", label: "Manajemen Shift", icon: <CalendarIcon />, badge: expiringCount ? <Badge tone="rose">{expiringCount} exp</Badge> : undefined },
    { id: "settings", label: "Setting Sistem", icon: <SettingsIcon /> },
    { id: "info", label: "Informasi", icon: <InfoIcon /> },
    { id: "audit", label: "Audit Log", icon: <ShieldIcon /> },
  ];

  const Sidebar = (
    <aside className="h-full w-[280px] border-r border-slate-200 bg-white/80 backdrop-blur">
      <div className="flex items-center justify-between px-4 py-4">
        <Brand settings={settings} subtitle="" />
        <button className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 md:hidden" onClick={() => setMobileOpen(false)}>
          <XIcon />
        </button>
      </div>
      <div className="px-3 pb-4">
        <div className="rounded-2xl bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.15),transparent_60%)] p-3 ring-1 ring-slate-200">
          <div className="text-xs font-semibold text-slate-700">Aktif sebagai</div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-bold text-slate-900">{me?.fullName ?? "-"}</div>
              <div className="text-xs text-slate-600">Role: {me?.role ?? "-"}</div>
            </div>
            <Badge tone="emerald">Online</Badge>
          </div>
        </div>

        <nav className="mt-4 grid gap-1">
          {menu.map((m) => {
            const active = page === m.id;
            return (
              <button
                key={m.id}
                onClick={() => {
                  onNavigate(m.id);
                  setMobileOpen(false);
                }}
                className={cn(
                  "flex items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition",
                  active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                )}
              >
                <span className="flex items-center gap-2">
                  <span className={cn("grid h-9 w-9 place-items-center rounded-xl", active ? "bg-white/10" : "bg-white ring-1 ring-slate-200")}>{m.icon}</span>
                  {m.label}
                </span>
                {m.badge}
              </button>
            );
          })}
        </nav>

        <div className="mt-4">
          <Button variant="secondary" onClick={onLogout}>
            Logout
          </Button>
        </div>

        <div className="mt-4 text-xs text-slate-500">
          Tips: gunakan kolom "Barcode" untuk input scanner.
        </div>
      </div>
    </aside>
  );

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[280px_1fr]">
      <div className="hidden md:block">{Sidebar}</div>
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0">{Sidebar}</div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col">
        <header className="no-print sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-2">
              <button className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 md:hidden" onClick={() => setMobileOpen(true)}>
                <MenuIcon />
              </button>
              <div>
                <div className="text-sm font-extrabold text-slate-900">{pageTitle(page)}</div>
                <div className="text-xs text-slate-600">{settings.pharmacyName} • {fmtDateHuman(todayISO())}</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 md:flex">
                <span className="h-2 w-2 rounded-full bg-[rgb(var(--brand))]" />
                Notif: {lowStockCount} stok menipis • {expiringCount} expiring
              </div>
              <a
                href="#/app/settings"
                className="rounded-xl p-2 text-slate-600 hover:bg-slate-100"
                title="Settings"
              >
                <SettingsIcon />
              </a>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

function pageTitle(page: AppPage) {
  switch (page) {
    case "dashboard":
      return "Dashboard";
    case "stock":
      return "Stock Obat";
    case "pembelian":
      return "Pembelian (Obat Masuk)";
    case "penjualan":
      return "Penjualan (Barang Keluar)";
    case "administrasi":
      return "Administrasi — Surat Pesanan (SP)";
    case "laporan":
      return "Laporan Apotek (Export)";
    case "keuangan":
      return "Laporan Keuangan";
    case "supplier":
      return "Data Supplier";
    case "settings":
      return "Setting Sistem";
    case "shift":
      return "Manajemen Shift";
    case "info":
      return "Halaman Informasi";
    case "audit":
      return "Audit Log";
  }
}

function StatCard({ title, value, hint, icon }: { title: string; value: string; hint: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-600">{title}</div>
        <div className="rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200">{icon}</div>
      </div>
      <div className="mt-2 text-2xl font-extrabold text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-600">{hint}</div>
    </div>
  );
}

function DashboardPage({
  settings,
  stats,
  sales,
  purchases,
  medicines,
  onGoStock,
  onGoSales,
  onGoPurchases,
}: {
  settings: Settings;
  stats: {
    totalStock: number;
    salesToday: number;
    purchasesToday: number;
    lowStock: Medicine[];
    expiringSoon: Medicine[];
    last7: { date: string; total: number }[];
  };
  sales: Sale[];
  purchases: Purchase[];
  medicines: Medicine[];
  onGoStock: () => void;
  onGoSales: () => void;
  onGoPurchases: () => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="rounded-2xl bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.16),transparent_55%),radial-gradient(ellipse_at_bottom,rgba(59,130,246,0.14),transparent_55%)] p-5 ring-1 ring-slate-200">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div>
            <div className="text-sm font-semibold text-slate-700">Selamat bekerja</div>
            <div className="mt-1 text-2xl font-extrabold text-slate-900">
              {settings.pharmacyName} — Dashboard
            </div>
            <div className="mt-1 text-sm text-slate-600">
              Ringkasan operasional hari ini + notifikasi stok.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onGoPurchases}>
              Input Pembelian
              <ArrowDownIcon />
            </Button>
            <Button onClick={onGoSales}>
              Input Penjualan
              <ArrowUpIcon />
            </Button>
            <Button variant="secondary" onClick={onGoStock}>
              Kelola Stock
              <PillsIcon />
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <StatCard title="Total stok obat" value={String(stats.totalStock)} hint="Total unit tersedia" icon={<PillsIcon />} />
        <StatCard title="Penjualan hari ini" value={formatIDR(stats.salesToday)} hint="Total pemasukan penjualan" icon={<ArrowUpIcon />} />
        <StatCard title="Pembelian hari ini" value={formatIDR(stats.purchasesToday)} hint="Total pengeluaran pembelian" icon={<ArrowDownIcon />} />
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <div className="md:col-span-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-slate-900">Grafik Penjualan (7 hari)</div>
              <div className="mt-1 text-sm text-slate-600">Total nilai transaksi per hari</div>
            </div>
            <Badge tone="emerald">Realtime (lokal)</Badge>
          </div>
          <div className="mt-4">
            <LineChart data={stats.last7} />
          </div>
        </div>

        <div className="md:col-span-2 grid gap-4">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-slate-900">Notifikasi Stok</div>
              <Badge tone={stats.lowStock.length ? "amber" : "emerald"}>{stats.lowStock.length ? "Perlu perhatian" : "Aman"}</Badge>
            </div>
            <div className="mt-3 grid gap-2">
              {stats.lowStock.slice(0, 4).map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{m.name}</div>
                    <div className="text-xs text-slate-600">Min {m.minStock} • Kategori {m.category}</div>
                  </div>
                  <Badge tone="amber">{m.stock}</Badge>
                </div>
              ))}
              {!stats.lowStock.length ? (
                <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
                  Tidak ada stok menipis.
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-slate-900">Kadaluarsa (≤ 30 hari)</div>
              <Badge tone={stats.expiringSoon.length ? "rose" : "emerald"}>{stats.expiringSoon.length ? "Cek" : "Aman"}</Badge>
            </div>
            <div className="mt-3 grid gap-2">
              {stats.expiringSoon.slice(0, 4).map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{m.name}</div>
                    <div className="text-xs text-slate-600">Exp: {fmtDateHuman(m.expiryDate)} • Batch {m.batchNo}</div>
                  </div>
                  <Badge tone="rose">{m.expiryDate}</Badge>
                </div>
              ))}
              {!stats.expiringSoon.length ? (
                <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
                  Tidak ada obat mendekati kadaluarsa.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <div className="text-sm font-bold text-slate-900">Ringkas Aktivitas</div>
          <div className="mt-3 grid gap-2 text-sm text-slate-700">
            <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
              <span>Jumlah item obat</span>
              <span className="font-bold">{medicines.length}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
              <span>Transaksi penjualan</span>
              <span className="font-bold">{sales.length}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
              <span>Transaksi pembelian</span>
              <span className="font-bold">{purchases.length}</span>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="text-sm font-bold text-slate-900">Rekomendasi Fitur Lanjutan</div>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
            <li>Integrasi WhatsApp API untuk notifikasi transaksi & stok</li>
            <li>Audit log detail per menu + export</li>
            <li>Backup otomatis terjadwal (server-side)</li>
            <li>Integrasi barcode scanner + pencarian cepat</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function LineChart({ data }: { data: { date: string; total: number }[] }) {
  const w = 680;
  const h = 180;
  const pad = 18;
  const max = Math.max(...data.map((d) => d.total), 1);
  const pts = data.map((d, i) => {
    const x = pad + (i * (w - pad * 2)) / (data.length - 1 || 1);
    const y = pad + (1 - d.total / max) * (h - pad * 2);
    return { x, y };
  });

  const path = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");

  const area = `${path} L${(pad + (w - pad * 2)).toFixed(2)} ${(h - pad).toFixed(2)} L${pad.toFixed(2)} ${(h - pad).toFixed(2)} Z`;

  return (
    <div className="w-full overflow-hidden rounded-2xl bg-slate-50 ring-1 ring-slate-200">
      <svg viewBox={`0 0 ${w} ${h}`} className="block h-[180px] w-full">
        <defs>
          <linearGradient id="line" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="rgb(var(--brand))" />
            <stop offset="1" stopColor="rgb(var(--brand-2))" />
          </linearGradient>
          <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="rgba(16,185,129,0.28)" />
            <stop offset="1" stopColor="rgba(59,130,246,0.04)" />
          </linearGradient>
        </defs>

        {/* grid */}
        {Array.from({ length: 5 }, (_, i) => {
          const y = pad + (i * (h - pad * 2)) / 4;
          return <line key={i} x1={pad} x2={w - pad} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />;
        })}

        <path d={area} fill="url(#area)" stroke="none" />
        <path d={path} fill="none" stroke="url(#line)" strokeWidth="3" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={4} fill="white" stroke="rgb(var(--brand))" strokeWidth="2" />
        ))}
      </svg>
      <div className="grid grid-cols-7 gap-2 px-3 pb-3 text-[11px] text-slate-600">
        {data.map((d) => (
          <div key={d.date} className="rounded-lg bg-white px-2 py-1 text-center ring-1 ring-slate-200">
            <div className="font-semibold">{d.date.slice(5)}</div>
            <div className="mt-0.5 font-mono">{Math.round(d.total / 1000)}k</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StockPage({
  medicines,
  onUpsert,
  onDelete,
  onExport,
  onImport,
}: {
  medicines: Medicine[];
  onUpsert: (m: Omit<Medicine, "createdAt" | "updatedAt" | "id"> & { id?: string }) => void;
  onDelete: (id: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Medicine | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return medicines
      .filter((m) => (cat === "all" ? true : m.category === cat))
      .filter((m) => {
        if (!qq) return true;
        return (
          m.name.toLowerCase().includes(qq) ||
          m.batchNo.toLowerCase().includes(qq) ||
          (m.barcode || "").toLowerCase().includes(qq)
        );
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [medicines, q, cat]);

  const startCreate = () => {
    setEditing(null);
    setOpen(true);
  };

  const startEdit = (m: Medicine) => {
    setEditing(m);
    setOpen(true);
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="grid gap-2 md:grid-cols-2">
          <Input label="Cari" value={q} onChange={setQ} placeholder="Nama obat / batch / barcode" />
          <Select
            label="Kategori"
            value={cat}
            onChange={setCat}
            options={[
              { value: "all", label: "Semua" },
              { value: "OTC", label: "OTC" },
              { value: "OOT", label: "OOT" },
              { value: "OKT", label: "OKT" },
              { value: "NSAID", label: "NSAID" },
              { value: "Opioid", label: "Opioid" },
              { value: "Narkotika", label: "Narkotika" },
            ]}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.currentTarget.value = "";
            }}
          />
          <Button variant="secondary" onClick={onExport}>
            Export CSV
          </Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            Import CSV
          </Button>
          <Button onClick={startCreate}>
            Tambah Obat
            <PlusIcon />
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-bold text-slate-700">
              <tr>
                <th className="px-4 py-3">Nama</th>
                <th className="px-4 py-3">Kategori</th>
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3">Exp</th>
                <th className="px-4 py-3 text-right">Stok</th>
                <th className="px-4 py-3 text-right">Harga Beli</th>
                <th className="px-4 py-3 text-right">Harga Jual</th>
                <th className="px-4 py-3">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const low = m.stock <= (m.minStock ?? 0);
                return (
                  <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{m.name}</div>
                      <div className="text-xs text-slate-500">Barcode: <span className="font-mono">{m.barcode || "-"}</span></div>
                    </td>
                    <td className="px-4 py-3"><Badge tone={m.category === "OTC" ? "emerald" : "blue"}>{m.category}</Badge></td>
                    <td className="px-4 py-3"><span className="font-mono text-xs">{m.batchNo}</span></td>
                    <td className="px-4 py-3"><span className={cn("text-xs font-semibold", m.expiryDate <= addDaysISO(todayISO(), 30) ? "text-rose-700" : "text-slate-700")}>{m.expiryDate}</span></td>
                    <td className="px-4 py-3 text-right">
                      <span className={cn("rounded-full px-2 py-1 text-xs font-bold", low ? "bg-amber-50 text-amber-800 ring-1 ring-amber-200" : "bg-slate-50 text-slate-700 ring-1 ring-slate-200")}>{m.stock}</span>
                      <div className="mt-1 text-xs text-slate-500">Min {m.minStock}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{formatIDR(m.buyPrice)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{formatIDR(m.sellPrice)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => startEdit(m)}>Edit</Button>
                        <Button size="sm" variant="danger" onClick={() => onDelete(m.id)}>Hapus</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!filtered.length ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-600">
                    Tidak ada data.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <MedicineModal
        open={open}
        medicine={editing}
        onClose={() => setOpen(false)}
        onSave={(m) => {
          onUpsert(m);
          setOpen(false);
        }}
      />
    </div>
  );
}

function MedicineModal({
  open,
  medicine,
  onClose,
  onSave,
}: {
  open: boolean;
  medicine: Medicine | null;
  onClose: () => void;
  onSave: (m: Omit<Medicine, "createdAt" | "updatedAt" | "id"> & { id?: string }) => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<MedicineCategory>("OTC");
  const [batchNo, setBatchNo] = useState("");
  const [expiryDate, setExpiryDate] = useState(todayISO());
  const [stock, setStock] = useState("0");
  const [minStock, setMinStock] = useState("0");
  const [buyPrice, setBuyPrice] = useState("0");
  const [sellPrice, setSellPrice] = useState("0");
  const [barcode, setBarcode] = useState("");

  useEffect(() => {
    if (open) {
      setName(medicine?.name ?? "");
      setCategory(medicine?.category ?? "OTC");
      setBatchNo(medicine?.batchNo ?? "");
      setExpiryDate(medicine?.expiryDate ?? todayISO());
      setStock(String(medicine?.stock ?? 0));
      setMinStock(String(medicine?.minStock ?? 0));
      setBuyPrice(String(medicine?.buyPrice ?? 0));
      setSellPrice(String(medicine?.sellPrice ?? 0));
      setBarcode(medicine?.barcode ?? "");
    }
  }, [open, medicine]);

  const can = name.trim() && batchNo.trim() && expiryDate;

  return (
    <Modal
      open={open}
      title={medicine ? "Edit Obat" : "Tambah Obat"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button
            disabled={!can}
            onClick={() =>
              onSave({
                id: medicine?.id,
                name: name.trim(),
                category,
                batchNo: batchNo.trim(),
                expiryDate,
                stock: safeNum(stock),
                minStock: safeNum(minStock),
                buyPrice: safeNum(buyPrice),
                sellPrice: safeNum(sellPrice),
                barcode: barcode.trim() || undefined,
              })
            }
          >
            Simpan
          </Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Input label="Nama Obat" value={name} onChange={setName} />
        <Select
          label="Kategori"
          value={category}
          onChange={(v) => setCategory(v as MedicineCategory)}
          options={[
            { value: "OTC", label: "OTC (Obat Bebas)" },
            { value: "OOT", label: "OOT (Obat-Obat Tertentu)" },
            { value: "OKT", label: "OKT (Obat Keras Tertentu)" },
            { value: "NSAID", label: "NSAID (Anti Nyeri)" },
            { value: "Opioid", label: "Opioid" },
            { value: "Narkotika", label: "Narkotika" },
          ]}
        />
        <Input label="No Batch" value={batchNo} onChange={setBatchNo} />
        <label className="block">
          <div className="mb-1 text-xs font-semibold text-slate-700">Tanggal Kadaluarsa</div>
          <input
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            className="w-full rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-slate-200 outline-none transition focus:ring-2 focus:ring-[rgb(var(--ring))]"
          />
        </label>
        <Input label="Stok" value={stock} onChange={(v) => setStock(onlyDigits(v))} />
        <Input label="Stok Minimum" value={minStock} onChange={(v) => setMinStock(onlyDigits(v))} />
        <Input label="Harga Beli" value={buyPrice} onChange={(v) => setBuyPrice(onlyDigits(v))} hint="Dalam rupiah (tanpa titik/koma)" />
        <Input label="Harga Jual" value={sellPrice} onChange={(v) => setSellPrice(onlyDigits(v))} hint="Dalam rupiah (tanpa titik/koma)" />
        <Input label="Barcode (opsional)" value={barcode} onChange={(v) => setBarcode(v)} hint="Bisa diisi hasil scan barcode" />
      </div>
    </Modal>
  );
}

function PurchasesPage({
  medicines,
  suppliers,
  purchases,
  onSave,
}: {
  medicines: Medicine[];
  suppliers: Supplier[];
  purchases: Purchase[];
  onSave: (p: Omit<Purchase, "id" | "createdAt" | "total">) => Purchase;
}) {
  const [date, setDate] = useState(todayISO());
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [barcode, setBarcode] = useState("");
  const [medicineId, setMedicineId] = useState(medicines[0]?.id ?? "");
  const [batchNo, setBatchNo] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("0");
  const [ppn, setPpn] = useState("11");

  const med = medicines.find((m) => m.id === medicineId) ?? null;

  useEffect(() => {
    if (med) {
      setUnitPrice(String(med.buyPrice || 0));
      setBatchNo(med.batchNo || "");
    }
  }, [medicineId]);

  useEffect(() => {
    const code = onlyDigits(barcode.trim());
    if (!code) return;
    const found = medicines.find((m) => onlyDigits(m.barcode || "") === code);
    if (found) setMedicineId(found.id);
  }, [barcode, medicines]);

  const total = Math.round(safeNum(quantity) * safeNum(unitPrice) * (1 + safeNum(ppn) / 100));

  const can = supplierId && invoiceNo.trim() && medicineId && safeNum(quantity) > 0;

  return (
    <div className="grid gap-4">
      <Card className="p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Input Pembelian</div>
            <div className="mt-1 text-sm text-slate-600">Obat masuk dari PBF/Supplier. Total dihitung otomatis.</div>
          </div>
          <Badge tone="blue">Riwayat: {purchases.length}</Badge>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="block">
            <div className="mb-1 text-xs font-semibold text-slate-700">Tanggal</div>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-slate-200 outline-none transition focus:ring-2 focus:ring-[rgb(var(--ring))]" />
          </label>
          <Select
            label="Nama PBF (Supplier)"
            value={supplierId}
            onChange={setSupplierId}
            options={suppliers.length ? suppliers.map((s) => ({ value: s.id, label: s.name })) : [{ value: "", label: "(Belum ada supplier)" }]}
          />
          <Input label="No Faktur" value={invoiceNo} onChange={setInvoiceNo} placeholder="INV-..." />

          <Input label="Barcode (opsional)" value={barcode} onChange={setBarcode} placeholder="Scan barcode untuk pilih obat" />
          <Select
            label="Nama Obat"
            value={medicineId}
            onChange={setMedicineId}
            options={medicines.length ? medicines.map((m) => ({ value: m.id, label: `${m.name} (stok ${m.stock})` })) : [{ value: "", label: "(Belum ada obat)" }]}
          />
          <Input label="No Batch" value={batchNo} onChange={setBatchNo} placeholder="BATCH-..." />

          <Input label="Jumlah (box/botol)" value={quantity} onChange={(v) => setQuantity(onlyDigits(v))} />
          <Input label="Harga per unit" value={unitPrice} onChange={(v) => setUnitPrice(onlyDigits(v))} />
          <Input label="Pajak (PPN %)" value={ppn} onChange={(v) => setPpn(onlyDigits(v))} />
        </div>

        <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-slate-700">
            Kategori: <span className="font-bold">{med?.category ?? "-"}</span> • Total: <span className="font-extrabold text-slate-900">{formatIDR(total)}</span>
          </div>
          <Button
            disabled={!can}
            onClick={() => {
              if (!med) return;
              onSave({
                date,
                supplierId,
                invoiceNo: invoiceNo.trim(),
                medicineId,
                batchNo: batchNo.trim() || med.batchNo,
                quantity: safeNum(quantity),
                unitPrice: safeNum(unitPrice),
                ppnPercent: clamp(safeNum(ppn), 0, 100),
                category: med.category,
              });
              setInvoiceNo("");
              setBarcode("");
              setQuantity("1");
            }}
          >
            Simpan Transaksi
            <CheckIcon />
          </Button>
        </div>
      </Card>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center justify-between bg-slate-50 px-4 py-3">
          <div className="text-sm font-bold text-slate-900">Riwayat Pembelian</div>
          <div className="text-xs text-slate-600">Menambah stok otomatis</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs font-bold text-slate-700">
              <tr className="border-t border-slate-200">
                <th className="px-4 py-3">Tanggal</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">No Faktur</th>
                <th className="px-4 py-3">Obat</th>
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {purchases.slice(0, 25).map((p) => {
                const sup = suppliers.find((s) => s.id === p.supplierId)?.name ?? "-";
                const m = medicines.find((m) => m.id === p.medicineId)?.name ?? "-";
                return (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-xs font-semibold text-slate-700">{p.date}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-900">{sup}</td>
                    <td className="px-4 py-3 font-mono text-xs">{p.invoiceNo}</td>
                    <td className="px-4 py-3">{m}</td>
                    <td className="px-4 py-3 font-mono text-xs">{p.batchNo}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{p.quantity}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{formatIDR(p.total)}</td>
                  </tr>
                );
              })}
              {!purchases.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-600">Belum ada pembelian.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SalesPage({
  settings,
  medicines,
  sales,
  onSave,
}: {
  settings: Settings;
  medicines: Medicine[];
  sales: Sale[];
  onSave: (s: Omit<Sale, "id" | "createdAt" | "total">) => { ok: boolean; sale?: Sale };
}) {
  const [date, setDate] = useState(todayISO());
  const [customerName, setCustomerName] = useState("");
  const [prescriptionCount, setPrescriptionCount] = useState("0");
  const [doctorName, setDoctorName] = useState("");
  const [prescriptionPrice, setPrescriptionPrice] = useState("0");
  const [barcode, setBarcode] = useState("");
  const [medicineId, setMedicineId] = useState(medicines[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("0");

  const med = medicines.find((m) => m.id === medicineId) ?? null;

  useEffect(() => {
    if (med) setUnitPrice(String(med.sellPrice || 0));
  }, [medicineId]);

  useEffect(() => {
    const code = onlyDigits(barcode.trim());
    if (!code) return;
    const found = medicines.find((m) => onlyDigits(m.barcode || "") === code);
    if (found) setMedicineId(found.id);
  }, [barcode, medicines]);

  const total =
    Math.round(safeNum(quantity) * safeNum(unitPrice) + safeNum(prescriptionCount) * safeNum(prescriptionPrice));

  const can = medicineId && safeNum(quantity) > 0;

  const printReceipt = (sale: Sale) => {
    const m = medicines.find((x) => x.id === sale.medicineId);
    const html = `
      <div class="text-center">
        <h2>${escapeHtml(settings.pharmacyName)}</h2>
        <div class="small">Doors Pharmacy System</div>
      </div>
      <hr/>
      <table>
        <tr><td>Tanggal</td><td class="text-right mono">${sale.date}</td></tr>
        <tr><td>Pelanggan</td><td class="text-right">${escapeHtml(sale.customerName || "Umum")}</td></tr>
        <tr><td>Dokter</td><td class="text-right">${escapeHtml(sale.doctorName || "-")}</td></tr>
      </table>
      <hr/>
      <table>
        <thead>
          <tr><th>Item</th><th class="text-right">Subtotal</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <div><b>${escapeHtml(m?.name || "Obat")}</b></div>
              <div class="small">${sale.quantity} x ${sale.unitPrice}</div>
            </td>
            <td class="text-right mono">${sale.quantity * sale.unitPrice}</td>
          </tr>
          <tr>
            <td>
              <div><b>Jasa Resep</b></div>
              <div class="small">${sale.prescriptionCount} x ${sale.prescriptionPrice}</div>
            </td>
            <td class="text-right mono">${sale.prescriptionCount * sale.prescriptionPrice}</td>
          </tr>
        </tbody>
      </table>
      <hr/>
      <table>
        <tr><td><b>TOTAL</b></td><td class="text-right mono"><b>${sale.total}</b></td></tr>
      </table>
      <hr/>
      <div class="text-center small">${escapeHtml(settings.receiptFooter || "")}</div>
    `;

    printHtml({ title: "Struk Penjualan", html, pageSize: "receipt" });
  };

  return (
    <div className="grid gap-4">
      <Card className="p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Input Penjualan</div>
            <div className="mt-1 text-sm text-slate-600">Barang keluar. Stok berkurang otomatis. Total termasuk jasa resep.</div>
          </div>
          <Badge tone="blue">Riwayat: {sales.length}</Badge>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="block">
            <div className="mb-1 text-xs font-semibold text-slate-700">Tanggal</div>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-slate-200 outline-none transition focus:ring-2 focus:ring-[rgb(var(--ring))]" />
          </label>
          <Input label="Nama pelanggan" value={customerName} onChange={setCustomerName} placeholder="Umum / Nama" />
          <Input label="Nama dokter" value={doctorName} onChange={setDoctorName} placeholder="(opsional)" />

          <Input label="Jumlah resep" value={prescriptionCount} onChange={(v) => setPrescriptionCount(onlyDigits(v))} />
          <Input label="Harga per lembar resep" value={prescriptionPrice} onChange={(v) => setPrescriptionPrice(onlyDigits(v))} />
          <Input label="Barcode (opsional)" value={barcode} onChange={setBarcode} placeholder="Scan barcode untuk pilih obat" />

          <Select
            label="Obat"
            value={medicineId}
            onChange={setMedicineId}
            options={medicines.length ? medicines.map((m) => ({ value: m.id, label: `${m.name} (stok ${m.stock})` })) : [{ value: "", label: "(Belum ada obat)" }]}
          />
          <Input label="Jumlah obat" value={quantity} onChange={(v) => setQuantity(onlyDigits(v))} />
          <Input label="Harga obat / unit" value={unitPrice} onChange={(v) => setUnitPrice(onlyDigits(v))} />
        </div>

        <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-slate-700">
            Jenis obat: <span className="font-bold">{med?.category ?? "-"}</span> • Total: <span className="font-extrabold text-slate-900">{formatIDR(total)}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!can}
              onClick={() => {
                if (!med) return;
                const res = onSave({
                  date,
                  customerName: customerName.trim(),
                  prescriptionCount: safeNum(prescriptionCount),
                  doctorName: doctorName.trim(),
                  prescriptionPrice: safeNum(prescriptionPrice),
                  medicineId,
                  category: med.category,
                  quantity: safeNum(quantity),
                  unitPrice: safeNum(unitPrice),
                });
                if (res.ok && res.sale) {
                  printReceipt(res.sale);
                  setCustomerName("");
                  setDoctorName("");
                  setPrescriptionCount("0");
                  setPrescriptionPrice("0");
                  setBarcode("");
                  setQuantity("1");
                }
              }}
            >
              Simpan & Cetak Struk
              <PrinterIcon />
            </Button>
          </div>
        </div>
      </Card>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center justify-between bg-slate-50 px-4 py-3">
          <div className="text-sm font-bold text-slate-900">Riwayat Penjualan</div>
          <div className="text-xs text-slate-600">Klik untuk cetak ulang</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs font-bold text-slate-700">
              <tr className="border-t border-slate-200">
                <th className="px-4 py-3">Tanggal</th>
                <th className="px-4 py-3">Pelanggan</th>
                <th className="px-4 py-3">Obat</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {sales.slice(0, 25).map((s) => {
                const m = medicines.find((m) => m.id === s.medicineId)?.name ?? "-";
                return (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-xs font-semibold text-slate-700">{s.date}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-900">{s.customerName || "Umum"}</td>
                    <td className="px-4 py-3">{m}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{s.quantity}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{formatIDR(s.total)}</td>
                    <td className="px-4 py-3">
                      <Button size="sm" variant="secondary" onClick={() => printReceipt(s)}>
                        Cetak
                        <PrinterIcon />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!sales.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-600">Belum ada penjualan.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AdministrasiPage({
  settings,
  suppliers,
  spOrders,
  onSave,
}: {
  settings: Settings;
  suppliers: Supplier[];
  spOrders: SPOrder[];
  onSave: (p: { date: string; supplierId: string; items: { medicineName: string; category: MedicineCategory; quantity: number }[] }) => SPOrder;
}) {
  const [date, setDate] = useState(todayISO());
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [items, setItems] = useState<{ medicineName: string; category: MedicineCategory; quantity: string }[]>([
    { medicineName: "", category: "OTC", quantity: "1" },
  ]);

  const can = supplierId && items.some((i) => i.medicineName.trim() && safeNum(i.quantity) > 0);

  const printSP = (order: SPOrder) => {
    const sup = suppliers.find((s) => s.id === order.supplierId);
    const html = `
      <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;">
        <div>
          <h2>${escapeHtml(settings.pharmacyName)}</h2>
          <div class="small">Surat Pesanan (SP)</div>
          <div class="small">Doors Pharmacy System</div>
        </div>
        <div style="text-align:right">
          <div class="small">Nomor</div>
          <div class="mono"><b>${escapeHtml(order.spNumber)}</b></div>
          <div class="small">Tanggal</div>
          <div class="mono">${escapeHtml(order.date)}</div>
        </div>
      </div>
      <hr/>
      <table>
        <tr><td>PBF / Supplier</td><td class="text-right"><b>${escapeHtml(sup?.name || "-")}</b></td></tr>
        <tr><td>Alamat</td><td class="text-right">${escapeHtml(sup?.address || "-")}</td></tr>
        <tr><td>Kontak</td><td class="text-right">${escapeHtml(sup?.contact || "-")}</td></tr>
      </table>
      <hr/>
      <table>
        <thead>
          <tr><th>Obat</th><th>Kategori</th><th class="text-right">Jumlah</th></tr>
        </thead>
        <tbody>
          ${order.items
            .map(
              (it) => `
            <tr>
              <td>${escapeHtml(it.medicineName)}</td>
              <td>${escapeHtml(it.category)}</td>
              <td class="text-right mono">${it.quantity}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
      <hr/>
      <table>
        <tr><td><b>Total Pesanan</b></td><td class="text-right mono"><b>${order.totalItems}</b></td></tr>
      </table>
      <hr/>
      <div class="small">Catatan: Dokumen ini dicetak dari aplikasi.</div>
    `;

    printHtml({ title: `SP ${order.spNumber}`, html, pageSize: "A4" });
  };

  return (
    <div className="grid gap-4">
      <Card className="p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Surat Pesanan (SP)</div>
            <div className="mt-1 text-sm text-slate-600">Nomor otomatis, siap print (ukuran kertas via browser).</div>
          </div>
          <Badge tone="blue">Riwayat: {spOrders.length}</Badge>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="block">
            <div className="mb-1 text-xs font-semibold text-slate-700">Tanggal</div>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-slate-200 outline-none transition focus:ring-2 focus:ring-[rgb(var(--ring))]" />
          </label>
          <Select
            label="Nama PBF"
            value={supplierId}
            onChange={setSupplierId}
            options={suppliers.length ? suppliers.map((s) => ({ value: s.id, label: s.name })) : [{ value: "", label: "(Belum ada supplier)" }]}
          />
          <div className="rounded-2xl bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
            <div className="text-xs font-semibold text-slate-700">Total item</div>
            <div className="mt-1 text-xl font-extrabold text-slate-900">
              {sum(items.map((i) => safeNum(i.quantity)))}
            </div>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl ring-1 ring-slate-200">
          <div className="flex items-center justify-between bg-slate-50 px-4 py-3">
            <div className="text-sm font-bold text-slate-900">Detail Obat</div>
            <Button size="sm" variant="secondary" onClick={() => setItems((prev) => [...prev, { medicineName: "", category: "OTC", quantity: "1" }])}>
              Tambah Baris
              <PlusIcon />
            </Button>
          </div>
          <div className="overflow-x-auto bg-white">
            <table className="w-full text-left text-sm">
              <thead className="text-xs font-bold text-slate-700">
                <tr className="border-t border-slate-200">
                  <th className="px-4 py-3">Nama Obat</th>
                  <th className="px-4 py-3">Kategori</th>
                  <th className="px-4 py-3 text-right">Jumlah</th>
                  <th className="px-4 py-3">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <input value={it.medicineName} onChange={(e) => setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, medicineName: e.target.value } : x)))} className="w-full rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-[rgb(var(--ring))]" placeholder="Nama obat" />
                    </td>
                    <td className="px-4 py-3">
                      <select value={it.category} onChange={(e) => setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, category: e.target.value as MedicineCategory } : x)))} className="w-full rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-[rgb(var(--ring))]">
                        {(["OTC","OOT","OKT","NSAID","Opioid","Narkotika"] as MedicineCategory[]).map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <input value={it.quantity} onChange={(e) => setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: onlyDigits(e.target.value) } : x)))} className="w-28 rounded-xl bg-white px-3 py-2 text-right text-sm ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-[rgb(var(--ring))]" />
                    </td>
                    <td className="px-4 py-3">
                      <Button size="sm" variant="danger" onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}>
                        Hapus
                      </Button>
                    </td>
                  </tr>
                ))}
                {!items.length ? (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-600">Tidak ada item.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end">
          <Button
            disabled={!can}
            onClick={() => {
              const order = onSave({
                date,
                supplierId,
                items: items
                  .filter((i) => i.medicineName.trim() && safeNum(i.quantity) > 0)
                  .map((i) => ({
                    medicineName: i.medicineName.trim(),
                    category: i.category,
                    quantity: safeNum(i.quantity),
                  })),
              });
              printSP(order);
              setItems([{ medicineName: "", category: "OTC", quantity: "1" }]);
            }}
          >
            Simpan & Print SP
            <PrinterIcon />
          </Button>
        </div>
      </Card>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center justify-between bg-slate-50 px-4 py-3">
          <div className="text-sm font-bold text-slate-900">Riwayat SP</div>
          <div className="text-xs text-slate-600">Cetak ulang tersedia</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs font-bold text-slate-700">
              <tr className="border-t border-slate-200">
                <th className="px-4 py-3">Tanggal</th>
                <th className="px-4 py-3">Nomor</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {spOrders.slice(0, 25).map((o) => {
                const sup = suppliers.find((s) => s.id === o.supplierId)?.name ?? "-";
                return (
                  <tr key={o.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-xs font-semibold text-slate-700">{o.date}</td>
                    <td className="px-4 py-3 font-mono text-xs">{o.spNumber}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-900">{sup}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{o.totalItems}</td>
                    <td className="px-4 py-3">
                      <Button size="sm" variant="secondary" onClick={() => printSP(o)}>
                        Print
                        <PrinterIcon />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!spOrders.length ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-600">Belum ada SP.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function LaporanPage({
  sales,
  purchases,
}: {
  sales: Sale[];
  purchases: Purchase[];
}) {
  const [mode, setMode] = useState<"Harian" | "Mingguan" | "Bulanan">("Harian");
  const [date, setDate] = useState(todayISO());

  const range = useMemo(() => {
    if (mode === "Harian") return { start: date, end: date };
    if (mode === "Mingguan") return { start: startOfWeekISO(date), end: endOfWeekISO(date) };
    const start = date.slice(0, 7) + "-01";
    // end-of-month: take next month - 1 day
    const dt = new Date(start + "T00:00:00");
    dt.setMonth(dt.getMonth() + 1);
    dt.setDate(dt.getDate() - 1);
    const end = todayISO(dt);
    return { start, end };
  }, [mode, date]);

  const report = useMemo(() => {
    const inRange = (d: string) => d >= range.start && d <= range.end;

    const salesR = sales.filter((s) => inRange(s.date));
    const purchasesR = purchases.filter((p) => inRange(p.date));

    const resepRevenue = sum(salesR.map((s) => s.prescriptionCount * s.prescriptionPrice));

    const ethicalRevenue = sum(
      salesR.filter((s) => categorizeEthical(s.category)).map((s) => s.quantity * s.unitPrice)
    );
    const otcRevenue = sum(salesR.filter((s) => s.category === "OTC").map((s) => s.quantity * s.unitPrice));
    const memberRevenue = 0;

    const cashDrawer = sum(salesR.map((s) => s.total));

    const ethicalPurchase = sum(purchasesR.filter((p) => categorizeEthical(p.category)).map((p) => p.total));
    const otcPurchase = sum(purchasesR.filter((p) => p.category === "OTC").map((p) => p.total));

    return {
      salesCount: salesR.length,
      purchaseCount: purchasesR.length,
      cashDrawer,
      revenue: {
        ethical: ethicalRevenue,
        otc: otcRevenue,
        member: memberRevenue,
        resep: resepRevenue,
      },
      purchases: {
        ethical: ethicalPurchase,
        otc: otcPurchase,
      },
    };
  }, [sales, purchases, range.start, range.end]);

  const exportCSV = () => {
    const lines = [
      ["mode", mode].join(","),
      ["start", range.start].join(","),
      ["end", range.end].join(","),
      "",
      "section,key,value",
      `pendapatan,Ethical,${report.revenue.ethical}`,
      `pendapatan,OTC,${report.revenue.otc}`,
      `pendapatan,Member,${report.revenue.member}`,
      `pendapatan,Resep,${report.revenue.resep}`,
      `kas,UangKasLaci,${report.cashDrawer}`,
      `pembelian,Ethical,${report.purchases.ethical}`,
      `pembelian,OTC,${report.purchases.otc}`,
    ].join("\n");

    const blob = new Blob([lines], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `laporan_${mode}_${range.start}_${range.end}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const printReport = () => {
    const html = `
      <h2>Laporan Apotek (${escapeHtml(mode)})</h2>
      <div class="small">Periode: <span class="mono">${escapeHtml(range.start)}</span> s/d <span class="mono">${escapeHtml(range.end)}</span></div>
      <hr/>
      <table>
        <thead><tr><th>Ringkasan</th><th class="text-right">Nilai</th></tr></thead>
        <tbody>
          <tr><td>Uang kas/laci</td><td class="text-right mono">${report.cashDrawer}</td></tr>
          <tr><td>Jumlah penjualan</td><td class="text-right mono">${report.salesCount}</td></tr>
          <tr><td>Jumlah pembelian</td><td class="text-right mono">${report.purchaseCount}</td></tr>
        </tbody>
      </table>
      <hr/>
      <table>
        <thead><tr><th>Pendapatan</th><th class="text-right">Nilai</th></tr></thead>
        <tbody>
          <tr><td>Ethical</td><td class="text-right mono">${report.revenue.ethical}</td></tr>
          <tr><td>OTC</td><td class="text-right mono">${report.revenue.otc}</td></tr>
          <tr><td>Member</td><td class="text-right mono">${report.revenue.member}</td></tr>
          <tr><td>Resep</td><td class="text-right mono">${report.revenue.resep}</td></tr>
        </tbody>
      </table>
      <hr/>
      <table>
        <thead><tr><th>Pembelian</th><th class="text-right">Nilai</th></tr></thead>
        <tbody>
          <tr><td>Ethical</td><td class="text-right mono">${report.purchases.ethical}</td></tr>
          <tr><td>OTC</td><td class="text-right mono">${report.purchases.otc}</td></tr>
        </tbody>
      </table>
      <hr/>
      <div class="small">Catatan: Export PDF dapat dilakukan melalui fitur Print to PDF pada browser.</div>
    `;
    printHtml({ title: "Laporan Apotek", html, pageSize: "A4" });
  };

  return (
    <div className="grid gap-4">
      <Card className="p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Laporan Apotek (Export)</div>
            <div className="mt-1 text-sm text-slate-600">Harian, mingguan, bulanan. Export CSV / Print (PDF).</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={exportCSV}>Export CSV</Button>
            <Button onClick={printReport}>Print / PDF</Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Select
            label="Mode"
            value={mode}
            onChange={(v) => setMode(v as any)}
            options={[
              { value: "Harian", label: "Harian" },
              { value: "Mingguan", label: "Mingguan" },
              { value: "Bulanan", label: "Bulanan" },
            ]}
          />
          <label className="block">
            <div className="mb-1 text-xs font-semibold text-slate-700">Tanggal acuan</div>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-slate-200 outline-none transition focus:ring-2 focus:ring-[rgb(var(--ring))]" />
          </label>
          <div className="rounded-2xl bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
            <div className="text-xs font-semibold text-slate-700">Periode</div>
            <div className="mt-1 font-mono text-xs">{range.start} → {range.end}</div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Metric title="Uang kas/laci" value={formatIDR(report.cashDrawer)} tone="emerald" />
          <Metric title="Pendapatan Ethical" value={formatIDR(report.revenue.ethical)} tone="blue" />
          <Metric title="Pendapatan OTC" value={formatIDR(report.revenue.otc)} tone="emerald" />
          <Metric title="Pendapatan Resep" value={formatIDR(report.revenue.resep)} tone="amber" />
          <Metric title="Total pembelian Ethical" value={formatIDR(report.purchases.ethical)} tone="rose" />
          <Metric title="Total pembelian OTC" value={formatIDR(report.purchases.otc)} tone="rose" />
        </div>
      </Card>

      <Card className="p-5">
        <div className="text-sm font-bold text-slate-900">Catatan Export</div>
        <div className="mt-2 text-sm text-slate-600">
          Untuk export PDF/Excel: gunakan <b>Print</b> (Save as PDF) atau export <b>CSV</b> lalu buka di Excel.
          Integrasi PDF/Excel generator bisa ditambahkan saat npm install tersedia.
        </div>
      </Card>
    </div>
  );
}

function Metric({ title, value, tone }: { title: string; value: string; tone: "emerald" | "blue" | "rose" | "amber" }) {
  const tones: Record<string, string> = {
    emerald: "bg-emerald-50 ring-emerald-200 text-emerald-900",
    blue: "bg-blue-50 ring-blue-200 text-blue-900",
    rose: "bg-rose-50 ring-rose-200 text-rose-900",
    amber: "bg-amber-50 ring-amber-200 text-amber-900",
  };
  return (
    <div className={cn("rounded-2xl p-4 ring-1", tones[tone])}>
      <div className="text-xs font-semibold opacity-80">{title}</div>
      <div className="mt-2 text-lg font-extrabold">{value}</div>
    </div>
  );
}

function KeuanganPage({ sales, purchases }: { sales: Sale[]; purchases: Purchase[] }) {
  const [month, setMonth] = useState(monthKey(todayISO()));

  const computed = useMemo(() => {
    const inMonth = (d: string) => monthKey(d) === month;
    const s = sales.filter((x) => inMonth(x.date));
    const p = purchases.filter((x) => inMonth(x.date));

    const revenue = sum(s.map((x) => x.total));
    const cogs = sum(p.map((x) => x.total));
    const grossProfit = revenue - cogs;

    // simple cash approximation
    const cash = revenue - cogs;

    return { revenue, cogs, grossProfit, cash, sCount: s.length, pCount: p.length };
  }, [sales, purchases, month]);

  const printFinance = () => {
    const html = `
      <h2>Laporan Keuangan (Ringkas)</h2>
      <div class="small">Bulan: <span class="mono">${escapeHtml(month)}</span></div>
      <hr/>
      <table>
        <thead><tr><th>Laba/Rugi</th><th class="text-right">Nilai</th></tr></thead>
        <tbody>
          <tr><td>Pendapatan</td><td class="text-right mono">${computed.revenue}</td></tr>
          <tr><td>HPP (pembelian)</td><td class="text-right mono">${computed.cogs}</td></tr>
          <tr><td><b>Laba Kotor</b></td><td class="text-right mono"><b>${computed.grossProfit}</b></td></tr>
        </tbody>
      </table>
      <hr/>
      <table>
        <thead><tr><th>Neraca (Sederhana)</th><th class="text-right">Nilai</th></tr></thead>
        <tbody>
          <tr><td>Kas (approx)</td><td class="text-right mono">${computed.cash}</td></tr>
          <tr><td>Aset lain</td><td class="text-right mono">0</td></tr>
          <tr><td>Liabilitas</td><td class="text-right mono">0</td></tr>
        </tbody>
      </table>
      <hr/>
      <div class="small">Catatan: Ini ringkas berbasis transaksi demo (LocalStorage). Untuk akurasi akuntansi, integrasikan modul jurnal & saldo awal.</div>
    `;
    printHtml({ title: "Laporan Keuangan", html, pageSize: "A4" });
  };

  return (
    <div className="grid gap-4">
      <Card className="p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Laporan Keuangan</div>
            <div className="mt-1 text-sm text-slate-600">Neraca & Laba/Rugi (ringkas) berdasarkan transaksi.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={printFinance}>Print / PDF</Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="block">
            <div className="mb-1 text-xs font-semibold text-slate-700">Bulan</div>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-full rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-slate-200 outline-none transition focus:ring-2 focus:ring-[rgb(var(--ring))]"
            />
          </label>
          <div className="rounded-2xl bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
            <div className="text-xs font-semibold text-slate-700">Jumlah transaksi</div>
            <div className="mt-1 text-sm">Penjualan: <b>{computed.sCount}</b> • Pembelian: <b>{computed.pCount}</b></div>
          </div>
          <div className="rounded-2xl bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
            <div className="text-xs font-semibold text-slate-700">Kas (approx)</div>
            <div className="mt-1 text-xl font-extrabold text-slate-900">{formatIDR(computed.cash)}</div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Metric title="Pendapatan" value={formatIDR(computed.revenue)} tone="emerald" />
          <Metric title="HPP (Pembelian)" value={formatIDR(computed.cogs)} tone="rose" />
          <Metric title="Laba Kotor" value={formatIDR(computed.grossProfit)} tone={computed.grossProfit >= 0 ? "blue" : "amber"} />
        </div>
      </Card>

      <Card className="p-5">
        <div className="text-sm font-bold text-slate-900">Stock Opname Bulanan (Demo)</div>
        <div className="mt-2 text-sm text-slate-600">
          Untuk stock opname yang lengkap, biasanya dibutuhkan modul opname per item + penyesuaian stok.
          Pada prototipe ini, stok selalu mengikuti transaksi pembelian & penjualan.
        </div>
      </Card>
    </div>
  );
}

function SupplierPage({
  suppliers,
  purchases,
  onUpsert,
  onDelete,
}: {
  suppliers: Supplier[];
  purchases: Purchase[];
  onUpsert: (s: Omit<Supplier, "createdAt" | "updatedAt" | "id"> & { id?: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);

  const [selected, setSelected] = useState<string>(suppliers[0]?.id ?? "");

  const history = useMemo(() => purchases.filter((p) => p.supplierId === selected), [purchases, selected]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <Select
          label="Supplier dipilih"
          value={selected}
          onChange={setSelected}
          options={suppliers.length ? suppliers.map((s) => ({ value: s.id, label: s.name })) : [{ value: "", label: "(Belum ada supplier)" }]}
        />
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => { setEditing(null); setOpen(true); }}>
            Tambah Supplier
            <PlusIcon />
          </Button>
          {selected ? (
            <Button variant="danger" onClick={() => onDelete(selected)}>
              Hapus
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <div className="md:col-span-2 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-slate-900">Daftar Supplier</div>
            <Badge tone="blue">{suppliers.length}</Badge>
          </div>
          <div className="mt-3 grid gap-2">
            {suppliers.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelected(s.id)}
                className={cn(
                  "rounded-2xl p-3 text-left ring-1 transition",
                  selected === s.id ? "bg-slate-900 text-white ring-slate-900" : "bg-white hover:bg-slate-50 ring-slate-200"
                )}
              >
                <div className="text-sm font-extrabold">{s.name}</div>
                <div className={cn("mt-1 text-xs", selected === s.id ? "text-white/80" : "text-slate-600")}>{s.contact}</div>
                <div className={cn("mt-1 text-xs", selected === s.id ? "text-white/70" : "text-slate-500")}>{s.address}</div>
                <div className="mt-2 flex gap-2">
                  <span className={cn("inline-flex items-center rounded-full px-2 py-1 text-[11px] font-semibold", selected === s.id ? "bg-white/10" : "bg-slate-100 text-slate-700")}>ID: {s.id.slice(0, 10)}…</span>
                  <span className={cn("inline-flex items-center rounded-full px-2 py-1 text-[11px] font-semibold", selected === s.id ? "bg-white/10" : "bg-slate-100 text-slate-700")}>Transaksi: {purchases.filter((p) => p.supplierId === s.id).length}</span>
                </div>
              </button>
            ))}
            {!suppliers.length ? <div className="text-sm text-slate-600">Belum ada supplier.</div> : null}
          </div>

          <div className="mt-4">
            {selected ? (
              <Button
                variant="secondary"
                onClick={() => {
                  const s = suppliers.find((x) => x.id === selected);
                  if (!s) return;
                  setEditing(s);
                  setOpen(true);
                }}
              >
                Edit Supplier
              </Button>
            ) : null}
          </div>
        </div>

        <div className="md:col-span-3 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex items-center justify-between bg-slate-50 px-4 py-3">
            <div className="text-sm font-bold text-slate-900">Riwayat Transaksi Supplier</div>
            <div className="text-xs text-slate-600">Pembelian (obat masuk)</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs font-bold text-slate-700">
                <tr className="border-t border-slate-200">
                  <th className="px-4 py-3">Tanggal</th>
                  <th className="px-4 py-3">Faktur</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 25).map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-mono text-xs">{p.date}</td>
                    <td className="px-4 py-3 font-mono text-xs">{p.invoiceNo}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{p.quantity}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{formatIDR(p.total)}</td>
                  </tr>
                ))}
                {!history.length ? (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-600">Belum ada transaksi untuk supplier ini.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <SupplierModal
        open={open}
        supplier={editing}
        onClose={() => setOpen(false)}
        onSave={(s) => {
          onUpsert(s);
          setOpen(false);
        }}
      />
    </div>
  );
}

function SupplierModal({
  open,
  supplier,
  onClose,
  onSave,
}: {
  open: boolean;
  supplier: Supplier | null;
  onClose: () => void;
  onSave: (s: Omit<Supplier, "createdAt" | "updatedAt" | "id"> & { id?: string }) => void;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [contact, setContact] = useState("");

  useEffect(() => {
    if (open) {
      setName(supplier?.name ?? "");
      setAddress(supplier?.address ?? "");
      setContact(supplier?.contact ?? "");
    }
  }, [open, supplier]);

  const can = name.trim();

  return (
    <Modal
      open={open}
      title={supplier ? "Edit Supplier" : "Tambah Supplier"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button disabled={!can} onClick={() => onSave({ id: supplier?.id, name: name.trim(), address: address.trim(), contact: contact.trim() })}>Simpan</Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Input label="Nama PBF" value={name} onChange={setName} />
        <Input label="Alamat" value={address} onChange={setAddress} />
        <Input label="Kontak" value={contact} onChange={setContact} placeholder="No. HP / Telp / Email" />
      </div>
    </Modal>
  );
}

function SettingsPage({
  settings,
  me,
  onUpdate,
  onBackup,
  onRestore,
  onFactoryReset,
}: {
  settings: Settings;
  me: User | null;
  onUpdate: (patch: Partial<Settings>) => void;
  onBackup: () => void;
  onRestore: (file: File) => void;
  onFactoryReset: () => void;
}) {
  const [pharmacyName, setPharmacyName] = useState(settings.pharmacyName);
  const [adminName, setAdminName] = useState(settings.adminName);
  const [brand, setBrand] = useState(rgbToHex(settings.themeBrandRgb));
  const [accent, setAccent] = useState(rgbToHex(settings.themeAccentRgb));
  const [layout, setLayout] = useState<Settings["layout"]>(settings.layout);
  const [receiptFooter, setReceiptFooter] = useState(settings.receiptFooter);
  const [paper, setPaper] = useState(settings.printer.paper);
  const [showLogo, setShowLogo] = useState(settings.printer.showLogo);

  useEffect(() => {
    setPharmacyName(settings.pharmacyName);
    setAdminName(settings.adminName);
    setBrand(rgbToHex(settings.themeBrandRgb));
    setAccent(rgbToHex(settings.themeAccentRgb));
    setLayout(settings.layout);
    setReceiptFooter(settings.receiptFooter);
    setPaper(settings.printer.paper);
    setShowLogo(settings.printer.showLogo);
  }, [settings]);

  const fileRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="grid gap-4">
      <Card className="p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Pengaturan Sistem</div>
            <div className="mt-1 text-sm text-slate-600">Ubah identitas apotek, tema warna, layout, dan printer/struk.</div>
          </div>
          <Badge tone="blue">User: {me?.role ?? "-"}</Badge>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="grid gap-3">
            <Input label="Ubah nama apotek" value={pharmacyName} onChange={setPharmacyName} />
            <Input label="Ubah nama admin" value={adminName} onChange={setAdminName} />

            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Tema warna utama</div>
                <input type="color" value={brand} onChange={(e) => setBrand(e.target.value)} className="h-11 w-full rounded-xl bg-white ring-1 ring-slate-200" />
                <div className="mt-1 text-xs text-slate-500">RGB: {hexToRgbTriplet(brand)}</div>
              </label>
              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Tema warna aksen</div>
                <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="h-11 w-full rounded-xl bg-white ring-1 ring-slate-200" />
                <div className="mt-1 text-xs text-slate-500">RGB: {hexToRgbTriplet(accent)}</div>
              </label>
            </div>

            <Select
              label="Tampilan (layout/display)"
              value={layout}
              onChange={(v) => setLayout(v as any)}
              options={[
                { value: "Comfort", label: "Comfort" },
                { value: "Compact", label: "Compact" },
              ]}
            />

            <Input label="Footer struk" value={receiptFooter} onChange={setReceiptFooter} placeholder="Terima kasih..." />
          </div>

          <div className="grid gap-3">
            <Select
              label="Pengaturan printer & struk (kertas)"
              value={paper}
              onChange={(v) => setPaper(v as any)}
              options={[
                { value: "58mm", label: "58mm (receipt)" },
                { value: "80mm", label: "80mm (receipt)" },
                { value: "A4", label: "A4" },
              ]}
            />
            <label className="flex items-center justify-between rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
              <div>
                <div className="text-sm font-bold text-slate-900">Tampilkan logo pada struk</div>
                <div className="mt-1 text-sm text-slate-600">(Demo) Kontrol tampilan header</div>
              </div>
              <input type="checkbox" checked={showLogo} onChange={(e) => setShowLogo(e.target.checked)} className="h-5 w-5" />
            </label>

            <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <div className="text-sm font-bold text-slate-900">Backup Data</div>
              <div className="mt-1 text-sm text-slate-600">Export/restore seluruh data (JSON) untuk backup manual.</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={onBackup}>Export Backup</Button>
                <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onRestore(f); e.currentTarget.value = ""; }} />
                <Button variant="secondary" onClick={() => fileRef.current?.click()}>Restore Backup</Button>
              </div>
            </div>

            <div className="rounded-2xl bg-rose-50 p-4 ring-1 ring-rose-200">
              <div className="text-sm font-bold text-rose-900">Factory Reset</div>
              <div className="mt-1 text-sm text-rose-800">Menghapus semua data local (kembali ke seed: admin/admin123).</div>
              <div className="mt-3">
                <Button variant="danger" onClick={onFactoryReset}>Reset Data</Button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button
            onClick={() =>
              onUpdate({
                pharmacyName: pharmacyName.trim() || "Doors Pharmacy",
                adminName: adminName.trim() || "Admin",
                themeBrandRgb: hexToRgbTriplet(brand),
                themeAccentRgb: hexToRgbTriplet(accent),
                layout,
                receiptFooter: receiptFooter,
                printer: { paper, showLogo },
              })
            }
          >
            Simpan Pengaturan
            <CheckIcon />
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <div className="text-sm font-bold text-slate-900">Integrasi Lanjutan</div>
        <div className="mt-2 text-sm text-slate-600">
          Saat backend sudah tersedia (REST API + database), pengaturan ini bisa disimpan per organisasi,
          termasuk integrasi WhatsApp, backup otomatis, dan audit log server-side.
        </div>
      </Card>
    </div>
  );
}

function ShiftPage({
  shifts,
  onUpsert,
  onDelete,
}: {
  shifts: Shift[];
  onUpsert: (s: Omit<Shift, "createdAt" | "updatedAt" | "id"> & { id?: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Shift | null>(null);

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-extrabold text-slate-900">Manajemen Shift</div>
          <div className="mt-1 text-sm text-slate-600">Kelola PSA, APJ, TTK, jadwal, masa berlaku SIPA, dan izin SIA.</div>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          Tambah Shift
          <PlusIcon />
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {shifts.map((s) => (
          <div key={s.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-extrabold text-slate-900">PSA: {s.psaName}</div>
                <div className="mt-1 text-sm text-slate-600">APJ: {s.apjName} • TTK: {s.ttkName}</div>
                <div className="mt-2 text-xs text-slate-600">Jadwal: {s.schedule}</div>
                <div className="mt-1 text-xs text-slate-600">SIPA valid: <span className="font-mono">{s.sipaValidUntil}</span> • Izin SIA: <span className="font-mono">{s.siaPermit}</span></div>
              </div>
              <div className="flex flex-col gap-2">
                <Button size="sm" variant="secondary" onClick={() => { setEditing(s); setOpen(true); }}>Edit</Button>
                <Button size="sm" variant="danger" onClick={() => onDelete(s.id)}>Hapus</Button>
              </div>
            </div>
          </div>
        ))}
        {!shifts.length ? (
          <Card className="p-5 md:col-span-2">
            <div className="text-sm font-semibold text-slate-700">Belum ada data shift.</div>
            <div className="mt-1 text-sm text-slate-600">Tambahkan jadwal shift untuk kebutuhan audit & operasional.</div>
          </Card>
        ) : null}
      </div>

      <ShiftModal
        open={open}
        shift={editing}
        onClose={() => setOpen(false)}
        onSave={(s) => { onUpsert(s); setOpen(false); }}
      />
    </div>
  );
}

function ShiftModal({
  open,
  shift,
  onClose,
  onSave,
}: {
  open: boolean;
  shift: Shift | null;
  onClose: () => void;
  onSave: (s: Omit<Shift, "createdAt" | "updatedAt" | "id"> & { id?: string }) => void;
}) {
  const [psaName, setPsaName] = useState("");
  const [apjName, setApjName] = useState("");
  const [ttkName, setTtkName] = useState("");
  const [schedule, setSchedule] = useState("");
  const [sipaValidUntil, setSipaValidUntil] = useState(todayISO());
  const [siaPermit, setSiaPermit] = useState("");

  useEffect(() => {
    if (open) {
      setPsaName(shift?.psaName ?? "");
      setApjName(shift?.apjName ?? "");
      setTtkName(shift?.ttkName ?? "");
      setSchedule(shift?.schedule ?? "Pagi: 08:00-16:00, Sore: 16:00-22:00");
      setSipaValidUntil(shift?.sipaValidUntil ?? todayISO());
      setSiaPermit(shift?.siaPermit ?? "");
    }
  }, [open, shift]);

  const can = psaName.trim() && apjName.trim();

  return (
    <Modal
      open={open}
      title={shift ? "Edit Shift" : "Tambah Shift"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button disabled={!can} onClick={() => onSave({ id: shift?.id, psaName: psaName.trim(), apjName: apjName.trim(), ttkName: ttkName.trim(), schedule: schedule.trim(), sipaValidUntil, siaPermit: siaPermit.trim() })}>Simpan</Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Input label="Nama PSA" value={psaName} onChange={setPsaName} />
        <Input label="Nama Apoteker Penanggung Jawab" value={apjName} onChange={setApjName} />
        <Input label="Nama TTK" value={ttkName} onChange={setTtkName} />
        <Input label="Jadwal shift" value={schedule} onChange={setSchedule} hint="Format bebas (contoh: Pagi/Sore)" />
        <label className="block">
          <div className="mb-1 text-xs font-semibold text-slate-700">SIPA (masa berlaku)</div>
          <input type="date" value={sipaValidUntil} onChange={(e) => setSipaValidUntil(e.target.value)} className="w-full rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-slate-200 outline-none transition focus:ring-2 focus:ring-[rgb(var(--ring))]" />
        </label>
        <Input label="Izin SIA" value={siaPermit} onChange={setSiaPermit} />
      </div>
    </Modal>
  );
}

function InfoPage({ settings }: { settings: Settings }) {
  return (
    <div className="grid gap-4">
      <Card className="p-5">
        <div className="text-sm font-extrabold text-slate-900">Informasi</div>
        <div className="mt-1 text-sm text-slate-600">Contact, alamat apotek, FAQ, dan kerja sama.</div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <div className="text-sm font-bold text-slate-900">Kontak</div>
            <div className="mt-2 text-sm text-slate-700">
              Email: <b>support@doorspharmacy.local</b>
              <div className="mt-1">WhatsApp: <b>+62 812-0000-0000</b></div>
            </div>
          </div>
          <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <div className="text-sm font-bold text-slate-900">Alamat</div>
            <div className="mt-2 text-sm text-slate-700">Jl. Contoh No. 123, Indonesia</div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
          <div className="text-sm font-bold text-slate-900">FAQ</div>
          <div className="mt-3 grid gap-3 text-sm text-slate-700">
            <FAQ q="Apakah data tersimpan permanen?" a="Pada demo ini, data tersimpan di LocalStorage browser. Untuk produksi, gunakan database + backend." />
            <FAQ q="Bisa export PDF/Excel?" a="Bisa via Print (Save as PDF) dan export CSV untuk dibuka di Excel." />
            <FAQ q="Bisa multi-user?" a="Bisa (demo). Role tersedia: Admin/Apoteker/Kasir. Pengaturan akses bisa dikembangkan." />
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <div className="text-sm font-bold text-slate-900">Kerja Sama</div>
          <div className="mt-2 text-sm text-slate-700">Hubungi email support untuk integrasi API, POS, barcode scanner, atau migrasi data.</div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="text-sm font-bold text-slate-900">Identitas Sistem</div>
        <div className="mt-2 text-sm text-slate-700">Nama Apotek: <b>{settings.pharmacyName}</b></div>
      </Card>
    </div>
  );
}

function FAQ({ q, a }: { q: string; a: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
      <div className="text-sm font-bold text-slate-900">{q}</div>
      <div className="mt-1 text-sm text-slate-600">{a}</div>
    </div>
  );
}

function AuditPage({ logs, users }: { logs: AuditLog[]; users: User[] }) {
  return (
    <div className="grid gap-4">
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Audit Log Aktivitas</div>
            <div className="mt-1 text-sm text-slate-600">Pencatatan aksi pengguna (demo lokal).</div>
          </div>
          <Badge tone="blue">{logs.length} events</Badge>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl ring-1 ring-slate-200">
          <div className="overflow-x-auto bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-bold text-slate-700">
                <tr>
                  <th className="px-4 py-3">Waktu</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Aksi</th>
                  <th className="px-4 py-3">Detail</th>
                </tr>
              </thead>
              <tbody>
                {logs.slice(0, 100).map((l) => {
                  const u = users.find((u) => u.id === l.userId);
                  return (
                    <tr key={l.id} className="border-t border-slate-100">
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{new Date(l.at).toLocaleString("id-ID")}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-slate-900">{u?.fullName ?? "-"}</td>
                      <td className="px-4 py-3"><Badge tone="slate">{l.action}</Badge></td>
                      <td className="px-4 py-3 text-sm text-slate-700">{l.detail ?? ""}</td>
                    </tr>
                  );
                })}
                {!logs.length ? (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-600">Belum ada log.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ------- helpers (color + html escape) -------

function hexToRgbTriplet(hex: string) {
  const h = hex.replace("#", "").trim();
  if (h.length !== 6) return "16 185 129";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

function rgbToHex(triplet: string) {
  const [r, g, b] = triplet.split(/\s+/).map((n) => clamp(Number(n) || 0, 0, 255));
  const to = (n: number) => n.toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ------- icons -------

function IconBase({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <IconBase>
      <path d="M5 12h12" />
      <path d="M13 6l6 6-6 6" />
    </IconBase>
  );
}

function XIcon() {
  return (
    <IconBase>
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </IconBase>
  );
}

function MenuIcon() {
  return (
    <IconBase>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </IconBase>
  );
}

function HomeIcon() {
  return (
    <IconBase>
      <path d="M3 10.5L12 3l9 7.5" />
      <path d="M5 10v10h14V10" />
    </IconBase>
  );
}

function PillsIcon() {
  return (
    <IconBase>
      <path d="M10 14l7-7" />
      <path d="M14 3l7 7" />
      <path d="M14 3l-7 7a5 5 0 007 7l7-7" />
      <path d="M6 14l4 4" />
    </IconBase>
  );
}

function ArrowDownIcon() {
  return (
    <IconBase>
      <path d="M12 3v14" />
      <path d="M7 12l5 5 5-5" />
      <path d="M5 21h14" />
    </IconBase>
  );
}

function ArrowUpIcon() {
  return (
    <IconBase>
      <path d="M12 21V7" />
      <path d="M7 12l5-5 5 5" />
      <path d="M5 3h14" />
    </IconBase>
  );
}

function FileIcon() {
  return (
    <IconBase>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8" />
      <path d="M8 17h8" />
    </IconBase>
  );
}

function ReportIcon() {
  return (
    <IconBase>
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="M8 17V9" />
      <path d="M12 17V7" />
      <path d="M16 17v-5" />
    </IconBase>
  );
}

function WalletIcon() {
  return (
    <IconBase>
      <path d="M3 7h18v12H3z" />
      <path d="M3 7l2-3h14l2 3" />
      <path d="M17 13h.01" />
    </IconBase>
  );
}

function TruckIcon() {
  return (
    <IconBase>
      <path d="M3 7h11v10H3z" />
      <path d="M14 10h4l3 3v4h-7" />
      <path d="M7 17a2 2 0 104 0" />
      <path d="M15 17a2 2 0 104 0" />
    </IconBase>
  );
}

function SettingsIcon() {
  return (
    <IconBase>
      <path d="M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z" />
      <path d="M19.4 15a1.8 1.8 0 00.34 1.98l.03.03-1.6 2.77-.04-.02a1.8 1.8 0 00-2.12.5 1.8 1.8 0 00-.5 2.12l.02.04-2.77 1.6-.03-.03A1.8 1.8 0 0015 19.4a1.8 1.8 0 00-1.98.34l-.04.03-2.77-1.6.02-.04a1.8 1.8 0 00-.5-2.12 1.8 1.8 0 00-2.12-.5l-.04.02-1.6-2.77.03-.03A1.8 1.8 0 004.6 9a1.8 1.8 0 00-.34-1.98l-.03-.03 1.6-2.77.04.02a1.8 1.8 0 002.12-.5 1.8 1.8 0 00.5-2.12l-.02-.04L11.2.98l.03.03A1.8 1.8 0 0012 4.6a1.8 1.8 0 001.98-.34l.04-.03 2.77 1.6-.02.04a1.8 1.8 0 00.5 2.12 1.8 1.8 0 002.12.5l.04-.02 1.6 2.77-.03.03A1.8 1.8 0 0019.4 15z" />
    </IconBase>
  );
}

function CalendarIcon() {
  return (
    <IconBase>
      <path d="M7 3v3" />
      <path d="M17 3v3" />
      <path d="M4 7h16" />
      <path d="M5 5h14a2 2 0 012 2v13a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" />
    </IconBase>
  );
}

function InfoIcon() {
  return (
    <IconBase>
      <path d="M12 22a10 10 0 100-20 10 10 0 000 20z" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </IconBase>
  );
}

function ShieldIcon() {
  return (
    <IconBase>
      <path d="M12 2l8 4v6c0 5-3.5 9.5-8 10-4.5-.5-8-5-8-10V6l8-4z" />
      <path d="M9 12l2 2 4-4" />
    </IconBase>
  );
}

function PlusIcon() {
  return (
    <IconBase>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </IconBase>
  );
}

function PrinterIcon() {
  return (
    <IconBase>
      <path d="M6 9V4h12v5" />
      <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
      <path d="M6 14h12v6H6z" />
    </IconBase>
  );
}

function CheckIcon() {
  return (
    <IconBase>
      <path d="M20 6L9 17l-5-5" />
    </IconBase>
  );
}
