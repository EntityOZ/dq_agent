"""SAP-compatible export engine — CSV, LSMW, BAPI, IDoc, SF CSV formats."""

import csv
import io
import json
from typing import Any


# ── SAP field mappings per object type ────────────────────────────────────────

SAP_EXPORT_FIELDS: dict[str, dict[str, str]] = {
    "customer": {
        "customer_id": "KUNNR",
        "name": "NAME1",
        "country": "LAND1",
        "payment_terms": "ZTERM",
        "currency": "WAERS",
        "tax_number": "STCEG",
        "phone": "TELF1",
        "email": "SMTP_ADDR",
    },
    "vendor": {
        "vendor_id": "LIFNR",
        "name": "NAME1",
        "country": "LAND1",
        "payment_terms": "ZTERM",
        "currency": "WAERS",
        "tax_number": "STCEG",
        "bank_account": "BANKN",
        "iban": "IBAN",
    },
    "material": {
        "material_id": "MATNR",
        "description": "MAKTX",
        "material_type": "MTART",
        "base_unit": "MEINS",
        "material_group": "MATKL",
        "weight_gross": "BRGEW",
        "weight_unit": "GEWEI",
        "status": "MMSTA",
    },
    "equipment": {
        "equipment_id": "EQUNR",
        "description": "EQKTX",
        "plant": "WERKS",
        "location": "STORT",
        "cost_center": "KOSTL",
        "acquisition_date": "ANSDT",
    },
    "employee": {
        "employee_id": "PERNR",
        "first_name": "VORNA",
        "last_name": "NACHN",
        "hire_date": "BEGDA",
        "job_code": "PLANS",
        "cost_center": "KOSTL",
        "payroll_area": "ABKRS",
    },
    "financial": {
        "account_number": "SAKNR",
        "description": "TXT50",
        "account_group": "KTOKS",
        "company_code": "BUKRS",
        "currency": "WAERS",
        "balance_sheet_flag": "BILKT",
    },
}

TRANSACTION_CODES: dict[str, str] = {
    "customer": "XD02",
    "vendor": "XK02",
    "material": "MM02",
    "equipment": "IE02",
    "employee": "PA30",
    "financial": "FS00",
}

BAPI_NAMES: dict[str, str] = {
    "customer": "BAPI_CUSTOMER_CHANGEFROMDATA1",
    "vendor": "BAPI_VENDOR_CHANGEFROMDATA",
    "material": "BAPI_MATERIAL_SAVEDATA",
    "equipment": "BAPI_EQUI_CHANGE",
}

IDOC_TYPES: dict[str, str] = {
    "customer": "DEBMAS07",
    "vendor": "CREMAS05",
    "material": "MATMAS05",
    "employee": "HRMD_A",
}

SF_FIELD_NAMES: dict[str, str] = {
    "employee_id": "userId",
    "first_name": "firstName",
    "last_name": "lastName",
    "hire_date": "hireDate",
    "job_code": "jobCode",
    "cost_center": "costCenter",
    "payroll_area": "payrollArea",
}


class ExportEngine:
    """Generates SAP-compatible export files in multiple formats."""

    def _map_record(self, record: dict[str, Any], object_type: str) -> dict[str, str]:
        """Map source field names to SAP field names for a single record."""
        field_map = SAP_EXPORT_FIELDS.get(object_type, {})
        mapped: dict[str, str] = {}
        for source_field, sap_field in field_map.items():
            value = record.get(source_field, "")
            mapped[sap_field] = str(value) if value is not None else ""
        return mapped

    def export_csv(self, records: list[dict], object_type: str) -> str:
        """Generate CSV with SAP field headers."""
        field_map = SAP_EXPORT_FIELDS.get(object_type, {})
        sap_headers = list(field_map.values())

        output = io.StringIO()
        writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)
        writer.writerow(sap_headers)

        for record in records:
            mapped = self._map_record(record, object_type)
            writer.writerow([mapped.get(h, "") for h in sap_headers])

        return output.getvalue()

    def export_lsmw(self, records: list[dict], object_type: str) -> str:
        """Generate LSMW tab-delimited recording format."""
        tcode = TRANSACTION_CODES.get(object_type, "")
        lines: list[str] = []

        for i, record in enumerate(records):
            if i > 0:
                lines.append("")
            mapped = self._map_record(record, object_type)
            lines.append(f"TRANSACTION\t{tcode}")
            lines.append("BEGIN_SESSION")
            for sap_field, value in mapped.items():
                lines.append(f"SET {sap_field}={value}")
            lines.append("EXECUTE")
            lines.append("END_SESSION")

        return "\n".join(lines)

    def export_bapi(self, records: list[dict], object_type: str) -> str:
        """Generate JSON BAPI call structure."""
        bapi_name = BAPI_NAMES.get(object_type, f"BAPI_{object_type.upper()}_CHANGE")
        calls: list[dict[str, Any]] = []

        for i, record in enumerate(records, start=1):
            mapped = self._map_record(record, object_type)
            calls.append({
                "call_id": str(i),
                "bapi": bapi_name,
                "import_params": mapped,
            })

        return json.dumps({"bapi_calls": calls}, indent=2)

    def export_idoc(self, records: list[dict], object_type: str) -> str:
        """Generate JSON IDoc structure."""
        idoc_type = IDOC_TYPES.get(object_type, f"{object_type.upper()}01")
        idocs: list[dict[str, Any]] = []

        for record in records:
            mapped = self._map_record(record, object_type)
            idocs.append({
                "EDI_DC40": {
                    "IDOCTYP": idoc_type,
                    "MESTYP": "CHANGE",
                    "SNDPOR": "VANTAX",
                    "SNDPRT": "LS",
                    "RCVPOR": "SAP",
                    "RCVPRT": "LS",
                },
                "E1segment": mapped,
            })

        return json.dumps({"idocs": idocs}, indent=2)

    def export_sf_csv(self, records: list[dict], object_type: str) -> str:
        """Generate SuccessFactors-compatible CSV with OData field names."""
        if object_type == "employee":
            source_fields = list(SAP_EXPORT_FIELDS["employee"].keys())
            sf_headers = [SF_FIELD_NAMES.get(f, f) for f in source_fields]
        else:
            field_map = SAP_EXPORT_FIELDS.get(object_type, {})
            source_fields = list(field_map.keys())
            sf_headers = source_fields

        output = io.StringIO()
        writer = csv.writer(output, quoting=csv.QUOTE_ALL)
        writer.writerow(sf_headers)

        for record in records:
            row = [str(record.get(f, "")) if record.get(f) is not None else "" for f in source_fields]
            writer.writerow(row)

        return output.getvalue()
