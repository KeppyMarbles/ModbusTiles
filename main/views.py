import os
from .models import Dashboard
from django.conf import settings
from django.shortcuts import render
from django.shortcuts import get_object_or_404
from django.contrib.auth.decorators import login_required
from django.views.decorators.cache import never_cache
from django.shortcuts import redirect


def home_view(request):
    return redirect('dashboards/')


@never_cache
@login_required
def dashboard_list(request):
    dashboards = Dashboard.objects.filter(owner=request.user)
    return render(request, "dashboard_list.html", {
        "dashboards": dashboards,
        "user" : request.user
    })


def get_widget_types():
    """ Scan templates/widgets directory and return sorted widget type names """
    widgets_dir = os.path.join(settings.BASE_DIR, 'main', 'templates', 'widgets')
    if not os.path.exists(widgets_dir):
        return []
    return sorted([
        os.path.splitext(f)[0]
        for f in os.listdir(widgets_dir)
        if f.endswith('.html')
    ])


@login_required
def dashboard_view(request, alias):
    dashboard = get_object_or_404(Dashboard, alias=alias, owner=request.user)
    return render(request, "dashboard.html", {
        "dashboard": dashboard,
        "widget_types": get_widget_types(),
    })


@login_required
def alarm_list_view(request):
    return render(request, "alarm_list.html")