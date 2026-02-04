from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

# Create a router and register our viewsets with it.
router = DefaultRouter()
router.register(r'devices', views.DeviceViewSet, basename='device')
router.register(r'tags', views.TagViewSet, basename='tag')
router.register(r'alarms', views.AlarmConfigViewSet, basename='alarm')
router.register(r'activated-alarms', views.ActivatedAlarmViewSet, basename='activated-alarm')
router.register(r'schedules', views.ScheduleViewSet, basename='schedule')
router.register(r'dashboards', views.DashboardViewSet, basename='dashboard')
router.register(r'dashboard-widgets', views.DashboardWidgetViewSet, basename='dashboard-widget')
router.register(r'write-requests', views.TagWriteRequestViewSet, basename='write-request')

urlpatterns = [
    path('', include(router.urls)),
    path('values/', views.TagMultiValueView.as_view(), name='tag-values'),
    path('history/', views.TagHistoryView.as_view(), name='tag-history'),
    path('tag-options/', views.TagMetadataView.as_view(), name='tag-options'),
    path('device-options/', views.DeviceMetadataView.as_view(), name='device-options'),
    path('alarm-options/', views.AlarmMetadataView.as_view(), name='alarm-options'),
]