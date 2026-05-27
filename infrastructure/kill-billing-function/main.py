"""Cloud Function: disable billing on the AINPI project when the budget alert fires.

Triggered by Pub/Sub topic `billing-alerts`, which the budget at
`projects/thematic-fort-453901-t7` publishes to when cost crosses thresholds.

The function disables billing ONLY when `costAmount >= budgetAmount` (i.e. the
100% threshold). Lower thresholds (50%, 90%) are notification-only.

After disabling billing, all GCP services for this project stop on the next
billing cycle (BigQuery queries error, Cloud Functions stop, etc.). To resume,
re-link the project to a billing account in the Cloud Console or via:
    gcloud billing projects link thematic-fort-453901-t7 \
      --billing-account=01B58B-9C267D-ECC805

This is intentionally a hard cap — if it fires, you want to know AND want
spending to stop immediately, not "after I check my email."
"""
import base64
import json
import os

from googleapiclient import discovery

PROJECT_ID = os.environ.get("PROJECT_ID", "thematic-fort-453901-t7")


def disable_billing(event, context):  # noqa: ARG001 (Cloud Functions signature)
    """Disable billing for PROJECT_ID when costAmount >= budgetAmount."""
    if "data" not in event:
        print("no `data` field on event; nothing to do")
        return

    pubsub_data = base64.b64decode(event["data"]).decode("utf-8")
    try:
        pubsub_json = json.loads(pubsub_data)
    except json.JSONDecodeError as e:
        print(f"failed to parse pubsub payload: {e}")
        return

    cost = float(pubsub_json.get("costAmount", 0))
    budget = float(pubsub_json.get("budgetAmount", 0))
    print(f"event: cost=${cost:.2f} budget=${budget:.2f}")

    if cost < budget:
        print("under budget; no action")
        return

    cloudbilling = discovery.build(
        "cloudbilling", "v1", cache_discovery=False
    )
    project_name = f"projects/{PROJECT_ID}"

    billing_info = (
        cloudbilling.projects().getBillingInfo(name=project_name).execute()
    )
    if not billing_info.get("billingEnabled", False):
        print(f"billing already disabled on {PROJECT_ID}")
        return

    cloudbilling.projects().updateBillingInfo(
        name=project_name,
        body={"billingAccountName": ""},
    ).execute()

    print(
        f"BILLING DISABLED on {PROJECT_ID}: "
        f"cost ${cost:.2f} >= budget ${budget:.2f}"
    )
