from django.shortcuts import render, redirect
from .services.plc_manager import plc_manager
from .models import PLCRegister

def register_view(request):
    address = 0

    if request.method == "POST":
        new_value = int(request.POST.get("value"))
        
        new_value = min(new_value, 65535)
        new_value = max(new_value, 0)
        
        plc_manager.write_register(address, new_value)
        return redirect("register_view")
        
    value = plc_manager.get_registers()[0]

    context = {"address": address, "value": value}
    return render(request, "plc_tools/register_view.html", context)
    
    
def register_chart(request, address=0):
    # Get the latest N records for this register
    data = PLCRegister.objects.filter(address=address).order_by('-timestamp')[:50]
    data = list(reversed(data))  # oldest → newest for chart order

    timestamps = [r.timestamp.strftime("%H:%M:%S") for r in data]
    values = [r.value for r in data]

    context = {
        "address": address,
        "timestamps": timestamps,
        "values": values,
    }
    return render(request, "plc_tools/register_chart.html", context)