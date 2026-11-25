from decimal import Decimal
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient
from .models import Business, Category, Product, Profile, StockLevel, StockMovement, Warehouse


class InventoryWorkflowTests(TestCase):
    def setUp(self):
        self.business = Business.objects.create(name="Accra Goods")
        self.user = get_user_model().objects.create_user(username="owner@example.com", password="StrongPassword123!")
        Profile.objects.create(user=self.user, business=self.business, role="owner")
        self.warehouse = Warehouse.objects.create(business=self.business, name="Main")
        self.product = Product.objects.create(business=self.business, name="Coffee", sku="COF-1",
            purchase_price=Decimal("10.00"), selling_price=Decimal("15.00"), minimum_stock=2)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_stock_movement_updates_quantity_and_records_user(self):
        response = self.client.post("/api/stock-movements/", {
            "product": self.product.id, "warehouse": self.warehouse.id,
            "kind": "in", "quantity": 8, "reason": "Opening stock",
        }, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(StockLevel.objects.get(product=self.product).quantity, 8)
        self.assertEqual(StockMovement.objects.get().user, self.user)

    def test_adjustment_can_set_stock_to_zero(self):
        StockLevel.objects.create(product=self.product, warehouse=self.warehouse, quantity=3)
        response = self.client.post("/api/stock-movements/", {
            "product": self.product.id, "warehouse": self.warehouse.id,
            "kind": "adjustment", "quantity": 0, "reason": "Count correction",
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(StockLevel.objects.get(product=self.product).quantity, 0)

    def test_sale_rejects_insufficient_stock_without_partial_records(self):
        StockLevel.objects.create(product=self.product, warehouse=self.warehouse, quantity=1)
        response = self.client.post("/api/sales/", {
            "warehouse": self.warehouse.id, "payment_method": "cash", "discount": "0",
            "items": [{"product": self.product.id, "quantity": 2, "unit_price": "15.00"}],
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(StockLevel.objects.get(product=self.product).quantity, 1)

    def test_sale_decrements_stock_and_calculates_total_from_catalog_price(self):
        StockLevel.objects.create(product=self.product, warehouse=self.warehouse, quantity=5)
        response = self.client.post("/api/sales/", {
            "warehouse": self.warehouse.id, "payment_method": "mobile_money", "discount": "2",
            "items": [{"product": self.product.id, "quantity": 2, "unit_price": "999"}],
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(StockLevel.objects.get(product=self.product).quantity, 3)
        self.assertEqual(response.data["total"], "28.00")

    def test_purchase_receipt_updates_stock_and_records_movement(self):
        created = self.client.post("/api/purchases/", {
            "warehouse": self.warehouse.id,
            "items": [{"product": self.product.id, "quantity": 4, "unit_price": "10.00"}],
        }, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data["status"], "pending")
        self.assertFalse(StockLevel.objects.filter(product=self.product).exists())
        received = self.client.post(f"/api/purchases/{created.data['id']}/receive/", {}, format="json")
        self.assertEqual(received.status_code, 200, received.data)
        self.assertEqual(StockLevel.objects.get(product=self.product).quantity, 4)
        self.assertEqual(StockMovement.objects.get().reason, "Purchase received")
        repeated = self.client.post(f"/api/purchases/{created.data['id']}/receive/", {}, format="json")
        self.assertEqual(repeated.status_code, 400)
        self.assertEqual(StockLevel.objects.get(product=self.product).quantity, 4)

    def test_sales_attendant_cannot_change_inventory(self):
        attendant = get_user_model().objects.create_user(username="sales@example.com", password="StrongPassword123!")
        Profile.objects.create(user=attendant, business=self.business, role="sales_attendant")
        self.client.force_authenticate(attendant)
        response = self.client.post("/api/stock-movements/", {
            "product": self.product.id, "warehouse": self.warehouse.id,
            "kind": "in", "quantity": 3, "reason": "Unauthorized attempt",
        }, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(StockMovement.objects.exists())

    def test_seed_command_creates_real_dashboard_records(self):
        demo_business = Business.objects.create(name="Demo business")
        demo_user = get_user_model().objects.create_user(
            username="demo@example.com", email="demo@example.com", password="StrongPassword123!"
        )
        Profile.objects.create(user=demo_user, business=demo_business, role="owner")
        self.client.force_authenticate(demo_user)
        call_command("seed_demo", email=demo_user.email, verbosity=0)
        response = self.client.get("/api/dashboard/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["metrics"]["products"], 6)
        self.assertGreater(response.data["metrics"]["sales"], 0)
        self.assertGreater(response.data["metrics"]["purchases"], 0)

    def test_local_frontend_origin_is_allowed_for_direct_api_calls(self):
        response = self.client.options(
            "/api/auth/register/",
            HTTP_ORIGIN="http://127.0.0.1:5173",
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
        )
        self.assertEqual(response["Access-Control-Allow-Origin"], "http://127.0.0.1:5173")
