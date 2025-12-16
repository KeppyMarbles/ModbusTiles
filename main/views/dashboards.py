from ..models import Dashboard, DashboardWidget
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


@login_required
def dashboard_view(request, alias):
    dashboard = get_object_or_404(
        Dashboard,
        alias=alias,
        owner=request.user
    )

    return render(request, "dashboard.html", {
        "dashboard": dashboard,
        "widget_types": [choice for choice in DashboardWidget.WidgetTypeChoices],
    })
