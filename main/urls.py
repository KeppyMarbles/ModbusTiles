from django.urls import include, path
from .views import dashboard_view

urlpatterns = [
    path("dashboard/<slug:alias>/", dashboard_view.dashboard_view, name="dashboard"),
]