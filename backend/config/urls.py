from django.contrib import admin
from django.urls import include, path
from rest_framework.routers import DefaultRouter
from inventory.views import (
    BusinessSettingsView, CategoryViewSet, CustomerViewSet, DashboardView, ExpenseViewSet, LoginView,
    LogoutView, ProductViewSet, PurchaseViewSet, RegisterView, SaleViewSet,
    StockMovementViewSet, SupplierViewSet, WarehouseViewSet,
)

router = DefaultRouter()
router.register("products", ProductViewSet, basename="product")
router.register("categories", CategoryViewSet, basename="category")
router.register("suppliers", SupplierViewSet, basename="supplier")
router.register("customers", CustomerViewSet, basename="customer")
router.register("warehouses", WarehouseViewSet, basename="warehouse")
router.register("stock-movements", StockMovementViewSet, basename="stock-movement")
router.register("sales", SaleViewSet, basename="sale")
router.register("purchases", PurchaseViewSet, basename="purchase")
router.register("expenses", ExpenseViewSet, basename="expense")

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/register/", RegisterView.as_view(), name="register"),
    path("api/auth/login/", LoginView.as_view(), name="login"),
    path("api/auth/logout/", LogoutView.as_view(), name="logout"),
    path("api/business/", BusinessSettingsView.as_view(), name="business-settings"),
    path("api/dashboard/", DashboardView.as_view(), name="dashboard"),
    path("api/", include(router.urls)),
]
