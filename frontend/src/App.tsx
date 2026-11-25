import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity, AlertTriangle, ArrowDownToLine, ArrowLeftRight, ArrowUpRight, BarChart3,
  Bell, Boxes, BriefcaseBusiness, Check, ChevronDown, ChevronLeft, ChevronRight,
  CircleDollarSign, ClipboardList, CreditCard, Download, FileText, LayoutDashboard,
  LogOut, Menu, Package, Plus, Search, Settings, ShoppingBag, ShoppingCart,
  Truck, Users, Warehouse, X,
} from "lucide-react";

const API = import.meta.env.VITE_API_URL ?? "/api";
const SalesChart = lazy(() => import("./SalesChart"));
type AnyRecord = Record<string, any>;
type PageKey = "dashboard" | "products" | "stock" | "sales" | "purchases" | "suppliers" | "customers" | "expenses" | "reports" | "settings";
type DashboardData = {
  metrics: Record<string, number>;
  monthly_revenue: number;
  sales_chart: { label: string; sales: number }[];
  low_stock_products: AnyRecord[];
  recent_sales: AnyRecord[];
  recent_products: AnyRecord[];
};
type Product = { id: number; name: string; sku: string; stock: number; selling_price: string; purchase_price: string; minimum_stock: number; category?: number | null; category_name?: string; barcode?: string; description?: string; image_url?: string; is_archived?: boolean };
type UserSession = { token: string; user: string; business: string; role?: string };
type BusinessSettings = { id: number; name: string; phone: string; address: string; currency: string; tax_rate: string };

let activeCurrency = "GHS";
const money = (value: number | string | null | undefined) =>
  new Intl.NumberFormat("en-GH", { style: "currency", currency: activeCurrency, maximumFractionDigits: 2 }).format(Number(value ?? 0));

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${token}`,
        ...init?.headers,
      },
    });
  } catch {
    throw new Error(`Cannot reach the Inventory API at ${API}. Start the Django API server and check the API URL/proxy configuration.`);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = typeof body === "string" ? body : Object.values(body).flat().join(" ");
    throw new Error(message || `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const navGroups: { label: string; items: { key: PageKey; label: string; icon: typeof Package }[] }[] = [
  { label: "WORKSPACE", items: [{ key: "dashboard", label: "Overview", icon: LayoutDashboard }, { key: "products", label: "Products", icon: Package }, { key: "stock", label: "Stock control", icon: ArrowLeftRight }] },
  { label: "OPERATIONS", items: [{ key: "sales", label: "Sales", icon: ShoppingCart }, { key: "purchases", label: "Purchases", icon: ShoppingBag }, { key: "suppliers", label: "Suppliers", icon: Truck }, { key: "customers", label: "Customers", icon: Users }, { key: "expenses", label: "Expenses", icon: CreditCard }] },
  { label: "INSIGHTS", items: [{ key: "reports", label: "Reports", icon: BarChart3 }] },
];

export default function App() {
  const [session, setSession] = useState<UserSession | null>(() => {
    const stored = localStorage.getItem("stockwise-session");
    return stored ? JSON.parse(stored) as UserSession : null;
  });
  const [page, setPage] = useState<PageKey>("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<AnyRecord[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<AnyRecord[]>([]);
  const [customers, setCustomers] = useState<AnyRecord[]>([]);
  const [suppliers, setSuppliers] = useState<AnyRecord[]>([]);
  const [businessSettings, setBusinessSettings] = useState<BusinessSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [modal, setModal] = useState<"product" | "product-edit" | "stock" | "sale" | "purchase" | "supplier" | "customer" | "expense" | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [mobileNav, setMobileNav] = useState(false);

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError("");
    try {
      const [dashboardData, productData, warehouseData, customerData, supplierData, settingsData] = await Promise.all([
        api<DashboardData>("/dashboard/", session.token),
        api<Product[]>("/products/", session.token),
        api<AnyRecord[]>("/warehouses/", session.token),
        api<AnyRecord[]>("/customers/", session.token),
        api<AnyRecord[]>("/suppliers/", session.token),
        api<BusinessSettings>("/business/", session.token),
      ]);
      setDashboard(dashboardData);
      setProducts(productData);
      setWarehouses(warehouseData);
      setCustomers(customerData);
      setSuppliers(supplierData);
      setBusinessSettings(settingsData);
      activeCurrency = settingsData.currency || "GHS";
      const endpoint: Record<Exclude<PageKey, "settings">, string> = {
        dashboard: "", products: "/products/", stock: "/stock-movements/", sales: "/sales/",
        purchases: "/purchases/", suppliers: "/suppliers/", customers: "/customers/",
        expenses: "/expenses/", reports: "/sales/",
      };
      if (page !== "dashboard" && page !== "settings") setData(await api<AnyRecord[]>(endpoint[page], session.token));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load your workspace.");
    } finally {
      setLoading(false);
    }
  }, [session, page]);

  useEffect(() => { void refresh(); }, [refresh]);

  const logout = async () => {
    if (session) {
      try { await api("/auth/logout/", session.token, { method: "POST" }); } catch { /* Local sign-out still completes. */ }
    }
    localStorage.removeItem("stockwise-session");
    setSession(null);
  };

  const createRecord = async (endpoint: string, body: AnyRecord, message: string, method = "POST") => {
    if (!session) return;
    setError("");
    try {
      await api(endpoint, session.token, { method, body: JSON.stringify(body) });
      setModal(null);
      setSuccess(message);
      window.setTimeout(() => setSuccess(""), 3000);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The record could not be saved.");
    }
  };

  const searchResults = useMemo(() => {
    if (!query.trim()) return data;
    const needle = query.toLowerCase();
    return data.filter((record) => Object.values(record).some((value) =>
      typeof value === "string" && value.toLowerCase().includes(needle)));
  }, [data, query]);

  if (!session) return <Login onLogin={(next) => {
    localStorage.setItem("stockwise-session", JSON.stringify(next));
    setSession(next);
  }} />;

  const pageTitle = page === "settings" ? "Settings" : navGroups.flatMap((group) => group.items).find((item) => item.key === page)?.label ?? "Overview";
  return (
    <div className="app-shell">
      {mobileNav && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${collapsed ? "sidebar-collapsed" : ""} ${mobileNav ? "sidebar-mobile-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><Boxes size={21} /></div>
          {!collapsed && <div><strong>stockwise</strong><span>INVENTORY CLOUD</span></div>}
          <button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
        <div className="business-switch"><div className="business-avatar">{session.business.slice(0, 1).toUpperCase()}</div>{!collapsed && <><div className="business-copy"><strong>{session.business}</strong><span>Business workspace</span></div><ChevronDown size={15} /></>}</div>
        <nav className="side-nav">
          {navGroups.map((group) => <div className="nav-group" key={group.label}>
            {!collapsed && <div className="nav-heading">{group.label}</div>}
            {group.items.map(({ key, label, icon: Icon }) => <button key={key} className={`nav-item ${page === key ? "active" : ""}`} onClick={() => { setPage(key); setQuery(""); setMobileNav(false); }}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>{key === "stock" && dashboard?.metrics.low_stock ? <i className="nav-alert">{dashboard.metrics.low_stock}</i> : null}
            </button>)}
          </div>)}
        </nav>
        <div className="sidebar-bottom">
          <button className={`nav-item ${page === "settings" ? "active" : ""}`} onClick={() => { setPage("settings"); setMobileNav(false); }}><Settings size={18} /><span>Settings</span></button>
          <div className="profile-card"><div className="profile-avatar">{session.user.slice(0, 1).toUpperCase()}</div>{!collapsed && <div className="profile-copy"><strong>{session.user}</strong><span>{session.role?.replace("_", " ") ?? "Business owner"}</span></div>}<button aria-label="Sign out" className="logout-button" onClick={() => void logout()}><LogOut size={16} /></button></div>
        </div>
        <button className="collapse-button" aria-label="Toggle sidebar" onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</button>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left"><button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={20} /></button><div className="breadcrumb">Workspace <ChevronRight size={14} /> <strong>{pageTitle}</strong></div></div>
          <div className="topbar-actions"><div className="date-chip"><span className="live-dot" />Live data</div><button className="icon-button notification-button" aria-label="View stock alerts" onClick={() => setPage("stock")}><Bell size={18} /><i /></button><div className="top-avatar">{session.user.slice(0, 1).toUpperCase()}</div></div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div><div className="eyebrow">{new Intl.DateTimeFormat("en-GH", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date())}</div><h1>{page === "dashboard" ? "Good morning" : pageTitle}<span>{page === "dashboard" ? `, ${session.user.split(" ")[0]}` : ""}</span></h1><p>{page === "dashboard" ? "Here’s what’s happening with your business today." : `Manage and review your ${pageTitle.toLowerCase()} in one place.`}</p></div>
            <div className="heading-actions">
              {page !== "dashboard" && <button className="button button-outline" onClick={() => void refresh()}><Activity size={16} /> Refresh</button>}
              {page !== "dashboard" && canCreateFor(page, session.role) && actionFor(page) && <button className="button button-primary" onClick={() => { setSelectedProduct(null); setModal(actionFor(page)); }}><Plus size={17} />{createLabel(page)}</button>}
            </div>
          </div>
          {error && <div className="alert alert-error"><AlertTriangle size={17} /><span>{error}</span><button onClick={() => setError("")}><X size={16} /></button></div>}
          {success && <div className="alert alert-success"><Check size={17} /><span>{success}</span><button onClick={() => setSuccess("")}><X size={16} /></button></div>}
          {loading && !dashboard && <div className="loading-state"><div className="spinner" />Loading your workspace…</div>}
          {page === "dashboard" && dashboard && <Dashboard dashboard={dashboard} onNavigate={setPage} />}
          {page === "settings" && businessSettings && <SettingsPanel settings={businessSettings} canEdit={session.role === "owner" || !session.role} token={session.token} onError={setError} onSuccess={setSuccess} onChanged={refresh} />}
          {page !== "dashboard" && page !== "settings" && <DataPage page={page} records={searchResults} query={query} setQuery={setQuery} loading={loading} token={session.token} canManageProducts={session.role === "owner" || session.role === "inventory_manager" || !session.role} onEditProduct={(product) => { setSelectedProduct(product); setModal("product-edit"); }} onChanged={refresh} onError={setError} onSuccess={setSuccess} />}
        </div>
      </main>
      {modal && <Modal title={modalTitle(modal)} onClose={() => setModal(null)}>
        {(modal === "product" || modal === "product-edit") && <ProductForm token={session.token} initial={modal === "product-edit" ? selectedProduct : null} onSubmit={(body) => createRecord(modal === "product-edit" && selectedProduct ? `/products/${selectedProduct.id}/` : "/products/", body, modal === "product-edit" ? "Product updated successfully." : "Product added successfully.", modal === "product-edit" ? "PATCH" : "POST")} onCancel={() => setModal(null)} />}
        {modal === "stock" && <StockForm products={products} warehouses={warehouses} onSubmit={(body) => createRecord("/stock-movements/", body, "Stock movement recorded.")} onCancel={() => setModal(null)} />}
        {modal === "sale" && <OrderForm kind="sale" products={products} warehouses={warehouses} contacts={customers} onSubmit={(body) => createRecord("/sales/", body, "Sale recorded and stock updated.")} onCancel={() => setModal(null)} />}
        {modal === "purchase" && <OrderForm kind="purchase" products={products} warehouses={warehouses} contacts={suppliers} onSubmit={(body) => createRecord("/purchases/", body, "Purchase order created.")} onCancel={() => setModal(null)} />}
        {modal === "supplier" && <ContactForm type="supplier" onSubmit={(body) => createRecord("/suppliers/", body, "Supplier added successfully.")} onCancel={() => setModal(null)} />}
        {modal === "customer" && <ContactForm type="customer" onSubmit={(body) => createRecord("/customers/", body, "Customer added successfully.")} onCancel={() => setModal(null)} />}
        {modal === "expense" && <ExpenseForm onSubmit={(body) => createRecord("/expenses/", body, "Expense recorded.")} onCancel={() => setModal(null)} />}
      </Modal>}
    </div>
  );
}

function actionFor(page: PageKey): "product" | "stock" | "sale" | "purchase" | "supplier" | "customer" | "expense" | null {
  const mapping: Partial<Record<PageKey, "product" | "stock" | "sale" | "purchase" | "supplier" | "customer" | "expense">> = {
    products: "product", stock: "stock", sales: "sale", purchases: "purchase",
    suppliers: "supplier", customers: "customer", expenses: "expense",
  };
  return mapping[page] ?? null;
}
function canCreateFor(page: PageKey, role?: string) {
  if (!role || role === "owner") return true;
  const permissions: Record<string, PageKey[]> = {
    inventory_manager: ["products", "stock", "purchases", "suppliers"],
    sales_attendant: ["sales", "customers"],
    accountant: ["expenses"],
  };
  return permissions[role]?.includes(page) ?? false;
}
function createLabel(page: PageKey) { return ({ products: "Add product", stock: "Record movement", sales: "New sale", purchases: "New purchase", suppliers: "Add supplier", customers: "Add customer", expenses: "Add expense" } as Partial<Record<PageKey, string>>)[page] ?? "Create"; }
function modalTitle(modal: string) { return ({ product: "Add a product", "product-edit": "Edit product", stock: "Record stock movement", sale: "Record a sale", purchase: "Create purchase order", supplier: "Add a supplier", customer: "Add a customer", expense: "Record an expense" } as Record<string, string>)[modal]; }

function Dashboard({ dashboard, onNavigate }: { dashboard: DashboardData; onNavigate: (page: PageKey) => void }) {
  const stats = [
    { label: "Total products", value: dashboard.metrics.products, icon: Package, tone: "blue", footer: "Active in your catalogue" },
    { label: "Inventory value", value: money(dashboard.metrics.stock_value), icon: Boxes, tone: "purple", footer: "At purchase cost" },
    { label: "Total sales", value: money(dashboard.metrics.sales), icon: CircleDollarSign, tone: "green", footer: "All-time completed sales" },
    { label: "Purchases", value: money(dashboard.metrics.purchases), icon: ShoppingBag, tone: "orange", footer: "All purchase orders" },
  ];
  return <>
    <section className="metric-grid">{stats.map(({ label, value, icon: Icon, tone, footer }) => <article className="metric-card" key={label}>
      <div className="metric-top"><span>{label}</span><div className={`metric-icon ${tone}`}><Icon size={18} /></div></div><div className="metric-value">{value}</div><div className="metric-footer"><span className="trend"><ArrowUpRight size={13} /> Live</span>{footer}</div>
    </article>)}</section>
    <section className="dashboard-grid">
      <article className="panel chart-panel"><div className="panel-heading"><div><h2>Sales overview</h2><p>Revenue from the last 7 days</p></div><span className="period-tag">This week <ChevronDown size={13} /></span></div>
        <div className="chart-total">{money(dashboard.sales_chart.reduce((total, point) => total + point.sales, 0))}<span><i className="legend-dot" /> Sales revenue</span></div>
        <div className="chart-area"><Suspense fallback={<div className="loading-state"><div className="spinner" />Loading sales chart…</div>}><SalesChart data={dashboard.sales_chart} formatMoney={money} /></Suspense></div>
      </article>
      <article className="panel side-metrics"><div className="panel-heading"><div><h2>Stock health</h2><p>Inventory at a glance</p></div><div className="health-mark"><Warehouse size={18} /></div></div>
        <div className="health-total">{dashboard.metrics.products}<span>tracked products</span></div>
        <div className="health-row"><div className="health-icon low"><AlertTriangle size={15} /></div><div className="health-label"><strong>Low stock</strong><span>At or below minimum</span></div><b>{dashboard.metrics.low_stock}</b></div>
        <div className="health-row"><div className="health-icon out"><Package size={15} /></div><div className="health-label"><strong>Out of stock</strong><span>Needs replenishment</span></div><b>{dashboard.metrics.out_of_stock}</b></div>
        <button className="text-link" onClick={() => onNavigate("stock")}>Review stock levels <ChevronRight size={14} /></button>
      </article>
    </section>
    <section className="dashboard-grid lower-grid">
      <article className="panel table-panel"><div className="panel-heading"><div><h2>Low stock alerts</h2><p>Products that need attention</p></div><button className="text-link" onClick={() => onNavigate("products")}>View products <ChevronRight size={14} /></button></div>
        {dashboard.low_stock_products.length ? <div className="compact-list">{dashboard.low_stock_products.slice(0, 5).map((product) => <div className="compact-row" key={product.id}><div className="product-placeholder"><Package size={17} /></div><div className="row-product"><strong>{product.name}</strong><span>SKU {product.sku}</span></div><span className="stock-warning">{product.stock} left</span><span className="min-label">Min. {product.minimum_stock}</span></div>)}</div> : <EmptyState icon={<Check size={20} />} title="Stock levels look good" detail="No items currently need replenishment." />}
      </article>
      <article className="panel table-panel"><div className="panel-heading"><div><h2>Recent sales</h2><p>Your latest transactions</p></div><button className="text-link" onClick={() => onNavigate("sales")}>View sales <ChevronRight size={14} /></button></div>
        {dashboard.recent_sales.length ? <div className="compact-list">{dashboard.recent_sales.slice(0, 5).map((sale) => <div className="compact-row" key={sale.id}><div className="sale-icon"><CircleDollarSign size={17} /></div><div className="row-product"><strong>{sale.customer_name || `Walk-in customer`}</strong><span>{new Date(sale.created_at).toLocaleDateString("en-GH")} · {sale.payment_method.replace("_", " ")}</span></div><strong className="row-amount">{money(sale.total)}</strong></div>)}</div> : <EmptyState icon={<ShoppingCart size={20} />} title="No sales yet" detail="Completed sales will appear here." />}
      </article>
    </section>
    <section className="dashboard-bottom">
      <div className="summary-banner"><div className="banner-icon"><BriefcaseBusiness size={19} /></div><div><strong>Monthly revenue</strong><span>Revenue recorded this month</span></div><b>{money(dashboard.monthly_revenue)}</b></div>
      <div className="summary-banner"><div className="banner-icon lilac"><Users size={19} /></div><div><strong>Suppliers & customers</strong><span>Your business network</span></div><b>{dashboard.metrics.suppliers} <small>suppliers</small><span className="summary-divider" />{dashboard.metrics.customers} <small>customers</small></b></div>
    </section>
  </>;
}

function DataPage({ page, records, query, setQuery, loading, token, canManageProducts, onEditProduct, onChanged, onError, onSuccess }: {
  page: Exclude<PageKey, "dashboard" | "settings">; records: AnyRecord[]; query: string; setQuery: (value: string) => void;
  loading: boolean; token: string; canManageProducts: boolean; onEditProduct: (product: Product) => void;
  onChanged: () => Promise<void>; onError: (message: string) => void; onSuccess: (message: string) => void;
}) {
  const definitions: Record<Exclude<PageKey, "dashboard" | "settings">, { title: string; columns: { key: string; label: string; render?: (row: AnyRecord) => ReactNode }[] }> = {
    products: { title: "Product catalogue", columns: [
      { key: "name", label: "Product" }, { key: "sku", label: "SKU" }, { key: "category_name", label: "Category" },
      { key: "stock", label: "Available", render: (row) => <span className={row.stock <= row.minimum_stock ? "stock-warning" : "stock-good"}>{row.stock} units</span> },
      { key: "selling_price", label: "Selling price", render: (row) => money(row.selling_price) },
      { key: "status", label: "Status", render: (row) => <span className={`status-pill ${row.stock === 0 ? "status-red" : row.stock <= row.minimum_stock ? "status-amber" : "status-green"}`}>{row.stock === 0 ? "Out of stock" : row.stock <= row.minimum_stock ? "Low stock" : "In stock"}</span> },
      { key: "actions", label: "", render: (row) => canManageProducts ? <div className="row-actions"><button className="small-action" onClick={() => onEditProduct(row as Product)}>Edit</button><button className="small-action archive-action" onClick={() => void archiveProduct(row.id, token, onChanged, onError, onSuccess)}>Archive</button></div> : null },
    ] },
    stock: { title: "Movement history", columns: [
      { key: "product_name", label: "Product" }, { key: "kind", label: "Movement", render: (row) => <span className={`movement-type ${row.kind}`}>{row.kind}</span> }, { key: "quantity", label: "Quantity" },
      { key: "reason", label: "Reason" }, { key: "warehouse_name", label: "Warehouse" }, { key: "user_name", label: "Recorded by" }, { key: "created_at", label: "Date", render: (row) => shortDate(row.created_at) },
    ] },
    sales: { title: "Sales transactions", columns: [
      { key: "id", label: "Reference", render: (row) => `SAL-${String(row.id).padStart(5, "0")}` }, { key: "customer_name", label: "Customer", render: (row) => row.customer_name || "Walk-in customer" },
      { key: "items", label: "Items", render: (row) => row.items.reduce((sum: number, item: AnyRecord) => sum + item.quantity, 0) },
      { key: "payment_method", label: "Payment", render: (row) => <span className="payment-tag">{row.payment_method.replace("_", " ")}</span> }, { key: "total", label: "Total", render: (row) => money(row.total) },
      { key: "status", label: "Status", render: (row) => <span className="status-pill status-green">{row.status}</span> }, { key: "created_at", label: "Date", render: (row) => shortDate(row.created_at) },
    ] },
    purchases: { title: "Purchase orders", columns: [
      { key: "id", label: "Reference", render: (row) => `PO-${String(row.id).padStart(5, "0")}` }, { key: "supplier_name", label: "Supplier", render: (row) => row.supplier_name || "Supplier not set" },
      { key: "items", label: "Items", render: (row) => row.items.length }, { key: "total", label: "Order value", render: (row) => money(row.total) },
      { key: "status", label: "Status", render: (row) => <span className={`status-pill ${row.status === "received" ? "status-green" : "status-amber"}`}>{row.status}</span> },
      { key: "created_at", label: "Created", render: (row) => shortDate(row.created_at) },
      { key: "receive", label: "", render: (row) => row.status !== "received" ? <button className="small-action receive-action" onClick={() => void receivePurchase(row.id, token, onChanged, onError, onSuccess)}>Receive order</button> : <span className="received-check"><Check size={14} /> Received</span> },
    ] },
    suppliers: { title: "Supplier directory", columns: [
      { key: "name", label: "Supplier" }, { key: "company", label: "Company" }, { key: "contact_person", label: "Contact person" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }, { key: "location", label: "Location" },
    ] },
    customers: { title: "Customer directory", columns: [
      { key: "name", label: "Customer" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }, { key: "address", label: "Address" }, { key: "created_at", label: "Added", render: (row) => shortDate(row.created_at) },
    ] },
    expenses: { title: "Business expenses", columns: [
      { key: "description", label: "Description" }, { key: "category", label: "Category" }, { key: "amount", label: "Amount", render: (row) => money(row.amount) }, { key: "created_at", label: "Date", render: (row) => shortDate(row.created_at) },
    ] },
    reports: { title: "Sales report · all time", columns: [
      { key: "id", label: "Reference", render: (row) => `SAL-${String(row.id).padStart(5, "0")}` }, { key: "customer_name", label: "Customer", render: (row) => row.customer_name || "Walk-in customer" },
      { key: "items", label: "Units", render: (row) => row.items.reduce((sum: number, item: AnyRecord) => sum + item.quantity, 0) },
      { key: "payment_method", label: "Payment", render: (row) => row.payment_method.replace("_", " ") }, { key: "total", label: "Revenue", render: (row) => money(row.total) }, { key: "created_at", label: "Date", render: (row) => shortDate(row.created_at) },
    ] },
  };
  const definition = definitions[page];
  const exportRows = () => {
    const columns = definition.columns.filter((column) => column.key !== "actions" && column.key !== "receive");
    const csv = [columns.map((column) => column.label).join(","), ...records.map((row) => columns.map((column) => {
      const value = column.render ? String(column.render(row)) : String(row[column.key] ?? "");
      return `"${value.replace(/"/g, '""')}"`;
    }).join(","))].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = `${page}-report.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  return <section className="panel data-panel"><div className="data-toolbar"><div><h2>{definition.title}</h2><p>{records.length} records · synced with your inventory</p></div><div className="toolbar-actions"><label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search records…" /></label><button className="button button-outline export-button" onClick={exportRows}><Download size={15} /> Export CSV</button></div></div>
    <div className="table-scroll"><table><thead><tr>{definition.columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>
      {records.map((row) => <tr key={row.id}>{definition.columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : (row[column.key] || <span className="empty-cell">—</span>)}</td>)}</tr>)}
    </tbody></table>
    {!records.length && <EmptyState icon={emptyIcon(page)} title={query ? "No matching records" : `No ${page} yet`} detail={query ? "Try a different search term." : `Add your first ${page === "stock" ? "movement" : page.slice(0, -1)} to get started.`} />}
    {loading && <div className="table-loading"><div className="spinner" />Updating records…</div>}</div>
    <div className="table-footer"><span>Showing <strong>{records.length}</strong> records</span><div className="pagination"><button aria-label="Previous page" disabled><ChevronLeft size={15} /></button><button className="current-page">1</button><button aria-label="Next page" disabled><ChevronRight size={15} /></button></div></div>
    {page === "stock" && <p className="table-note"><ArrowDownToLine size={14} /> Inventory levels can be adjusted with a stock movement. All movements are recorded against your account.</p>}
    {page === "reports" && <p className="table-note"><FileText size={14} /> Export the visible sales history to a spreadsheet-ready CSV file.</p>}
  </section>;
}

async function archiveProduct(id: number, token: string, onChanged: () => Promise<void>, onError: (message: string) => void, onSuccess: (message: string) => void) {
  if (!window.confirm("Archive this product? It will be removed from active inventory views.")) return;
  try { await api(`/products/${id}/`, token, { method: "PATCH", body: JSON.stringify({ is_archived: true }) }); onSuccess("Product archived."); await onChanged(); }
  catch (reason) { onError(reason instanceof Error ? reason.message : "Product could not be archived."); }
}
async function receivePurchase(id: number, token: string, onChanged: () => Promise<void>, onError: (message: string) => void, onSuccess: (message: string) => void) {
  if (!window.confirm("Receive all quantities in this purchase order and add them to stock?")) return;
  try { await api(`/purchases/${id}/receive/`, token, { method: "POST", body: JSON.stringify({}) }); onSuccess("Purchase received. Stock quantities have been updated."); await onChanged(); }
  catch (reason) { onError(reason instanceof Error ? reason.message : "Purchase could not be received."); }
}
function shortDate(value: string) { return value ? new Date(value).toLocaleDateString("en-GH", { day: "2-digit", month: "short", year: "numeric" }) : "—"; }
function emptyIcon(page: PageKey) { return page === "sales" ? <ShoppingCart size={20} /> : page === "products" ? <Package size={20} /> : <ClipboardList size={20} />; }
function EmptyState({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) { return <div className="empty-state"><div className="empty-icon">{icon}</div><strong>{title}</strong><span>{detail}</span></div>; }

function Login({ onLogin }: { onLogin: (session: UserSession) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true); setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      let response: Response;
      try {
        response = await fetch(`${API}/auth/${mode === "login" ? "login" : "register"}/`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values),
        });
      } catch {
        throw new Error(`Cannot reach the Inventory API at ${API}. Start the Django API server and check the API URL/proxy configuration.`);
      }
      const result = await response.json();
      if (!response.ok) throw new Error(Object.values(result).flat().join(" ") || "Could not authenticate.");
      onLogin(result as UserSession);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not authenticate."); }
    finally { setBusy(false); }
  };
  return <div className="auth-page"><div className="auth-decoration"><div className="auth-brand"><div className="brand-mark"><Boxes size={21} /></div><strong>stockwise</strong></div><div className="auth-pitch"><div className="eyebrow">INVENTORY, MADE CLEAR</div><h1>Run your business<br />with confidence.</h1><p>Know what’s in stock, what’s selling, and what needs your attention — all in one place.</p><div className="auth-proof"><div className="proof-avatars"><i>A</i><i>K</i><i>M</i><i>+</i></div><span>Built for ambitious businesses in Ghana</span></div></div><div className="auth-decoration-foot"><span>© 2025 Stockwise</span><span>Simple tools. Better decisions.</span></div></div>
    <div className="auth-form-side"><form className="auth-form" onSubmit={submit}><div className="auth-form-mark"><Boxes size={20} /></div><h2>{mode === "login" ? "Welcome back" : "Create your workspace"}</h2><p>{mode === "login" ? "Enter your details to sign in to your account." : "Get started with your business inventory."}</p>
      {mode === "register" && <><label>Business name<input name="business_name" required placeholder="e.g. Accra Trading Co." /></label><label>Your name<input name="name" required placeholder="Full name" /></label></>}
      <label>Email address<input name="email" type="email" required placeholder="you@company.com" autoComplete="email" /></label><label>Password<input name="password" type="password" required minLength={mode === "register" ? 10 : 1} placeholder="Enter your password" autoComplete={mode === "login" ? "current-password" : "new-password"} /></label>
      {error && <div className="auth-error"><AlertTriangle size={15} />{error}</div>}
      <button className="button button-primary auth-submit" disabled={busy}>{busy && <span className="spinner small" />}{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}<ChevronRight size={16} /></button>
      <div className="auth-switch">{mode === "login" ? "New to Stockwise?" : "Already have an account?"}<button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "Create an account" : "Sign in"}</button></div>
      <div className="auth-secure"><span><Check size={13} /> Secure, encrypted session</span><span>GHS · Ghana</span></div>
    </form></div>
  </div>;
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-card"><div className="modal-heading"><div><h2>{title}</h2><p>Enter the details below to continue.</p></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></div>{children}</div></div>;
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="form-field"><span>{label}</span>{children}</label>; }
function FormActions({ onCancel, submitText, disabled = false }: { onCancel: () => void; submitText: string; disabled?: boolean }) { return <div className="form-actions"><button type="button" className="button button-outline" onClick={onCancel}>Cancel</button><button className="button button-primary" type="submit" disabled={disabled}>{submitText}</button></div>; }

function SettingsPanel({ settings, canEdit, token, onError, onSuccess, onChanged }: {
  settings: BusinessSettings; canEdit: boolean; token: string;
  onError: (message: string) => void; onSuccess: (message: string) => void; onChanged: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await api("/business/", token, { method: "PATCH", body: JSON.stringify({
        name: form.get("name"), phone: form.get("phone"), address: form.get("address"),
        currency: form.get("currency"), tax_rate: form.get("tax_rate"),
      }) });
      onSuccess("Business settings saved.");
      await onChanged();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
  };
  return <section className="panel settings-panel"><div className="panel-heading"><div><h2>Business profile</h2><p>Configure your business details, display currency and tax rate.</p></div><div className="health-mark"><Settings size={17} /></div></div>
    {!canEdit && <div className="settings-notice">Only the business owner can change these settings.</div>}
    <form className="settings-form" onSubmit={(event) => void save(event)}>
      <div className="form-grid"><Field label="Business name"><input name="name" required defaultValue={settings.name} disabled={!canEdit} /></Field><Field label="Contact phone"><input name="phone" type="tel" defaultValue={settings.phone} placeholder="+233 24 000 0000" disabled={!canEdit} /></Field>
        <Field label="Currency"><select name="currency" defaultValue={settings.currency} disabled={!canEdit}><option value="GHS">GHS · Ghana cedi</option><option value="USD">USD · US dollar</option><option value="EUR">EUR · Euro</option><option value="GBP">GBP · Pound sterling</option></select></Field>
        <Field label="Tax rate (%)"><input name="tax_rate" type="number" min="0" max="100" step="0.01" defaultValue={settings.tax_rate} disabled={!canEdit} /><span className="field-note">Applied to new sales. Set to 0 when tax does not apply.</span></Field>
      </div>
      <Field label="Business address"><textarea name="address" rows={3} defaultValue={settings.address} placeholder="Street, city, region" disabled={!canEdit} /></Field>
      {canEdit && <div className="settings-footer"><span>Tax is configurable; no rate is hardcoded into sales.</span><button type="submit" className="button button-primary" disabled={saving}>{saving && <span className="spinner small" />}{saving ? "Saving…" : "Save settings"}</button></div>}
    </form>
  </section>;
}

function ProductForm({ token, initial, onSubmit, onCancel }: { token: string; initial: Product | null; onSubmit: (body: AnyRecord) => void; onCancel: () => void }) {
  const [categories, setCategories] = useState<AnyRecord[]>([]);
  useEffect(() => { void api<AnyRecord[]>("/categories/", token).then(setCategories).catch(() => setCategories([])); }, [token]);
  return <form className="modal-form" onSubmit={(event) => { event.preventDefault(); const f = new FormData(event.currentTarget); onSubmit({ name: f.get("name"), sku: f.get("sku"), barcode: f.get("barcode"), category: f.get("category") || null, description: f.get("description"), purchase_price: f.get("purchase_price"), selling_price: f.get("selling_price"), minimum_stock: f.get("minimum_stock"), image_url: f.get("image_url") }); }}>
    <div className="form-grid"><Field label="Product name"><input name="name" required placeholder="e.g. Organic shea butter" defaultValue={initial?.name} /></Field><Field label="SKU"><input name="sku" required placeholder="e.g. SHB-001" defaultValue={initial?.sku} /></Field><Field label="Barcode"><input name="barcode" placeholder="Optional barcode" defaultValue={initial?.barcode} /></Field><Field label="Category"><select name="category" defaultValue={initial?.category ?? ""}><option value="">Uncategorized</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></Field><Field label={`Purchase price (${activeCurrency})`}><input name="purchase_price" type="number" step="0.01" min="0" required defaultValue={initial?.purchase_price ?? "0"} /></Field><Field label={`Selling price (${activeCurrency})`}><input name="selling_price" type="number" step="0.01" min="0" required defaultValue={initial?.selling_price ?? "0"} /></Field><Field label="Minimum stock"><input name="minimum_stock" type="number" min="0" defaultValue={initial?.minimum_stock ?? 5} /></Field><Field label="Image URL"><input name="image_url" type="url" placeholder="https://" defaultValue={initial?.image_url} /></Field></div><Field label="Description"><textarea name="description" rows={3} placeholder="Add product details…" defaultValue={initial?.description} /></Field>{!initial && <p className="form-hint">To prevent untracked stock, new products start at zero. Record a stock-in movement to set the opening quantity.</p>}<FormActions onCancel={onCancel} submitText={initial ? "Save changes" : "Save product"} />
  </form>;
}

function StockForm({ products, warehouses, onSubmit, onCancel }: { products: Product[]; warehouses: AnyRecord[]; onSubmit: (body: AnyRecord) => void; onCancel: () => void }) {
  return <form className="modal-form" onSubmit={(event) => { event.preventDefault(); const f = new FormData(event.currentTarget); onSubmit({ product: Number(f.get("product")), warehouse: Number(f.get("warehouse")), kind: f.get("kind"), quantity: Number(f.get("quantity")), reason: f.get("reason") }); }}>
    <Field label="Product"><select name="product" required>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku} ({product.stock} on hand)</option>)}</select></Field><Field label="Warehouse"><select name="warehouse" required>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></Field>
    <div className="form-grid"><Field label="Movement type"><select name="kind"><option value="in">Stock in</option><option value="out">Stock out</option><option value="adjustment">Set exact quantity</option></select></Field><Field label="Quantity"><input name="quantity" type="number" min="1" required /></Field></div><Field label="Reason"><input name="reason" required placeholder="e.g. Opening balance, damaged goods" /></Field><FormActions onCancel={onCancel} submitText="Record movement" />
  </form>;
}

function OrderForm({ kind, products, warehouses, contacts, onSubmit, onCancel }: { kind: "sale" | "purchase"; products: Product[]; warehouses: AnyRecord[]; contacts: AnyRecord[]; onSubmit: (body: AnyRecord) => void; onCancel: () => void }) {
  const [productId, setProductId] = useState(products[0]?.id ?? 0);
  const product = products.find((item) => item.id === productId);
  const [quantity, setQuantity] = useState(1);
  const [discount, setDiscount] = useState(0);
  const amount = (Number(kind === "sale" ? product?.selling_price : product?.purchase_price) || 0) * quantity;
  const total = kind === "sale" ? Math.max(amount - discount, 0) : amount;
  return <form className="modal-form" onSubmit={(event) => {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    const item = { product: productId, quantity, unit_price: kind === "sale" ? product?.selling_price : product?.purchase_price };
    onSubmit(kind === "sale" ? { warehouse: Number(f.get("warehouse")), customer: f.get("contact") ? Number(f.get("contact")) : null, payment_method: f.get("payment_method"), discount, items: [item] } : { warehouse: Number(f.get("warehouse")), supplier: f.get("contact") ? Number(f.get("contact")) : null, items: [item] });
  }}>
    <div className="form-grid"><Field label={kind === "sale" ? "Customer" : "Supplier"}><select name="contact"><option value="">Walk-in / none selected</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></Field><Field label="Warehouse"><select name="warehouse" required>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></Field></div>
    <div className="order-items-label">ORDER ITEM</div><div className="form-grid"><Field label="Product"><select value={productId} onChange={(event) => setProductId(Number(event.target.value))} required>{products.filter((item) => kind !== "sale" || item.stock > 0).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.sku}{kind === "sale" ? ` · ${item.stock} available` : ""}</option>)}</select></Field><Field label="Quantity"><input value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value)))} type="number" min="1" max={kind === "sale" ? product?.stock : undefined} required /></Field></div>
    {!product && <div className="form-hint">{kind === "sale" ? "No in-stock products are available to sell." : "Add a product before creating a purchase order."}</div>}
    {kind === "sale" && <div className="form-grid"><Field label="Payment method"><select name="payment_method"><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="bank">Bank transfer</option></select></Field><Field label="Discount (GHS)"><input value={discount} onChange={(event) => setDiscount(Math.max(0, Number(event.target.value)))} type="number" min="0" step="0.01" /></Field></div>}
    <div className="order-total"><span>{kind === "sale" ? "Estimated total" : "Purchase total"}<small>{kind === "sale" ? "Tax is applied using business settings." : "Stock is updated when the order is received."}</small></span><strong>{money(total)}</strong></div><FormActions onCancel={onCancel} submitText={kind === "sale" ? "Complete sale" : "Create purchase"} disabled={!product} />
  </form>;
}

function ContactForm({ type, onSubmit, onCancel }: { type: "supplier" | "customer"; onSubmit: (body: AnyRecord) => void; onCancel: () => void }) {
  return <form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSubmit(Object.fromEntries(new FormData(event.currentTarget).entries())); }}>
    <div className="form-grid"><Field label="Name"><input name="name" required placeholder={type === "supplier" ? "Supplier name" : "Customer name"} /></Field>{type === "supplier" && <Field label="Company"><input name="company" placeholder="Company name" /></Field>}<Field label="Phone number"><input name="phone" type="tel" placeholder="+233 24 000 0000" /></Field><Field label="Email"><input name="email" type="email" placeholder="name@example.com" /></Field>{type === "supplier" && <><Field label="Contact person"><input name="contact_person" /></Field><Field label="Location"><input name="location" placeholder="Accra, Ghana" /></Field></>}</div><Field label="Address"><textarea name="address" rows={2} placeholder="Business address" /></Field><FormActions onCancel={onCancel} submitText={`Save ${type}`} />
  </form>;
}
function ExpenseForm({ onSubmit, onCancel }: { onSubmit: (body: AnyRecord) => void; onCancel: () => void }) {
  return <form className="modal-form" onSubmit={(event) => { event.preventDefault(); const f = new FormData(event.currentTarget); onSubmit({ description: f.get("description"), category: f.get("category"), amount: f.get("amount") }); }}>
    <Field label="Description"><input name="description" required placeholder="e.g. Delivery and transport" /></Field><div className="form-grid"><Field label="Category"><input name="category" placeholder="Transport, utilities…" /></Field><Field label={`Amount (${activeCurrency})`}><input name="amount" type="number" min="0.01" step="0.01" required /></Field></div><FormActions onCancel={onCancel} submitText="Save expense" />
  </form>;
}
