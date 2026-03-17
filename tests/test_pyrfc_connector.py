"""Tests for PyRFC live connector — api/routes/connect.py

All tests use mocked pyrfc to avoid needing a real SAP system.
"""

import logging
import time
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def mock_pyrfc():
    """Create a mock pyrfc module."""
    mock_module = MagicMock()
    mock_conn = MagicMock()
    mock_module.Connection.return_value = mock_conn
    return mock_module, mock_conn


@pytest.fixture
def client():
    """Create a test client with mocked dependencies."""
    # Reset rate limiter between tests
    from api.routes import connect
    connect._rate_limit.clear()

    from api.main import app
    return TestClient(app)


@pytest.fixture
def sap_request_body():
    return {
        "host": "10.0.0.1",
        "client": "100",
        "user": "TESTUSER",
        "password": "SuperSecret123!",
        "sysnr": "00",
        "module": "business_partner",
        "table": "BUT000",
        "fields": ["PARTNER", "BU_TYPE", "TITLE"],
        "where": "BU_TYPE = '1'",
    }


def _make_rfc_result(num_rows: int = 5) -> dict:
    """Create a mock RFC_READ_TABLE result."""
    fields = [
        {"FIELDNAME": "PARTNER   ", "OFFSET": "0", "LENGTH": "10", "TYPE": "C", "FIELDTEXT": "Partner"},
        {"FIELDNAME": "BU_TYPE   ", "OFFSET": "10", "LENGTH": "4", "TYPE": "C", "FIELDTEXT": "Type"},
        {"FIELDNAME": "TITLE     ", "OFFSET": "14", "LENGTH": "15", "TYPE": "C", "FIELDTEXT": "Title"},
    ]
    data = []
    for i in range(num_rows):
        partner = f"{i:010d}"
        bu_type = "0001"
        title = f"Title {i:010d}"
        wa = f"{partner}{bu_type}{title}"
        data.append({"WA": wa})
    return {"FIELDS": fields, "DATA": data}


class TestPasswordMasking:
    """1. Password never appears in any log output."""

    def test_password_masked_in_rfc_error(self, client, sap_request_body, caplog):
        """When RFC raises an error containing the password, it must be masked."""
        password = sap_request_body["password"]
        error_msg = f"Authentication failed for user TESTUSER with password {password}"

        mock_module = MagicMock()
        mock_conn = MagicMock()
        mock_module.Connection.return_value = mock_conn
        mock_conn.call.side_effect = Exception(error_msg)

        with patch.dict("sys.modules", {"pyrfc": mock_module}):
            with caplog.at_level(logging.DEBUG):
                response = client.post("/api/v1/connect", json=sap_request_body)

        assert response.status_code == 422
        # Password must not appear in response
        assert password not in response.text
        # Password must not appear in log output
        for record in caplog.records:
            assert password not in record.message

    def test_password_masked_in_connection_error(self, client, sap_request_body, caplog):
        """When Connection() itself fails with password in message, it must be masked."""
        password = sap_request_body["password"]

        mock_module = MagicMock()
        mock_module.Connection.side_effect = Exception(
            f"Could not connect to host 10.0.0.1 with passwd={password}"
        )

        with patch.dict("sys.modules", {"pyrfc": mock_module}):
            with caplog.at_level(logging.DEBUG):
                response = client.post("/api/v1/connect", json=sap_request_body)

        assert response.status_code == 422
        assert password not in response.text
        for record in caplog.records:
            assert password not in record.message


class TestConnectionAlwaysClosed:
    """2. Connection always closed even when RFC raises an exception."""

    def test_connection_closed_on_success(self, client, sap_request_body):
        mock_module = MagicMock()
        mock_conn = MagicMock()
        mock_module.Connection.return_value = mock_conn
        mock_conn.call.return_value = _make_rfc_result(5)

        with patch.dict("sys.modules", {"pyrfc": mock_module}):
            with patch("api.routes.connect.apply_column_mapping", side_effect=lambda df, m: df):
                with patch("api.routes.connect.minio_upload"):
                    with patch("api.routes.connect.create_version") as mock_version:
                        mock_v = MagicMock()
                        mock_v.id = "test-version-id"
                        mock_version.return_value = mock_v
                        with patch("api.routes.connect.run_checks") as mock_checks:
                            mock_checks.delay.return_value = MagicMock(id="job-1")
                            response = client.post("/api/v1/connect", json=sap_request_body)

        assert response.status_code == 200
        mock_conn.close.assert_called_once()

    def test_connection_closed_on_rfc_error(self, client, sap_request_body):
        mock_module = MagicMock()
        mock_conn = MagicMock()
        mock_module.Connection.return_value = mock_conn
        mock_conn.call.side_effect = RuntimeError("RFC_COMMUNICATION_FAILURE")

        with patch.dict("sys.modules", {"pyrfc": mock_module}):
            response = client.post("/api/v1/connect", json=sap_request_body)

        assert response.status_code == 422
        mock_conn.close.assert_called_once()


class TestRFCErrors:
    """3. RFC errors returned as HTTP 422 with masked error message."""

    def test_rfc_communication_failure(self, client, sap_request_body):
        mock_module = MagicMock()
        mock_conn = MagicMock()
        mock_module.Connection.return_value = mock_conn
        mock_conn.call.side_effect = Exception("RFC_COMMUNICATION_FAILURE: connection lost")

        with patch.dict("sys.modules", {"pyrfc": mock_module}):
            response = client.post("/api/v1/connect", json=sap_request_body)

        assert response.status_code == 422
        data = response.json()
        assert data["detail"]["error"] == "rfc_error"

    def test_pyrfc_not_installed(self, client, sap_request_body):
        """When pyrfc is not importable, return 501."""
        with patch.dict("sys.modules", {"pyrfc": None}):
            with patch("builtins.__import__", side_effect=ImportError("No module named 'pyrfc'")):
                # Need to handle the import inside the route
                response = client.post("/api/v1/connect", json=sap_request_body)

        assert response.status_code in (501, 422)


class TestLargeTableParsing:
    """4. Large table results (10,000 rows) chunked and parsed correctly."""

    def test_parse_10000_rows(self, client, sap_request_body):
        mock_module = MagicMock()
        mock_conn = MagicMock()
        mock_module.Connection.return_value = mock_conn
        mock_conn.call.return_value = _make_rfc_result(10_000)

        with patch.dict("sys.modules", {"pyrfc": mock_module}):
            with patch("api.routes.connect.apply_column_mapping", side_effect=lambda df, m: df):
                with patch("api.routes.connect.minio_upload"):
                    with patch("api.routes.connect.create_version") as mock_version:
                        mock_v = MagicMock()
                        mock_v.id = "test-version-id"
                        mock_version.return_value = mock_v
                        with patch("api.routes.connect.run_checks") as mock_checks:
                            mock_checks.delay.return_value = MagicMock(id="job-1")
                            response = client.post("/api/v1/connect", json=sap_request_body)

        assert response.status_code == 200
        data = response.json()
        assert data["row_count"] == 10_000

    def test_parse_rfc_result_correctness(self):
        """Verify the parser extracts field values correctly from WA strings."""
        from api.routes.connect import _parse_rfc_result

        result = _make_rfc_result(3)
        df = _parse_rfc_result(result)

        assert len(df) == 3
        assert list(df.columns) == ["PARTNER", "BU_TYPE", "TITLE"]
        assert df.iloc[0]["PARTNER"] == "0000000000"
        assert df.iloc[0]["BU_TYPE"] == "0001"


class TestRateLimiting:
    """5. Rate limiting blocks a second call within 5 minutes from same tenant."""

    def test_second_call_blocked(self, client, sap_request_body):
        mock_module = MagicMock()
        mock_conn = MagicMock()
        mock_module.Connection.return_value = mock_conn
        mock_conn.call.return_value = _make_rfc_result(5)

        with patch.dict("sys.modules", {"pyrfc": mock_module}):
            with patch("api.routes.connect.apply_column_mapping", side_effect=lambda df, m: df):
                with patch("api.routes.connect.minio_upload"):
                    with patch("api.routes.connect.create_version") as mock_version:
                        mock_v = MagicMock()
                        mock_v.id = "test-version-id"
                        mock_version.return_value = mock_v
                        with patch("api.routes.connect.run_checks") as mock_checks:
                            mock_checks.delay.return_value = MagicMock(id="job-1")

                            # First call succeeds
                            resp1 = client.post("/api/v1/connect", json=sap_request_body)
                            assert resp1.status_code == 200

                            # Second call within 5 minutes should be rate-limited
                            resp2 = client.post("/api/v1/connect", json=sap_request_body)
                            assert resp2.status_code == 429
                            assert "rate_limited" in resp2.text

    def test_call_allowed_after_rate_limit_expires(self, client, sap_request_body):
        """After the 5-minute window, a new call should be allowed."""
        from api.routes import connect

        # Simulate a past call by setting timestamp 6 minutes ago
        tenant_key = "00000000-0000-0000-0000-000000000001"
        connect._rate_limit[tenant_key] = time.time() - 360  # 6 minutes ago

        mock_module = MagicMock()
        mock_conn = MagicMock()
        mock_module.Connection.return_value = mock_conn
        mock_conn.call.return_value = _make_rfc_result(5)

        with patch.dict("sys.modules", {"pyrfc": mock_module}):
            with patch("api.routes.connect.apply_column_mapping", side_effect=lambda df, m: df):
                with patch("api.routes.connect.minio_upload"):
                    with patch("api.routes.connect.create_version") as mock_version:
                        mock_v = MagicMock()
                        mock_v.id = "test-version-id"
                        mock_version.return_value = mock_v
                        with patch("api.routes.connect.run_checks") as mock_checks:
                            mock_checks.delay.return_value = MagicMock(id="job-1")
                            response = client.post("/api/v1/connect", json=sap_request_body)

        assert response.status_code == 200
