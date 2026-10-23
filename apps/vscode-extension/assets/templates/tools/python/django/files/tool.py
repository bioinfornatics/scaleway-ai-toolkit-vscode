# Django entry point; no server launch on import.
from django.core.wsgi import get_wsgi_application

def build_application():
    import os
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "settings")
    return get_wsgi_application()
