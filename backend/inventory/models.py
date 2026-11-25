from django.conf import settings
from django.db import models
from django.db.models import Q


class Business(models.Model):
    name = models.CharField(max_length=180)
    phone = models.CharField(max_length=32, blank=True)
    address = models.TextField(blank=True)
    currency = models.CharField(max_length=3, default="GHS")
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class Profile(models.Model):
    class Role(models.TextChoices):
        OWNER = "owner", "Business Owner"
        INVENTORY = "inventory_manager", "Inventory Manager"
        SALES = "sales_attendant", "Sales Attendant"
        ACCOUNTANT = "accountant", "Accountant"

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="profiles")
    role = models.CharField(max_length=24, choices=Role.choices, default=Role.OWNER)


class Category(models.Model):
    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="categories")
    name = models.CharField(max_length=100)
    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["business", "name"], name="uniq_category_business")]
    def __str__(self):
        return self.name


class Product(models.Model):
    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="products")
    category = models.ForeignKey(Category, null=True, blank=True, on_delete=models.SET_NULL)
    name = models.CharField(max_length=180)
    sku = models.CharField(max_length=64)
    barcode = models.CharField(max_length=64, blank=True)
    description = models.TextField(blank=True)
    purchase_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    selling_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    minimum_stock = models.PositiveIntegerField(default=5)
    image_url = models.URLField(blank=True)
    is_archived = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["business", "sku"], name="uniq_product_sku_business"),
            models.UniqueConstraint(fields=["business", "barcode"], condition=~Q(barcode=""), name="uniq_product_barcode_business"),
        ]
    def __str__(self):
        return self.name


class Warehouse(models.Model):
    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="warehouses")
    name = models.CharField(max_length=120)
    location = models.CharField(max_length=180, blank=True)
    class Meta:
        constraints = [models.UniqueConstraint(fields=["business", "name"], name="uniq_warehouse_business")]
    def __str__(self):
        return self.name


class StockLevel(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="stock_levels")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name="stock_levels")
    quantity = models.IntegerField(default=0)
    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["product", "warehouse"], name="uniq_product_warehouse_stock"),
            models.CheckConstraint(condition=Q(quantity__gte=0), name="stock_quantity_nonnegative"),
        ]


class Supplier(models.Model):
    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="suppliers")
    name = models.CharField(max_length=180)
    company = models.CharField(max_length=180, blank=True)
    phone = models.CharField(max_length=32, blank=True)
    email = models.EmailField(blank=True)
    location = models.CharField(max_length=180, blank=True)
    contact_person = models.CharField(max_length=120, blank=True)
    address = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    def __str__(self):
        return self.name


class Customer(models.Model):
    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="customers")
    name = models.CharField(max_length=180)
    phone = models.CharField(max_length=32, blank=True)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    def __str__(self):
        return self.name


class StockMovement(models.Model):
    class Kind(models.TextChoices):
        IN = "in", "Stock in"
        OUT = "out", "Stock out"
        ADJUSTMENT = "adjustment", "Adjustment"
    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="movements")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="movements")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    kind = models.CharField(max_length=16, choices=Kind.choices)
    quantity = models.PositiveIntegerField()
    reason = models.CharField(max_length=180)
    reference = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        ordering = ["-created_at"]


class Sale(models.Model):
    class PaymentMethod(models.TextChoices):
        CASH = "cash", "Cash"
        MOBILE_MONEY = "mobile_money", "Mobile Money"
        BANK = "bank", "Bank"
    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="sales")
    customer = models.ForeignKey(Customer, null=True, blank=True, on_delete=models.SET_NULL)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    payment_method = models.CharField(max_length=20, choices=PaymentMethod.choices, default=PaymentMethod.CASH)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    discount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    tax = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status = models.CharField(max_length=16, default="completed")
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        ordering = ["-created_at"]


class SaleLine(models.Model):
    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField()
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    line_total = models.DecimalField(max_digits=12, decimal_places=2)


class Purchase(models.Model):
    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="purchases")
    supplier = models.ForeignKey(Supplier, null=True, blank=True, on_delete=models.SET_NULL)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    status = models.CharField(max_length=16, default="pending")
    total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    received_at = models.DateTimeField(null=True, blank=True)
    class Meta:
        ordering = ["-created_at"]


class PurchaseLine(models.Model):
    purchase = models.ForeignKey(Purchase, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField()
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    received_quantity = models.PositiveIntegerField(default=0)


class Expense(models.Model):
    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="expenses")
    description = models.CharField(max_length=180)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    category = models.CharField(max_length=80, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class ActivityLog(models.Model):
    business = models.ForeignKey(Business, on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    action = models.CharField(max_length=180)
    created_at = models.DateTimeField(auto_now_add=True)
