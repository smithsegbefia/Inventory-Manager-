from django.contrib import admin
from .models import (
    ActivityLog, Business, Category, Customer, Expense, Product, Profile, Purchase,
    PurchaseLine, Sale, SaleLine, StockLevel, StockMovement, Supplier, Warehouse,
)

for model in (ActivityLog, Business, Category, Customer, Expense, Product, Profile,
              Purchase, PurchaseLine, Sale, SaleLine, StockLevel, StockMovement,
              Supplier, Warehouse):
    admin.site.register(model)
