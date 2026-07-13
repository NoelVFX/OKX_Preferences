import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "agent_coordinator.py"

spec = importlib.util.spec_from_file_location("agent_coordinator", MODULE_PATH)
agent_coordinator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent_coordinator)


class PreferencesAISimulationPayloadTests(unittest.TestCase):
    def test_extract_survey_id_reads_nested_preferencesai_create_response(self):
        response_json = {"success": True, "data": {"survey_id": "survey_live_123"}}

        self.assertEqual(agent_coordinator.extract_survey_id(response_json), "survey_live_123")

    def test_extract_survey_id_rejects_missing_or_fallback_id(self):
        response_json = {"success": True, "data": {"id": None}}

        with self.assertRaisesRegex(RuntimeError, "survey_id"):
            agent_coordinator.extract_survey_id(response_json)

    def test_build_simulation_payload_always_contains_real_survey_id_and_current_api_fields(self):
        preview = {
            "demographic_a": "Eco-conscious parents aged 28-40",
            "demographic_b": "Gift-buying relatives aged 45-65",
        }

        payload = agent_coordinator.build_simulation_payload(
            survey_id="survey_live_123",
            pitch="environmentally friendly toy car",
            preview_report=preview,
            pru_cost=29,
        )

        self.assertEqual(payload["survey_id"], "survey_live_123")
        self.assertEqual(payload["desired_respondent_count"], 29)
        self.assertEqual(payload["respondent_count"], 29)
        self.assertEqual(payload["pru_cost"], 29)
        self.assertEqual(payload["confidence_level"], 0.95)
        self.assertEqual(payload["margin_of_error"], 0.05)

    def test_build_simulation_payload_rejects_fallback_survey_id(self):
        preview = {"demographic_a": "A", "demographic_b": "B"}

        with self.assertRaisesRegex(RuntimeError, "real PreferencesAI survey_id"):
            agent_coordinator.build_simulation_payload(
                survey_id="survey_fallback_demo303",
                pitch="test",
                preview_report=preview,
                pru_cost=29,
            )


if __name__ == "__main__":
    unittest.main()
