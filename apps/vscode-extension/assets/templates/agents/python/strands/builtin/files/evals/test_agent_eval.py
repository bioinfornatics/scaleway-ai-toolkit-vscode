"""Opt-in authoring skeleton, NOT evidence of an evaluated agent."""
import os
import pytest


@pytest.mark.integration
def test_agent_evaluation_requires_integration():
    if os.environ.get("AGENT_RUN_EVALS") != "1":
        pytest.skip("Evaluation is opt-in: AGENT_RUN_EVALS=1")
    pytest.fail("NOT integrated: author reviewed DeepEval cases, metrics and a guarded agent adapter first")
