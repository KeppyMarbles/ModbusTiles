from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

# Create a router and register our viewsets with it.
router = DefaultRouter()
router.register(r'devices', views.DeviceViewSet, basename='device')
router.register(r'tags', views.TagViewSet, basename='tag')
router.register(r'alarms', views.AlarmConfigViewSet, basename='alarm')
router.register(r'dashboards', views.DashboardWidgetViewSet, basename='dashboard')
router.register(r'write-requests', views.TagWriteRequestViewSet, basename='write-request')

urlpatterns = [
    path('', include(router.urls)),
    path('values/', views.TagMultiValueView.as_view(), name='tag-values'),
    path('history/', views.TagHistoryView.as_view(), name='tag-history'),
]