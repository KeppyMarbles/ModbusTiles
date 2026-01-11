from django.urls import include, path
from . import views

urlpatterns = [
    path("dashboard/<slug:alias>/", views.dashboard_view, name="dashboard"),
    path("dashboards/", views.dashboard_list, name="dashboards"),
    path("alarms/", views.alarm_list_view, name="alarms"),
    path("", views.home_view, name="home")
]