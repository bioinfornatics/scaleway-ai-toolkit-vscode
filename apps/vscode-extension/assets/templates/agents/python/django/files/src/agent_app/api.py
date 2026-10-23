"""Django entry point; configuration loads only when explicitly built."""
def build_application():
    import os
    from django.core.wsgi import get_wsgi_application
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "agent_app.settings")
    return get_wsgi_application()
