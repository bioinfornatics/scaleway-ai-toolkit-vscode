"""Offline unit tests: no SDK, backend, model, .env or network required."""
import importlib
import os
import pytest
from agent_app.config import load_config


@pytest.fixture(autouse=True)
def synthetic_key(monkeypatch):
    monkeypatch.setenv("SCW_API_KEY", "unit-test-not-a-credential")


def environment():
    return {"SCW_INFERENCE_BASE_URL": "https://example.invalid/v1",
            "SCW_INFERENCE_MODEL_ID": "reviewed-model",
            "SCW_API_KEY": os.environ["SCW_API_KEY"],
            }


def test_explicit_configuration_and_redacted_repr():
    config = load_config(environment())
    assert config.endpoint == "https://example.invalid/v1"
    assert config.model_id == "reviewed-model"
    assert config.key == "unit-test-not-a-credential"
    assert config.key not in repr(config)


def test_environment_only_read_when_called(monkeypatch):
    monkeypatch.delenv("SCW_API_KEY", raising=False)
    import agent_app.config as module
    importlib.reload(module)
    with pytest.raises(ValueError, match="^missing external configuration$"):
        module.load_config()
    monkeypatch.setenv("SCW_API_KEY", "unit-test-not-a-credential")
    for key, value in environment().items():
        monkeypatch.setenv(key, value)
    assert module.load_config().model_id == "reviewed-model"


@pytest.mark.parametrize("endpoint", ["http://example.invalid", "https://" + "user:pass" + "@example.invalid",
    "https://example.invalid?x=value", "https://example.invalid#fragment", "https://example.invalid:bad"])
def test_invalid_endpoint_without_value_exposure(endpoint):
    source = environment()
    source["SCW_INFERENCE_BASE_URL"] = endpoint
    with pytest.raises(ValueError, match="^invalid endpoint$"):
        load_config(source)


def test_explicit_empty_config_has_no_environment_fallback(monkeypatch):
    for key, value in environment().items():
        monkeypatch.setenv(key, value)
    with pytest.raises(ValueError, match="^missing external configuration$"):
        load_config({})
