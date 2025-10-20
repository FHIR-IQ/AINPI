"""FHIR resource utilities for mapping to/from database models."""
from typing import List, Dict, Any, Optional
from .models import Practitioner, PractitionerRole


def practitioner_to_fhir(practitioner: Practitioner) -> Dict[str, Any]:
    """Convert Practitioner model to FHIR R4 resource."""
    fhir_resource = {
        "resourceType": "Practitioner",
        "id": practitioner.fhir_id,
        "identifier": [],
        "active": practitioner.status == "verified",
        "name": [
            {
                "use": "official",
                "family": practitioner.last_name,
                "given": [practitioner.first_name],
                "prefix": ["Dr."] if practitioner.suffix else [],
                "suffix": [practitioner.suffix] if practitioner.suffix else []
            }
        ],
        "telecom": [],
        "address": [],
        "gender": practitioner.gender if practitioner.gender else "unknown"
    }

    # Add middle name if present
    if practitioner.middle_name:
        fhir_resource["name"][0]["given"].append(practitioner.middle_name)

    # Add NPI identifier
    if practitioner.npi:
        fhir_resource["identifier"].append({
            "system": "http://hl7.org/fhir/sid/us-npi",
            "value": practitioner.npi
        })

    # Add DEA identifier
    if practitioner.dea_number:
        fhir_resource["identifier"].append({
            "system": "http://terminology.hl7.org/CodeSystem/v2-0203",
            "type": {
                "coding": [{"code": "DEA", "display": "DEA Number"}]
            },
            "value": practitioner.dea_number
        })

    # Add email
    if practitioner.email:
        fhir_resource["telecom"].append({
            "system": "email",
            "value": practitioner.email,
            "use": "work"
        })

    # Add phone
    if practitioner.phone:
        fhir_resource["telecom"].append({
            "system": "phone",
            "value": practitioner.phone,
            "use": "work"
        })

    # Add address
    if practitioner.address_line1:
        address_lines = [practitioner.address_line1]
        if practitioner.address_line2:
            address_lines.append(practitioner.address_line2)

        fhir_resource["address"].append({
            "use": "work",
            "line": address_lines,
            "city": practitioner.city,
            "state": practitioner.state,
            "postalCode": practitioner.postal_code,
            "country": practitioner.country or "US"
        })

    return fhir_resource


def practitioner_role_to_fhir(role: PractitionerRole) -> Dict[str, Any]:
    """Convert PractitionerRole model to FHIR R4 resource."""
    fhir_resource = {
        "resourceType": "PractitionerRole",
        "id": role.fhir_id,
        "active": role.active,
        "practitioner": {
            "reference": f"Practitioner/{role.practitioner.fhir_id}",
            "display": f"Dr. {role.practitioner.first_name} {role.practitioner.last_name}"
        },
        "specialty": [],
        "location": [],
        "telecom": []
    }

    # Add specialty
    if role.specialty_code:
        fhir_resource["specialty"].append({
            "coding": [{
                "system": "http://nucc.org/provider-taxonomy",
                "code": role.specialty_code,
                "display": role.specialty_display
            }]
        })

    # Add practice location
    if role.practice_name or role.practice_address_line1:
        location = {
            "display": role.practice_name if role.practice_name else "Primary Practice"
        }
        fhir_resource["location"].append(location)

    # Add license as qualification extension
    if role.license_number:
        if "extension" not in fhir_resource:
            fhir_resource["extension"] = []

        fhir_resource["extension"].append({
            "url": "http://providercard.io/fhir/StructureDefinition/license",
            "extension": [
                {
                    "url": "state",
                    "valueString": role.license_state
                },
                {
                    "url": "number",
                    "valueString": role.license_number
                },
                {
                    "url": "expiration",
                    "valueDate": role.license_expiration.strftime("%Y-%m-%d") if role.license_expiration else None
                }
            ]
        })

    # Add accepted insurances as extension
    if role.accepted_insurances:
        if "extension" not in fhir_resource:
            fhir_resource["extension"] = []

        fhir_resource["extension"].append({
            "url": "http://providercard.io/fhir/StructureDefinition/accepted-insurances",
            "valueString": ", ".join([ins.get("name", "") for ins in role.accepted_insurances])
        })

    return fhir_resource


def create_fhir_bundle(resources: List[Dict[str, Any]], bundle_type: str = "searchset") -> Dict[str, Any]:
    """Create a FHIR Bundle from a list of resources."""
    return {
        "resourceType": "Bundle",
        "type": bundle_type,
        "total": len(resources),
        "entry": [
            {
                "fullUrl": f"https://api.providercard.io/fhir/{resource['resourceType']}/{resource['id']}",
                "resource": resource
            }
            for resource in resources
        ]
    }
