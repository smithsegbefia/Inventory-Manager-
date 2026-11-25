# Stockwise Inventory Manager

A responsive inventory and sales application for small businesses. The project includes a Django REST API and a React/TypeScript web client. PostgreSQL is supported through `DATABASE_URL`; SQLite is the zero-configuration local development default. Currency defaults to GHS and tax is configured per business.

## What works today

- Business registration and token-based login/logout.
- Business-scoped products, categories, suppliers, customers, warehouses, expenses and stock movement records.
- Stock-in, stock-out and absolute quantity adjustments; the database enforces non-negative stock.
- Completed cash, mobile-money and bank sales; catalog prices/tax are used by the API and stock is deducted atomically.
- Purchase orders with receive action; quantities update only when the order is received.
- Database-backed dashboard totals, seven-day sales chart and low-stock alerts.
- Searchable operational tables and CSV export in the browser.
- Responsive navigation, forms, validation feedback and confirmation dialogs.

Authentication uses Django password hashing and DRF token authentication. All business records are scoped to the authenticated user's business, and write permissions are restricted by role. The API uses database transactions and row-level locks for inventory changes; use PostgreSQL in production for concurrent stock guarantees. Owners can configure business details, currency and tax from Settings in the web client or Django admin.

## Local development

### API

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver 127.0.0.1:8001
```

The API is available at `http://127.0.0.1:8001/api/`. Open `http://127.0.0.1:8001/admin/` to manage business records and tax configuration. For a first workspace, use the registration form in the web client; it provisions a business and main warehouse.

To populate an empty registered business with realistic local demo records, run:

```powershell
python manage.py seed_demo --email owner@example.com
```

The command refuses to run if the business already has products, avoiding duplicate demo entries.

### Web client

In another terminal:

```powershell
cd frontend
npm install
npm run dev
```

The Vite development server proxies `/api` to Django at `http://127.0.0.1:8001`, avoiding local CORS and port conflicts. Copy `frontend/.env.example` to `frontend/.env` and change `VITE_API_PROXY_TARGET` if Django runs elsewhere. Set `VITE_API_URL` to an absolute API URL when deploying the frontend separately. To create a production build, run `npm run build`.

### PostgreSQL

Copy `.env.example` to `.env` and set `DATABASE_URL`, `DJANGO_SECRET_KEY`, `DJANGO_DEBUG`, and production hosts/origins. Django loads the root `.env` file automatically. For local SQLite development, no database configuration is required. Do not use the example secret or `DEBUG=true` in production.

## Tests

```powershell
cd backend
python manage.py test inventory
```

Tests cover stock movement persistence and zero adjustments, out-of-stock sale rejection and catalog pricing, purchase receipt/idempotence, role restrictions, and seeded dashboard data.

## API outline

- `POST /api/auth/register/`, `POST /api/auth/login/`, `POST /api/auth/logout/`
- `GET /api/dashboard/`, `GET/PATCH /api/business/` (business settings; PATCH is owner-only)
- Standard list/create/detail endpoints under `/api/products/`, `/categories/`, `/suppliers/`, `/customers/`, `/warehouses/`, `/stock-movements/`, `/sales/`, `/purchases/`, `/expenses/`
- `POST /api/purchases/{id}/receive/` receives a purchase order and applies inventory changes.

All endpoints other than registration and login require an authenticated token (`Authorization: Token <key>`).
