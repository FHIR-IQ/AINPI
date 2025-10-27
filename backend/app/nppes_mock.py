"""Mock NPPES data service for demonstration purposes."""
from typing import Dict, Any, Optional, List
import random


def get_mock_nppes_data(npi: str) -> Optional[Dict[str, Any]]:
    """
    Generate mock NPPES data for demonstration.
    In production, this would call the actual NPPES API.
    """
    if not npi or len(npi) != 10:
        return None

    # Mock specialties
    specialties = [
        ("207R00000X", "Internal Medicine"),
        ("207RC0000X", "Cardiovascular Disease"),
        ("208D00000X", "General Practice"),
        ("208600000X", "Surgery"),
        ("208000000X", "Pediatrics"),
    ]

    # Mock insurances
    insurance_options = [
        "Blue Cross Blue Shield MA",
        "Aetna",
        "United Healthcare",
        "Cigna",
        "Harvard Pilgrim",
        "Tufts Health Plan",
    ]

    # Generate slightly different data to demonstrate discrepancies
    specialty = random.choice(specialties)

    return {
        "resourceType": "Practitioner",
        "identifier": [
            {
                "system": "http://hl7.org/fhir/sid/us-npi",
                "value": npi
            }
        ],
        "active": True,
        "name": [
            {
                "use": "official",
                "family": "Johnson",  # Intentionally different for demo
                "given": ["Sarah", "Marie"],
                "prefix": ["Dr."],
                "suffix": ["MD"]
            }
        ],
        "telecom": [
            {
                "system": "phone",
                "value": "(555) 123-4567",  # Different from ProviderCard
                "use": "work"
            },
            {
                "system": "email",
                "value": "sarah.johnson@nppes-mock.gov",  # Different email
                "use": "work"
            }
        ],
        "address": [
            {
                "use": "work",
                "type": "both",
                "line": ["123 Medical Plaza", "Suite 450"],  # Slightly different
                "city": "Boston",
                "state": "MA",
                "postalCode": "02115",
                "country": "US"
            }
        ],
        "gender": "female",
        "qualification": [
            {
                "code": {
                    "coding": [
                        {
                            "system": "http://nucc.org/provider-taxonomy",
                            "code": specialty[0],
                            "display": specialty[1]
                        }
                    ],
                    "text": specialty[1]
                },
                "issuer": {
                    "display": "American Board of Internal Medicine"
                }
            }
        ],
        # Additional NPPES metadata
        "nppes_metadata": {
            "enumeration_date": "2015-05-15",
            "last_updated": "2024-01-15",
            "certification_date": "2024-01-15",
            "entity_type": "Individual",
            "status": "Active",
            "authorized_insurances": random.sample(insurance_options, k=random.randint(3, 5))
        }
    }


def compare_provider_data(nppes_data: Dict[str, Any], providercard_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compare NPPES data with ProviderCard data and identify discrepancies.

    Returns:
        Dictionary with comparison results and detected discrepancies
    """
    discrepancies = []

    # Helper to extract name parts
    def extract_name(fhir_name_array):
        if not fhir_name_array:
            return None
        name = fhir_name_array[0]
        return {
            "given": " ".join(name.get("given", [])),
            "family": name.get("family", ""),
            "suffix": " ".join(name.get("suffix", []))
        }

    # Helper to extract address
    def extract_address(fhir_address_array):
        if not fhir_address_array:
            return None
        addr = fhir_address_array[0]
        return {
            "line": " ".join(addr.get("line", [])),
            "city": addr.get("city", ""),
            "state": addr.get("state", ""),
            "postalCode": addr.get("postalCode", "")
        }

    # Helper to extract phone
    def extract_phone(fhir_telecom_array):
        if not fhir_telecom_array:
            return None
        for telecom in fhir_telecom_array:
            if telecom.get("system") == "phone":
                return telecom.get("value", "")
        return None

    # Compare names
    nppes_name = extract_name(nppes_data.get("name", []))
    providercard_name = extract_name(providercard_data.get("name", []))

    if nppes_name and providercard_name:
        if nppes_name["family"] != providercard_name["family"]:
            discrepancies.append({
                "field": "Last Name",
                "nppes_value": nppes_name["family"],
                "providercard_value": providercard_name["family"],
                "severity": "high",
                "recommendation": "Update ProviderCard to match NPPES official record"
            })

        if nppes_name["given"] != providercard_name["given"]:
            discrepancies.append({
                "field": "First/Middle Name",
                "nppes_value": nppes_name["given"],
                "providercard_value": providercard_name["given"],
                "severity": "medium",
                "recommendation": "Consider updating to match NPPES format"
            })

    # Compare addresses
    nppes_addr = extract_address(nppes_data.get("address", []))
    providercard_addr = extract_address(providercard_data.get("address", []))

    if nppes_addr and providercard_addr:
        if nppes_addr["line"] != providercard_addr["line"]:
            discrepancies.append({
                "field": "Address",
                "nppes_value": nppes_addr["line"],
                "providercard_value": providercard_addr["line"],
                "severity": "medium",
                "recommendation": "Verify which address is current"
            })

        if nppes_addr["city"] != providercard_addr["city"]:
            discrepancies.append({
                "field": "City",
                "nppes_value": nppes_addr["city"],
                "providercard_value": providercard_addr["city"],
                "severity": "high",
                "recommendation": "Update to match NPPES"
            })

    # Compare phone numbers
    nppes_phone = extract_phone(nppes_data.get("telecom", []))
    providercard_phone = extract_phone(providercard_data.get("telecom", []))

    if nppes_phone and providercard_phone:
        # Normalize phone numbers for comparison
        nppes_phone_normalized = ''.join(filter(str.isdigit, nppes_phone))
        providercard_phone_normalized = ''.join(filter(str.isdigit, providercard_phone))

        if nppes_phone_normalized != providercard_phone_normalized:
            discrepancies.append({
                "field": "Phone Number",
                "nppes_value": nppes_phone,
                "providercard_value": providercard_phone,
                "severity": "low",
                "recommendation": "ProviderCard may have more recent contact info"
            })

    # Compare specialty/qualification
    nppes_qual = nppes_data.get("qualification", [])
    providercard_qual = providercard_data.get("qualification", [])

    if nppes_qual and providercard_qual:
        nppes_specialty = nppes_qual[0].get("code", {}).get("text", "")
        providercard_specialty = providercard_qual[0].get("code", {}).get("text", "") if providercard_qual else ""

        if nppes_specialty != providercard_specialty:
            discrepancies.append({
                "field": "Specialty",
                "nppes_value": nppes_specialty,
                "providercard_value": providercard_specialty,
                "severity": "high",
                "recommendation": "Verify current specialty certification"
            })

    # Calculate match score
    total_fields_compared = 6  # name, address, city, phone, specialty, etc.
    match_score = ((total_fields_compared - len(discrepancies)) / total_fields_compared) * 100

    return {
        "match_score": round(match_score, 1),
        "total_discrepancies": len(discrepancies),
        "discrepancies": discrepancies,
        "high_severity_count": len([d for d in discrepancies if d["severity"] == "high"]),
        "medium_severity_count": len([d for d in discrepancies if d["severity"] == "medium"]),
        "low_severity_count": len([d for d in discrepancies if d["severity"] == "low"]),
        "nppes_data": nppes_data,
        "providercard_data": providercard_data,
        "comparison_timestamp": "2025-10-20T10:00:00Z"
    }


def get_mock_integrations(practitioner_id: str) -> List[Dict[str, Any]]:
    """
    Get mock list of connected organizations/integrations.
    In production, this would query actual integration records.
    """
    return [
        {
            "id": "int-1",
            "name": "Blue Cross Blue Shield MA",
            "type": "payer",
            "status": "connected",
            "last_sync": "2025-10-18T14:30:00Z",
            "sync_frequency": "daily",
            "data_shared": ["demographics", "specialty", "license"],
            "logo_url": None
        },
        {
            "id": "int-2",
            "name": "MA Board of Registration in Medicine",
            "type": "state_board",
            "status": "connected",
            "last_sync": "2025-10-19T08:15:00Z",
            "sync_frequency": "weekly",
            "data_shared": ["demographics", "license", "certifications"],
            "logo_url": None
        },
        {
            "id": "int-3",
            "name": "Mass General Brigham",
            "type": "health_system",
            "status": "connected",
            "last_sync": "2025-10-20T06:00:00Z",
            "sync_frequency": "real-time",
            "data_shared": ["demographics", "specialty", "practice_location"],
            "logo_url": None
        },
        {
            "id": "int-4",
            "name": "Aetna",
            "type": "payer",
            "status": "pending",
            "last_sync": None,
            "sync_frequency": "daily",
            "data_shared": [],
            "logo_url": None
        },
        {
            "id": "int-5",
            "name": "Medicare",
            "type": "payer",
            "status": "connected",
            "last_sync": "2025-10-17T12:00:00Z",
            "sync_frequency": "weekly",
            "data_shared": ["demographics", "specialty", "npi"],
            "logo_url": None
        }
    ]
