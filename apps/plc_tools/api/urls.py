from django.urls import include, path
from .tags import api_tag_value, api_batch_tag_values, api_write_tag, api_tag_history

urlpatterns = [
    path("tag/<uuid:external_id>/value/", api_tag_value, name="api_tag_value"),
    path("tag/values/", api_batch_tag_values, name="api_batch_tag_values"),
    path("tag/<uuid:external_id>/write/", api_write_tag, name="api_tag_write"),
    path("tag/<uuid:external_id>/history/", api_tag_history, name="api_tag_history"),
]