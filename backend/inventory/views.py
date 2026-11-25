from datetime import timedelta
from decimal import Decimal
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Sum, F
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, permissions, status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import (
    ActivityLog, Business, Category, Customer, Expense, Product, Purchase, PurchaseLine,
    Sale, StockLevel, StockMovement, Supplier, Warehouse,
)
from .serializers import (
    BusinessSerializer, CategorySerializer, CustomerSerializer, ExpenseSerializer, LoginSerializer,
    ProductSerializer, PurchaseSerializer, RegisterSerializer, SaleSerializer,
    StockMovementSerializer, SupplierSerializer, WarehouseSerializer,
)

User = get_user_model()


class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        token, _ = Token.objects.get_or_create(user=user)
        return Response({"token": token.key, "user": user.first_name,
                         "business": user.profile.business.name, "role": user.profile.role})


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        token, _ = Token.objects.get_or_create(user=user)
        return Response({"token": token.key, "user": user.first_name or user.email,
                         "business": user.profile.business.name, "role": user.profile.role})


class LogoutView(APIView):
    def post(self, request):
        request.user.auth_token.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class BusinessSettingsView(APIView):
    def get(self, request):
        return Response(BusinessSerializer(request.user.profile.business).data)

    def patch(self, request):
        if request.user.profile.role != "owner":
            raise PermissionDenied("Only the business owner can change business settings.")
        serializer = BusinessSerializer(request.user.profile.business, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class RoleAccess(permissions.BasePermission):
    mutation_roles = {
        "ProductViewSet": {"inventory_manager"},
        "CategoryViewSet": {"inventory_manager"},
        "WarehouseViewSet": {"inventory_manager"},
        "StockMovementViewSet": {"inventory_manager"},
        "PurchaseViewSet": {"inventory_manager"},
        "SupplierViewSet": {"inventory_manager"},
        "SaleViewSet": {"sales_attendant"},
        "CustomerViewSet": {"sales_attendant"},
        "ExpenseViewSet": {"accountant"},
    }

    def has_permission(self, request, view):
        profile = getattr(request.user, "profile", None)
        if profile is None:
            return False
        if request.method in permissions.SAFE_METHODS or profile.role == "owner":
            return True
        return profile.role in self.mutation_roles.get(view.__class__.__name__, set())


class BusinessViewSet(viewsets.ModelViewSet):
    permission_classes = [RoleAccess]

    def get_queryset(self):
        return self.queryset.filter(business=self.request.user.profile.business)
    def perform_create(self, serializer):
        serializer.save(business=self.request.user.profile.business)
    def perform_update(self, serializer):
        serializer.save()


class CategoryViewSet(BusinessViewSet):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer


class ProductViewSet(BusinessViewSet):
    queryset = Product.objects.select_related("category").prefetch_related("stock_levels")
    serializer_class = ProductSerializer
    def get_queryset(self):
        queryset = super().get_queryset()
        search = self.request.query_params.get("search")
        if search:
            from django.db.models import Q
            queryset = queryset.filter(Q(name__icontains=search) | Q(sku__icontains=search) | Q(barcode__icontains=search))
        stock = self.request.query_params.get("stock")
        if stock == "low":
            queryset = queryset.annotate(stock_total=Sum("stock_levels__quantity")).filter(stock_total__lte=F("minimum_stock"))
        elif stock == "out":
            queryset = queryset.annotate(stock_total=Sum("stock_levels__quantity")).filter(stock_total__isnull=True)
        return queryset


class SupplierViewSet(BusinessViewSet):
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer


class CustomerViewSet(BusinessViewSet):
    queryset = Customer.objects.all()
    serializer_class = CustomerSerializer


class WarehouseViewSet(BusinessViewSet):
    queryset = Warehouse.objects.all()
    serializer_class = WarehouseSerializer


class StockMovementViewSet(viewsets.ModelViewSet):
    serializer_class = StockMovementSerializer
    permission_classes = [RoleAccess]
    http_method_names = ["get", "post", "head", "options"]
    def get_queryset(self):
        return StockMovement.objects.filter(business=self.request.user.profile.business).select_related("product", "warehouse", "user")
    @transaction.atomic
    def perform_create(self, serializer):
        user, business = self.request.user, self.request.user.profile.business
        product = serializer.validated_data["product"]
        warehouse = serializer.validated_data["warehouse"]
        if product.business_id != business.id or warehouse.business_id != business.id:
            raise ValidationError("Product and warehouse must belong to your business.")
        kind, quantity = serializer.validated_data["kind"], serializer.validated_data["quantity"]
        level, _ = StockLevel.objects.select_for_update().get_or_create(product=product, warehouse=warehouse)
        if kind == "in":
            level.quantity += quantity
        elif kind == "out":
            if level.quantity < quantity:
                raise ValidationError("Stock cannot be reduced below zero.")
            level.quantity -= quantity
        else:
            level.quantity = quantity
        level.save(update_fields=["quantity"])
        movement = serializer.save(business=business, user=user)
        ActivityLog.objects.create(business=business, user=user,
                                   action=f"Stock {movement.kind} recorded for {product.name}: {quantity}")


class SaleViewSet(viewsets.ModelViewSet):
    serializer_class = SaleSerializer
    permission_classes = [RoleAccess]
    http_method_names = ["get", "post", "head", "options"]
    def get_queryset(self):
        return Sale.objects.filter(business=self.request.user.profile.business).select_related("customer").prefetch_related("items__product")
    @transaction.atomic
    def perform_create(self, serializer):
        for item in serializer.validated_data["items"]:
            product = item["product"]
            if product.business_id != self.request.user.profile.business_id:
                raise ValidationError("Products must belong to your business.")
        if serializer.validated_data["warehouse"].business_id != self.request.user.profile.business_id:
            raise ValidationError("Warehouse must belong to your business.")
        serializer.save()


class PurchaseViewSet(viewsets.ModelViewSet):
    serializer_class = PurchaseSerializer
    permission_classes = [RoleAccess]
    http_method_names = ["get", "post", "head", "options"]
    def get_queryset(self):
        return Purchase.objects.filter(business=self.request.user.profile.business).select_related("supplier").prefetch_related("items__product")
    @transaction.atomic
    def perform_create(self, serializer):
        data = serializer.validated_data
        if data["warehouse"].business_id != self.request.user.profile.business_id:
            raise ValidationError("Warehouse must belong to your business.")
        if any(i["product"].business_id != self.request.user.profile.business_id for i in data["items"]):
            raise ValidationError("Products must belong to your business.")
        serializer.save()
    @action(detail=True, methods=["post"])
    @transaction.atomic
    def receive(self, request, pk=None):
        purchase = get_object_or_404(
            Purchase.objects.select_for_update().filter(business=request.user.profile.business),
            pk=pk,
        )
        self.check_object_permissions(request, purchase)
        if purchase.status == "received":
            raise ValidationError("This purchase has already been received.")
        for line in purchase.items.select_related("product"):
            level, _ = StockLevel.objects.select_for_update().get_or_create(product=line.product, warehouse=purchase.warehouse)
            level.quantity += line.quantity
            level.save(update_fields=["quantity"])
            line.received_quantity = line.quantity
            line.save(update_fields=["received_quantity"])
            StockMovement.objects.create(business=purchase.business, product=line.product,
                warehouse=purchase.warehouse, user=request.user, kind="in", quantity=line.quantity,
                reason="Purchase received", reference=str(purchase.id))
        purchase.status, purchase.received_at = "received", timezone.now()
        purchase.save(update_fields=["status", "received_at"])
        ActivityLog.objects.create(business=purchase.business, user=request.user,
                                   action=f"Purchase order {purchase.id} received")
        return Response(self.get_serializer(purchase).data)


class ExpenseViewSet(BusinessViewSet):
    queryset = Expense.objects.all()
    serializer_class = ExpenseSerializer


class DashboardView(APIView):
    def get(self, request):
        business = request.user.profile.business
        products = Product.objects.filter(business=business, is_archived=False)
        sales = Sale.objects.filter(business=business, status="completed")
        purchases = Purchase.objects.filter(business=business)
        levels = StockLevel.objects.filter(product__business=business)
        low_ids = list(products.annotate(stock_total=Coalesce(Sum("stock_levels__quantity"), 0))
                       .filter(stock_total__lte=F("minimum_stock")).values_list("id", flat=True))
        recent_sales = sales[:6]
        today = timezone.localdate()
        monthly = sales.filter(created_at__year=today.year, created_at__month=today.month)
        sales_days = []
        for offset in range(6, -1, -1):
            day = today - timedelta(days=offset)
            sales_days.append({"label": day.strftime("%a"), "sales": float(
                sales.filter(created_at__date=day).aggregate(value=Sum("total"))["value"] or 0
            )})
        return Response({
            "metrics": {
                "products": products.count(),
                "stock_value": float(sum((row.product.purchase_price * row.quantity for row in levels.select_related("product")), Decimal("0"))),
                "sales": float(sales.aggregate(value=Sum("total"))["value"] or 0),
                "purchases": float(purchases.aggregate(value=Sum("total"))["value"] or 0),
                "low_stock": len(low_ids),
                "out_of_stock": products.annotate(stock_total=Coalesce(Sum("stock_levels__quantity"), 0))
                    .filter(stock_total=0).count(),
                "suppliers": business.suppliers.count(),
                "customers": business.customers.count(),
            },
            "monthly_revenue": float(monthly.aggregate(value=Sum("total"))["value"] or 0),
            "sales_chart": sales_days,
            "low_stock_products": ProductSerializer(products.filter(id__in=low_ids)[:6], many=True).data,
            "recent_sales": SaleSerializer(recent_sales, many=True).data,
            "recent_products": ProductSerializer(products.order_by("-created_at")[:5], many=True).data,
        })
