from ..models import Dashboard, DashboardWidget
from django.shortcuts import render
from django.shortcuts import get_object_or_404
from django.contrib.auth.decorators import login_required

#http://localhost:8000/dashboard/TestDashboard/
#@login_required
def dashboard_view(request, alias):

    from django.contrib.auth import login
    from django.contrib.auth.models import User

    #TODO remove test code
    if not request.user.is_authenticated:
        test_user = User.objects.get(username="testuser")
        login(request, test_user)

    dashboard = get_object_or_404(
        Dashboard,
        alias=alias,
        owner=request.user
    )

    widget_types = ["switch", "slider", "meter", "led", "label", "bool_label", "chart"] #TODO read from a file or infer from widgets/ html folder?

    return render(request, "plc_tools/dashboard.html", {
        "dashboard": dashboard,
        "widget_types": widget_types,
    })