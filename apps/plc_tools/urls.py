from django.urls import include, path
from apps.plc_tools import views

urlpatterns = [
    path('register/', views.register_view, name='register_view'),
    path('register/<int:address>/', views.register_chart, name='register_chart'),
]