from datetime import timedelta
from decimal import Decimal
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from inventory.models import (
    ActivityLog, Category, Customer, Product, Purchase, PurchaseLine, Sale, SaleLine,
    StockLevel, StockMovement, Supplier, Warehouse,
)


class Command(BaseCommand):
    help = "Create a small, realistic demo dataset for a registered business owner."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True, help="Email of an existing business owner")

    @transaction.atomic
    def handle(self, *args, **options):
        user = get_user_model().objects.filter(email__iexact=options["email"]).first()
        if not user or not hasattr(user, "profile") or user.profile.role != "owner":
            raise CommandError("Register a business owner first, then provide that account's email.")
        business = user.profile.business
        if business.products.exists():
            raise CommandError("This business already has products; demo data was not added.")

        warehouse, _ = Warehouse.objects.get_or_create(business=business, name="Main warehouse")
        categories = {
            name: Category.objects.create(business=business, name=name)
            for name in ("Beverages", "Pantry", "Personal care")
        }
        supplier = Supplier.objects.create(
            business=business, name="Coastal Wholesale", company="Coastal Trading Ltd.",
            phone="+233 24 555 0180", email="orders@coastal.example",
            location="Tema, Greater Accra", contact_person="Ama Mensah",
        )
        customer = Customer.objects.create(
            business=business, name="Ama's Corner Shop", phone="+233 20 440 7712",
            email="purchases@amas.example", address="Osu, Accra",
        )
        products = []
        product_specs = [
            ("Ghana cocoa drink", "BEV-001", "Beverages", "18.00", "25.00", 12),
            ("Mineral water 500ml", "BEV-002", "Beverages", "3.50", "5.00", 24),
            ("Premium jasmine rice 5kg", "PAN-001", "Pantry", "72.00", "95.00", 8),
            ("Palm oil 1L", "PAN-002", "Pantry", "28.00", "38.00", 10),
            ("Raw shea butter 250g", "CARE-001", "Personal care", "25.00", "36.00", 4),
            ("Black soap 200g", "CARE-002", "Personal care", "16.00", "24.00", 6),
        ]
        for name, sku, category, cost, price, opening_stock in product_specs:
            product = Product.objects.create(
                business=business, category=categories[category], name=name, sku=sku,
                purchase_price=Decimal(cost), selling_price=Decimal(price), minimum_stock=5,
            )
            products.append(product)
            StockLevel.objects.create(product=product, warehouse=warehouse, quantity=opening_stock)
            StockMovement.objects.create(
                business=business, product=product, warehouse=warehouse, user=user,
                kind="in", quantity=opening_stock, reason="Demo opening stock",
            )

        now = timezone.now()
        for day_offset, product_index in enumerate((0, 1, 2, 0, 3, 1)):
            product = products[product_index]
            level = StockLevel.objects.get(product=product, warehouse=warehouse)
            if level.quantity < 1:
                continue
            price = product.selling_price
            sale = Sale.objects.create(
                business=business, customer=customer, warehouse=warehouse, user=user,
                payment_method=("cash", "mobile_money", "bank")[day_offset % 3],
                subtotal=price, tax=price * business.tax_rate / Decimal("100"),
                total=price + price * business.tax_rate / Decimal("100"),
            )
            SaleLine.objects.create(
                sale=sale, product=product, quantity=1, unit_price=price, line_total=price,
            )
            level.quantity -= 1
            level.save(update_fields=["quantity"])
            StockMovement.objects.create(
                business=business, product=product, warehouse=warehouse, user=user,
                kind="out", quantity=1, reason="Demo sale", reference=str(sale.id),
            )
            Sale.objects.filter(pk=sale.pk).update(
                created_at=now - timedelta(days=day_offset)
            )

        purchase = Purchase.objects.create(
            business=business, supplier=supplier, warehouse=warehouse, user=user,
            total=products[2].purchase_price * 5,
        )
        PurchaseLine.objects.create(
            purchase=purchase, product=products[2], quantity=5,
            unit_price=products[2].purchase_price,
        )
        ActivityLog.objects.create(
            business=business, user=user, action="Demo inventory and transactions created",
        )
        self.stdout.write(self.style.SUCCESS(
            f"Created demo products, stock, sales and a pending purchase for {business.name}."
        ))
