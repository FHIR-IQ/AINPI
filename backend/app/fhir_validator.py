"""Minimal FHIR R4 Practitioner resource validator."""
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, ValidationError


class FHIRValidationError(Exception):
    """Custom exception for FHIR validation errors."""
    pass


class FHIRValidator:
    """Minimal validator for FHIR R4 Practitioner resources."""

    REQUIRED_FIELDS = ["resourceType", "id"]
    VALID_GENDER_VALUES = ["male", "female", "other", "unknown"]
    VALID_NAME_USE_VALUES = ["usual", "official", "temp", "nickname", "anonymous", "old", "maiden"]
    VALID_TELECOM_SYSTEM_VALUES = ["phone", "fax", "email", "pager", "url", "sms", "other"]
    VALID_ADDRESS_USE_VALUES = ["home", "work", "temp", "old", "billing"]

    @classmethod
    def validate_practitioner(cls, resource: Dict[str, Any]) -> tuple[bool, List[str]]:
        """
        Validate a FHIR Practitioner resource.

        Returns:
            tuple: (is_valid: bool, errors: List[str])
        """
        errors = []

        # Check resource type
        if resource.get("resourceType") != "Practitioner":
            errors.append("resourceType must be 'Practitioner'")

        # Check required fields
        for field in cls.REQUIRED_FIELDS:
            if field not in resource:
                errors.append(f"Missing required field: {field}")

        # Validate id
        if "id" in resource:
            if not isinstance(resource["id"], str) or not resource["id"]:
                errors.append("id must be a non-empty string")

        # Validate identifier array
        if "identifier" in resource:
            identifier_errors = cls._validate_identifiers(resource["identifier"])
            errors.extend(identifier_errors)

        # Validate active
        if "active" in resource:
            if not isinstance(resource["active"], bool):
                errors.append("active must be a boolean")

        # Validate name array
        if "name" in resource:
            name_errors = cls._validate_names(resource["name"])
            errors.extend(name_errors)

        # Validate telecom array
        if "telecom" in resource:
            telecom_errors = cls._validate_telecom(resource["telecom"])
            errors.extend(telecom_errors)

        # Validate address array
        if "address" in resource:
            address_errors = cls._validate_addresses(resource["address"])
            errors.extend(address_errors)

        # Validate gender
        if "gender" in resource:
            if resource["gender"] not in cls.VALID_GENDER_VALUES:
                errors.append(
                    f"gender must be one of: {', '.join(cls.VALID_GENDER_VALUES)}"
                )

        # Validate birthDate
        if "birthDate" in resource:
            if not isinstance(resource["birthDate"], str):
                errors.append("birthDate must be a string in YYYY-MM-DD format")

        # Validate qualification array
        if "qualification" in resource:
            qual_errors = cls._validate_qualifications(resource["qualification"])
            errors.extend(qual_errors)

        return len(errors) == 0, errors

    @classmethod
    def _validate_identifiers(cls, identifiers: Any) -> List[str]:
        """Validate identifier array."""
        errors = []

        if not isinstance(identifiers, list):
            return ["identifier must be an array"]

        for idx, identifier in enumerate(identifiers):
            if not isinstance(identifier, dict):
                errors.append(f"identifier[{idx}] must be an object")
                continue

            # Check for system or value
            if "system" not in identifier and "value" not in identifier:
                errors.append(f"identifier[{idx}] must have system or value")

            # Validate system (if present)
            if "system" in identifier and not isinstance(identifier["system"], str):
                errors.append(f"identifier[{idx}].system must be a string")

            # Validate value (if present)
            if "value" in identifier and not isinstance(identifier["value"], str):
                errors.append(f"identifier[{idx}].value must be a string")

        return errors

    @classmethod
    def _validate_names(cls, names: Any) -> List[str]:
        """Validate name array."""
        errors = []

        if not isinstance(names, list):
            return ["name must be an array"]

        if len(names) == 0:
            errors.append("name array must not be empty")

        for idx, name in enumerate(names):
            if not isinstance(name, dict):
                errors.append(f"name[{idx}] must be an object")
                continue

            # At least family or given should be present
            if "family" not in name and "given" not in name:
                errors.append(f"name[{idx}] must have family or given")

            # Validate use
            if "use" in name and name["use"] not in cls.VALID_NAME_USE_VALUES:
                errors.append(
                    f"name[{idx}].use must be one of: {', '.join(cls.VALID_NAME_USE_VALUES)}"
                )

            # Validate given array
            if "given" in name:
                if not isinstance(name["given"], list):
                    errors.append(f"name[{idx}].given must be an array")
                elif not all(isinstance(g, str) for g in name["given"]):
                    errors.append(f"name[{idx}].given must contain only strings")

            # Validate prefix/suffix arrays
            for field in ["prefix", "suffix"]:
                if field in name:
                    if not isinstance(name[field], list):
                        errors.append(f"name[{idx}].{field} must be an array")
                    elif not all(isinstance(s, str) for s in name[field]):
                        errors.append(f"name[{idx}].{field} must contain only strings")

        return errors

    @classmethod
    def _validate_telecom(cls, telecoms: Any) -> List[str]:
        """Validate telecom array."""
        errors = []

        if not isinstance(telecoms, list):
            return ["telecom must be an array"]

        for idx, telecom in enumerate(telecoms):
            if not isinstance(telecom, dict):
                errors.append(f"telecom[{idx}] must be an object")
                continue

            # System is required
            if "system" not in telecom:
                errors.append(f"telecom[{idx}] must have system")
            elif telecom["system"] not in cls.VALID_TELECOM_SYSTEM_VALUES:
                errors.append(
                    f"telecom[{idx}].system must be one of: {', '.join(cls.VALID_TELECOM_SYSTEM_VALUES)}"
                )

            # Value is required
            if "value" not in telecom:
                errors.append(f"telecom[{idx}] must have value")
            elif not isinstance(telecom["value"], str):
                errors.append(f"telecom[{idx}].value must be a string")

        return errors

    @classmethod
    def _validate_addresses(cls, addresses: Any) -> List[str]:
        """Validate address array."""
        errors = []

        if not isinstance(addresses, list):
            return ["address must be an array"]

        for idx, address in enumerate(addresses):
            if not isinstance(address, dict):
                errors.append(f"address[{idx}] must be an object")
                continue

            # Validate use
            if "use" in address and address["use"] not in cls.VALID_ADDRESS_USE_VALUES:
                errors.append(
                    f"address[{idx}].use must be one of: {', '.join(cls.VALID_ADDRESS_USE_VALUES)}"
                )

            # Validate line array
            if "line" in address:
                if not isinstance(address["line"], list):
                    errors.append(f"address[{idx}].line must be an array")
                elif not all(isinstance(l, str) for l in address["line"]):
                    errors.append(f"address[{idx}].line must contain only strings")

        return errors

    @classmethod
    def _validate_qualifications(cls, qualifications: Any) -> List[str]:
        """Validate qualification array."""
        errors = []

        if not isinstance(qualifications, list):
            return ["qualification must be an array"]

        for idx, qual in enumerate(qualifications):
            if not isinstance(qual, dict):
                errors.append(f"qualification[{idx}] must be an object")
                continue

            # Code is required
            if "code" not in qual:
                errors.append(f"qualification[{idx}] must have code")
            elif not isinstance(qual["code"], dict):
                errors.append(f"qualification[{idx}].code must be an object")

        return errors

    @classmethod
    def validate_and_raise(cls, resource: Dict[str, Any]) -> None:
        """
        Validate a FHIR resource and raise exception if invalid.

        Raises:
            FHIRValidationError: If validation fails
        """
        is_valid, errors = cls.validate_practitioner(resource)
        if not is_valid:
            error_msg = "FHIR Practitioner validation failed:\n" + "\n".join(f"  - {err}" for err in errors)
            raise FHIRValidationError(error_msg)


def validate_fhir_practitioner(resource: Dict[str, Any]) -> Dict[str, Any]:
    """
    Validate a FHIR Practitioner resource.

    Args:
        resource: FHIR Practitioner resource as dict

    Returns:
        Dict with validation results

    Example:
        >>> result = validate_fhir_practitioner(practitioner_resource)
        >>> if result['valid']:
        >>>     print("Valid!")
        >>> else:
        >>>     print(result['errors'])
    """
    is_valid, errors = FHIRValidator.validate_practitioner(resource)

    return {
        "valid": is_valid,
        "errors": errors,
        "resource_type": resource.get("resourceType"),
        "resource_id": resource.get("id")
    }
