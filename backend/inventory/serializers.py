import re
from decimal import Decimal
from django.contrib.auth import authenticate, get_user_model, password_validation
from django.db import transaction
from rest_framework import serializers
from .models import (
    ActivityLog, Business, Category, Customer, Expense, Product, Profile, Purchase, PurchaseLine,
    Sale, SaleLine, StockLevel, StockMovement, Supplier, Warehouse,
)

User = get_user_model()


class BusinessSerializer(serializers.ModelSerializer):
    tax_rate = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=Decimal("0"), max_value=Decimal("100"))

    class Meta:
        model = Business
        fields = ["id", "name", "phone", "address", "currency", "tax_rate"]

    def validate_currency(self, value):
        if not re.fullmatch(r"[A-Z]{3}", value):
            raise serializers.ValidationError("Use a three-letter uppercase currency code.")
        return value


class RegisterSerializer(serializers.Serializer):
    business_name = serializers.CharField(max_length=180)
    name = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    password = serializers.CharField(min_length=10, write_only=True)
    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value
    def validate_password(self, value):
        password_validation.validate_password(value)
        return value
    @transaction.atomic
    def create(self, data):
        business = Business.objects.create(name=data["business_name"])
        user = User.objects.create_user(username=data["email"], email=data["email"], password=data["password"], first_name=data["name"])
        Profile.objects.create(user=user, business=business, role=Profile.Role.OWNER)
        Warehouse.objects.create(business=business, name="Main warehouse")
        return user


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)
    def validate(self, data):
        user = authenticate(username=data["email"], password=data["password"])
        if not user:
            raise serializers.ValidationError("Email or password is incorrect.")
        if not hasattr(user, "profile"):
            raise serializers.ValidationError("This account is not associated with a business.")
        data["user"] = user
        return data


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name"]


class ProductSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)
    stock = serializers.SerializerMethodField()
    purchase_price = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))
    selling_price = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))
    class Meta:
        model = Product
        fields = ["id", "name", "sku", "barcode", "description", "category", "category_name",
                  "purchase_price", "selling_price", "minimum_stock", "image_url", "is_archived",
                  "created_at", "stock"]
        read_only_fields = ["id", "created_at", "stock"]
    def get_stock(self, obj):
        return sum(obj.stock_levels.values_list("quantity", flat=True))
    def validate_category(self, category):
        if category and category.business_id != self.context["request"].user.profile.business_id:
            raise serializers.ValidationError("Category must belong to your business.")
        return category


class StockMovementSerializer(serializers.ModelSerializer):
    quantity = serializers.IntegerField(min_value=0)
    product_name = serializers.CharField(source="product.name", read_only=True)
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True)
    user_name = serializers.CharField(source="user.get_full_name", read_only=True)
    class Meta:
        model = StockMovement
        fields = ["id", "product", "product_name", "warehouse", "warehouse_name", "user_name",
                  "kind", "quantity", "reason", "reference", "created_at"]
        read_only_fields = ["id", "created_at", "user_name", "product_name", "warehouse_name"]
    def validate(self, attrs):
        if attrs["kind"] != "adjustment" and attrs["quantity"] < 1:
            raise serializers.ValidationError({"quantity": "Stock-in and stock-out quantities must be positive."})
        return attrs


class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = ["id", "name", "company", "phone", "email", "location", "contact_person", "address", "created_at"]


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = ["id", "name", "phone", "email", "address", "created_at"]


class WarehouseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Warehouse
        fields = ["id", "name", "location"]


class SaleLineSerializer(serializers.ModelSerializer):
    quantity = serializers.IntegerField(min_value=1)
    product_name = serializers.CharField(source="product.name", read_only=True)
    class Meta:
        model = SaleLine
        fields = ["id", "product", "product_name", "quantity", "unit_price", "line_total"]
        read_only_fields = ["id", "product_name", "unit_price", "line_total"]


class SaleSerializer(serializers.ModelSerializer):
    items = SaleLineSerializer(many=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    class Meta:
        model = Sale
        fields = ["id", "customer", "customer_name", "warehouse", "payment_method", "subtotal",
                  "discount", "tax", "total", "status", "items", "created_at"]
        read_only_fields = ["id", "subtotal", "tax", "total", "status", "created_at"]
    def validate(self, attrs):
        business = self.context["request"].user.profile.business
        customer = attrs.get("customer")
        if customer and customer.business_id != business.id:
            raise serializers.ValidationError({"customer": "Customer must belong to your business."})
        items = attrs.get("items", [])
        subtotal = sum((item["product"].selling_price * item["quantity"] for item in items), start=0)
        discount = attrs.get("discount", 0)
        if discount < 0:
            raise serializers.ValidationError({"discount": "Discount cannot be negative."})
        if discount > subtotal:
            raise serializers.ValidationError({"discount": "Discount cannot exceed the sale subtotal."})
        return attrs
    def create(self, data):
        items = data.pop("items")
        business = self.context["request"].user.profile.business
        warehouse = data["warehouse"]
        discount = data.pop("discount", 0)
        tax_rate = business.tax_rate
        subtotal = sum((item["product"].selling_price * item["quantity"] for item in items), start=0)
        tax = (subtotal - discount) * tax_rate / 100
        sale = Sale.objects.create(business=business, user=self.context["request"].user,
                                   subtotal=subtotal, discount=discount, tax=tax,
                                   total=subtotal - discount + tax, **data)
        ActivityLog.objects.create(business=business, user=self.context["request"].user,
                                   action=f"Sale {sale.id} completed for {sale.total}")
        for item in items:
            product, quantity = item["product"], item["quantity"]
            stock, _ = StockLevel.objects.select_for_update().get_or_create(product=product, warehouse=warehouse)
            if stock.quantity < quantity:
                raise serializers.ValidationError({"items": f"Not enough stock for {product.name}."})
            stock.quantity -= quantity
            stock.save(update_fields=["quantity"])
            unit_price = product.selling_price
            SaleLine.objects.create(sale=sale, product=product, quantity=quantity,
                                    unit_price=unit_price, line_total=unit_price * quantity)
            StockMovement.objects.create(business=business, product=product, warehouse=warehouse,
                                         user=self.context["request"].user, kind="out", quantity=quantity,
                                         reason="Sale", reference=str(sale.id))
        return sale


class PurchaseLineSerializer(serializers.ModelSerializer):
    quantity = serializers.IntegerField(min_value=1)
    unit_price = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))
    product_name = serializers.CharField(source="product.name", read_only=True)
    class Meta:
        model = PurchaseLine
        fields = ["id", "product", "product_name", "quantity", "unit_price", "received_quantity"]
        read_only_fields = ["id", "received_quantity"]


class PurchaseSerializer(serializers.ModelSerializer):
    items = PurchaseLineSerializer(many=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    class Meta:
        model = Purchase
        fields = ["id", "supplier", "supplier_name", "warehouse", "status", "total", "items", "created_at", "received_at"]
        read_only_fields = ["id", "status", "total", "created_at", "received_at"]
    def validate(self, attrs):
        supplier = attrs.get("supplier")
        business = self.context["request"].user.profile.business
        if supplier and supplier.business_id != business.id:
            raise serializers.ValidationError({"supplier": "Supplier must belong to your business."})
        return attrs
    def create(self, data):
        items = data.pop("items")
        business = self.context["request"].user.profile.business
        total = sum((item["unit_price"] * item["quantity"] for item in items), start=0)
        purchase = Purchase.objects.create(business=business, user=self.context["request"].user, total=total, **data)
        ActivityLog.objects.create(business=business, user=self.context["request"].user,
                                   action=f"Purchase order {purchase.id} created")
        for item in items:
            PurchaseLine.objects.create(purchase=purchase, **item)
        return purchase


class ExpenseSerializer(serializers.ModelSerializer):
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    class Meta:
        model = Expense
        fields = ["id", "description", "amount", "category", "created_at"]
